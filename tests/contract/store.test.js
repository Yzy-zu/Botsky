'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createDb, inspectBackup, restoreBackup } = require('../../src/v2/adapters/store/sqlite');
const { migrate } = require('../../src/v2/adapters/store/migrations');
const { legacyMigration } = require('../../src/v2/adapters/store/migrations/000-legacy');
const { createUsersRepo } = require('../../src/v2/adapters/store/repos/users');
const { createConversationRepo } = require('../../src/v2/adapters/store/repos/conversation');

async function temporary(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-store-contract-'));
    const dbs = [];
    t.after(async () => {
        for (const db of dbs) await db.close();
        await fs.rm(directory, { recursive: true, force: true });
    });
    function db(name = 'source.db', options = {}) {
        const handle = createDb({ filename: path.join(directory, name), ...options });
        dbs.push(handle);
        return handle;
    }
    return { directory, db, backup: name => path.join(directory, name) };
}

test('store imports without sqlite binding or files; explicit lifecycle and parameterized APIs', async t => {
    const filename = path.resolve(__dirname, '../../src/v2/adapters/store/sqlite.js');
    execFileSync(process.execPath, ['-e', `
        const Module = require('node:module'); const load = Module._load;
        Module._load = function(name, ...args) {
            if (name === 'sqlite3') throw Error('import opened sqlite');
            return load.call(this,name,...args);
        };
        const {createDb}=require(${JSON.stringify(filename)});
        createDb({filename: '/this-file-must-not-exist.db'});
    `]);
    const fixture = await temporary(t);
    const db = fixture.db();
    await assert.rejects(db.get('SELECT 1'), /not open/);
    await db.open();
    await db.open();
    await db.exec('CREATE TABLE demo(id INTEGER PRIMARY KEY,value TEXT)');
    const literal = "apostrophe'; DROP TABLE demo;--";
    const result = await db.run('INSERT INTO demo(value) VALUES (?)', [literal]);
    assert.equal(result.changes, 1);
    assert.equal(result.lastID, 1);
    assert.deepEqual(await db.get('SELECT value FROM demo WHERE id=?', [1]), { value: literal });
    assert.equal(await db.get('SELECT value FROM demo WHERE id=?', [2]), undefined);
    assert.deepEqual(await db.all('SELECT value FROM demo'), [{ value: literal }]);
    await assert.rejects(db.run('INSERT INTO missing VALUES (?)', [1]));
    await assert.rejects(db.all('SELECT * FROM missing'));
    await assert.rejects(db.exec('invalid sql'));
    assert.equal((await db.get('PRAGMA journal_mode')).journal_mode, 'wal');
    await db.close();
    await db.close();
    await assert.rejects(db.run('SELECT 1'), /not open/);
    await db.open();
    assert.equal((await db.get('SELECT count(*) AS n FROM demo')).n, 1);
});

test('transactions isolate outside calls, rollback exceptions and reject nested transactions', async t => {
    const fixture = await temporary(t);
    const db = fixture.db();
    await db.open();
    await db.exec('CREATE TABLE items(value INTEGER)');
    let enter;
    const entered = new Promise(resolve => { enter = resolve; });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const tx = db.transaction(async txDb => {
        await txDb.run('INSERT INTO items VALUES (1)');
        enter();
        await gate;
        assert.deepEqual(await txDb.all('SELECT value FROM items'), [{ value: 1 }]);
        await txDb.run('INSERT INTO items VALUES (2)');
        return 42;
    });
    await entered;
    const outside = db.run('INSERT INTO items VALUES (3)');
    release();
    assert.equal(await tx, 42);
    await outside;
    assert.deepEqual(await db.all('SELECT value FROM items'), [{ value: 1 }, { value: 2 }, { value: 3 }]);
    const original = new Error('transaction failure');
    await assert.rejects(db.transaction(async txDb => {
        await txDb.run('INSERT INTO items VALUES (4)');
        throw original;
    }), error => error === original);
    assert.equal((await db.get('SELECT count(*) AS n FROM items')).n, 3);
    await assert.rejects(db.transaction(async () => db.transaction(async () => 1)), /Nested/);
    await assert.rejects(db.transaction(async () => db.close()), /during transaction/);
    await assert.rejects(db.transaction(async () => db.backupTo(fixture.backup('forbidden.db'))), /during transaction/);
    assert.equal((await db.get('SELECT count(*) AS n FROM items')).n, 3);
});

test('migration000 matches complete statically extracted legacy schema and guarded upgrades', async t => {
    const fixture = await temporary(t);
    const db = fixture.db();
    const reference = fixture.db('reference.db');
    await Promise.all([db.open(), reference.open()]);
    const source = await fs.readFile(path.resolve(__dirname, '../../src/services/db.js'), 'utf8');
    const initialization = source.slice(source.indexOf('db.serialize(() => {'), source.indexOf('// ─── Utilidad de normalizar'));
    const statements = [...initialization.matchAll(/db\.run\(`([\s\S]*?)`/g)]
        .map(match => match[1].trim()).filter(sql => /^(CREATE|ALTER) /.test(sql));
    assert.equal(statements.filter(sql => sql.startsWith('CREATE TABLE')).length, 24);
    assert.equal(statements.filter(sql => sql.startsWith('CREATE INDEX')).length, 13);
    assert.equal(statements.filter(sql => sql.startsWith('ALTER')).length, 4);
    for (const statement of statements) await reference.exec(statement);
    const first = await migrate(db, { backupPath: fixture.backup('before000.db'), clock: { now: () => 123 } });
    assert.deepEqual(first.applied, ['000']);
    assert.equal(first.backup.integrity, 'ok');
    assert.deepEqual(await inventory(db), await inventory(reference));
    assert.equal((await db.get('SELECT applied_at FROM schema_migrations')).applied_at, 123);
    const second = await migrate(db, { backupPath: fixture.backup('should-not-exist.db') });
    assert.deepEqual(second, { applied: [], backup: null });
    await assert.rejects(fs.stat(fixture.backup('should-not-exist.db')), { code: 'ENOENT' });
    // Existing legacy schema including ALTERs upgrades without duplicate-column errors.
    await migrate(reference, { backupPath: fixture.backup('legacy-before.db') });
    assert.deepEqual(await inventory(db), await inventory(reference));
    for (const name of ['bot_personality_state', 'bot_personality_states', 'bot_happy_hour']) {
        assert.equal((await db.get(`SELECT count(*) AS n FROM ${name}`)).n, 0, 'No invented startup seeds');
    }
});

async function inventory(db) {
    const objects = await db.all("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name!='schema_migrations' ORDER BY type,name");
    const result = [];
    for (const object of objects) {
        result.push({ ...object, sql: object.sql.replace(/\s+/g, ' ').trim(),
            columns: object.type === 'table' ? await db.all(`PRAGMA table_info(${object.name})`) : [],
            foreignKeys: object.type === 'table' ? await db.all(`PRAGMA foreign_key_list(${object.name})`) : [],
            indexes: object.type === 'table' ? await db.all(`PRAGMA index_list(${object.name})`) : [] });
    }
    return result;
}

test('migration DDL/data/version are atomic; checksum mismatch and no-backup fail before mutation', async t => {
    const fixture = await temporary(t);
    const db = fixture.db();
    await db.open();
    await assert.rejects(migrate(db, { backupPath: '' }), /Backup path/);
    assert.equal(await db.get("SELECT name FROM sqlite_master WHERE name='schema_migrations'"), undefined);
    const failed = { version: '000', checksum: 'b'.repeat(64), async up(tx) {
        await tx.exec('CREATE TABLE doomed(value TEXT)');
        await tx.run('INSERT INTO doomed VALUES (?)', ['before rollback']);
        throw new Error('migration failed');
    } };
    await assert.rejects(migrate(db, { backupPath: fixture.backup('failure-before.db'), migrations: [failed] }), /migration failed/);
    assert.equal(await db.get("SELECT name FROM sqlite_master WHERE name IN ('doomed','schema_migrations')"), undefined);
    await migrate(db, { backupPath: fixture.backup('valid-before.db') });
    const good = await legacyMigration();
    await assert.rejects(migrate(db, { backupPath: fixture.backup('unused.db'), migrations: [{ ...good, checksum: 'a'.repeat(64) }] }), /history mismatch/);
    await assert.rejects(migrate(db, { backupPath: fixture.backup('unused.db'), migrations: [good, good] }), /Invalid migration/);
    await assert.rejects(migrate(db, { backupPath: fixture.backup('unused.db'), migrations: [{ ...good, version: 'bad' }] }), /Invalid migration/);
});

test('real WAL snapshot survives concurrent commits and restore preserves users/reminders/durable sessions', async t => {
    const fixture = await temporary(t);
    const db = fixture.db();
    await db.open();
    await migrate(db, { backupPath: fixture.backup('empty-before.db') });
    await db.run('INSERT INTO users (jid,xp,level,strikes) VALUES (?,?,?,?)', ['synthetic-user', 120, 7, 2]);
    await db.run('INSERT INTO reminders(target_jid,sender_jid,reminder_text,due_at) VALUES (?,?,?,?)', ['synthetic-chat', 'synthetic-user', 'synthetic reminder', 500]);
    await db.run('INSERT INTO cooperacha_sessions(group_jid,target_xp,collected_xp,created_at,expires_at) VALUES (?,?,?,?,?)', ['synthetic-group', 500, 120, 10, 999]);
    await db.exec('CREATE TABLE atomic_pairs(n INTEGER,side INTEGER); PRAGMA wal_autocheckpoint=0');
    await db.exec('INSERT INTO atomic_pairs VALUES (-1,0),(-1,1)');
    const writer = fixture.db();
    await writer.open();
    const writing = (async () => {
        for (let n = 0; n < 30; n++) await writer.transaction(async tx => {
            await tx.run('INSERT INTO atomic_pairs VALUES (?,0)', [n]);
            await tx.run('INSERT INTO atomic_pairs VALUES (?,1)', [n]);
        });
    })();
    const backupName = fixture.backup('snapshot.db');
    const manifest = await db.backupTo(backupName);
    await writing;
    assert.ok((await fs.stat(`${db.filename}-wal`)).size > 0);
    assert.equal(manifest.integrity, 'ok');
    assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
    assert.ok(manifest.createdAt > 0);
    assert.equal(manifest.versions[0].version, '000');
    assert.ok(!JSON.stringify(manifest).includes('synthetic-user'));
    await db.run('UPDATE users SET xp=999 WHERE jid=?', ['synthetic-user']);
    const restoredName = fixture.backup('restored.db');
    const restoredManifest = await restoreBackup(backupName, restoredName);
    assert.equal(restoredManifest.sha256, manifest.sha256);
    const restored = fixture.db('restored.db', { readonly: true });
    await restored.open();
    assert.deepEqual(await restored.get('SELECT jid,xp,level,strikes FROM users'), { jid: 'synthetic-user', xp: 120, level: 7, strikes: 2 });
    assert.equal((await restored.get('SELECT reminder_text,status FROM reminders')).status, 'pending');
    assert.deepEqual(await restored.get('SELECT target_xp,collected_xp,status,expires_at FROM cooperacha_sessions'),
        { target_xp: 500, collected_xp: 120, status: 'active', expires_at: 999 });
    const pairs = await restored.all('SELECT n,count(*) AS sides,sum(side) AS total FROM atomic_pairs GROUP BY n');
    assert.ok(pairs.length >= 1);
    assert.ok(pairs.every(pair => pair.sides === 2 && pair.total === 1), 'snapshot contains complete committed transactions');
    assert.equal((await restored.get('PRAGMA integrity_check')).integrity_check, 'ok');
    await assert.rejects(restoreBackup(backupName, restoredName), { code: 'EEXIST' });
    await assert.rejects(db.backupTo(backupName), { code: 'EEXIST' });
    await assert.rejects(db.backupTo(db.filename), /differ/);
    const stale = fixture.backup('stale.db');
    await fs.writeFile(stale + '-wal', 'stale sidecar');
    await assert.rejects(restoreBackup(backupName, stale), /sidecars/);
    await assert.rejects(db.backupTo(stale), /sidecars/);
    await assert.rejects(restored.run('DELETE FROM users'), /readonly/);
    const invalid = fixture.backup('invalid.db');
    await fs.writeFile(invalid, 'not SQLite');
    await assert.rejects(inspectBackup(invalid));
    await assert.rejects(restoreBackup(invalid, fixture.backup('must-not-exist.db')));
});

test('users and conversation repos preserve normalization, atomic creation and bounded history', async t => {
    const fixture = await temporary(t);
    const db = fixture.db();
    await db.open();
    await migrate(db, { backupPath: fixture.backup('before.db') });
    const users = createUsersRepo(db);
    const first = await users.getOrCreate(' synthetic:7@s.whatsapp.net ');
    assert.deepEqual(first, { jid: 'synthetic@s.whatsapp.net', xp: 0, level: 1, strikes: 0 });
    await Promise.all([users.getOrCreate(first.jid), users.getOrCreate(first.jid)]);
    assert.deepEqual(await users.get(first.jid), first);
    assert.equal((await db.get('SELECT count(*) AS n FROM users')).n, 1);
    await assert.rejects(users.getOrCreate(' '), /JID/);
    const conversation = createConversationRepo(db, { now: () => 1234 });
    for (let i = 0; i < 22; i++) await conversation.append('synthetic-chat', i % 2 ? 'assistant' : 'user', String(i));
    await conversation.append('another-chat', 'user', 'isolated', 'synthetic-name');
    const recent = await conversation.recent('synthetic-chat', 20);
    assert.equal(recent.length, 20);
    assert.equal(recent[0].content, '2');
    assert.equal(recent[19].content, '21');
    assert.equal(recent[0].timestamp, 1234);
    assert.equal(recent[0].name, 'Usuario');
    assert.equal(recent[1].name, 'Botsky');
    assert.equal((await conversation.recent('another-chat'))[0].name, 'synthetic-name');
    await assert.rejects(conversation.recent('synthetic-chat', 0), /limit/);
    await assert.rejects(conversation.append('', 'user', ''), /Invalid/);
    await conversation.clear('synthetic-chat');
    assert.deepEqual(await conversation.recent('synthetic-chat'), []);
    assert.equal((await conversation.recent('another-chat')).length, 1);
    assert.deepEqual(await users.addXp(first.jid, 20), { ...first, xp: 20, level: 2, levelUp: true });
    await Promise.all([users.addXp(first.jid, 1), users.addXp(first.jid, 1)]);
    assert.equal((await users.get(first.jid)).xp, 22);
    await assert.rejects(users.addXp(first.jid, NaN), /Invalid/);
});
