'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createDb, migrate, createUsersRepo, createConversationRepo } = require('../../src/v2/adapters/store');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '../..');

// Import the actual legacy API only in a child with explicit synthetic env and
// a temporary DATA_DIR. Never import src/services/db.js in the parent process.
test('Actual v1 DB API reads v2 migrated users, history and reminders; v2 reads the temporary v1 writes', async t => {
    await assert.rejects(fs.access(path.join(root, '.env')), { code: 'ENOENT' }, 'Checkout must not contain production env');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-legacy-compat-'));
    await fs.chmod(directory, 0o700);
    const filename = path.join(directory, 'bot.db');
    const db = createDb({ filename });
    t.after(async () => { await db.close(); await fs.rm(directory, { recursive: true, force: true }); });
    await db.open();
    const result = await migrate(db, { backupPath: path.join(directory, 'before-migration.db'), clock: { now: () => 1000 } });
    assert.deepEqual(result.applied, ['000']);
    const userJid = '19995550101@s.whatsapp.net';
    const groupJid = '120363000000000001@g.us';
    const users = createUsersRepo(db);
    await users.addXp(userJid, 42);
    const history = createConversationRepo(db, { now: () => 2000 });
    await history.append(groupJid, 'user', 'Mensaje ficticio de prueba', 'Persona Sintética', 1000);
    await history.append(groupJid, 'assistant', 'Respuesta ficticia de prueba', 'Botsky', 2000);
    const reminder = await db.run(`INSERT INTO reminders(target_jid,sender_jid,sender_name,reminder_text,due_at,status)
        VALUES(?,?,?,?,?,?)`, [groupJid, userJid, 'Persona Sintética', 'Recordatorio sintético', 3000, 'pending']);
    await db.run(`INSERT INTO reminders(target_jid,sender_jid,sender_name,reminder_text,due_at,status)
        VALUES(?,?,?,?,?,?)`, [groupJid, userJid, 'Persona Sintética', 'Futuro sintético', 9000, 'pending']);
    await db.run(`INSERT INTO cooperacha_sessions(group_jid,target_xp,collected_xp,status,created_at,expires_at)
        VALUES(?,?,?,?,?,?)`, [groupJid, 100, 25, 'active', 1000, 100000]);
    await db.close(); // Exactly one process owns the DB at each stage.

    const child = `
        'use strict';
        const assert = require('node:assert/strict');
        const fs = require('node:fs');
        const path = require('node:path');
        assert.deepEqual(Object.keys(process.env).sort(), ['DATA_DIR','NODE_ENV','TZ']);
        assert.equal(process.cwd(), process.env.DATA_DIR);
        assert.equal(fs.existsSync(path.join(process.cwd(), '.env')), false);
        assert.equal(fs.existsSync(${JSON.stringify(path.join(root, '.env'))}), false);
        const legacy = require(${JSON.stringify(path.join(root, 'src/services/db.js'))});
        (async () => {
            try {
                assert.equal(path.resolve(legacy.db.filename), path.join(process.env.DATA_DIR, 'bot.db'));
                const user = await legacy.getOrCreateUser(${JSON.stringify(userJid)});
                assert.deepEqual(user, { jid:${JSON.stringify(userJid)},xp:42,level:3,strikes:0 });
                const history = await legacy.getRecentChatMessages(${JSON.stringify(groupJid)}, 12);
                assert.deepEqual(history, [
                    {role:'user',content:'Mensaje ficticio de prueba',name:'Persona Sintética',timestamp:1000},
                    {role:'assistant',content:'Respuesta ficticia de prueba',name:'Botsky',timestamp:2000}
                ]);
                const due = await legacy.getDueReminders(4000);
                assert.equal(due.length,1);assert.equal(due[0].id,${reminder.lastID});
                assert.equal(due[0].target_jid,${JSON.stringify(groupJid)});
                assert.equal(due[0].sender_jid,${JSON.stringify(userJid)});
                assert.equal(due[0].reminder_text,'Recordatorio sintético');
                assert.equal(due[0].status,'pending');
                const pending = await legacy.getUserPendingReminders(${JSON.stringify(groupJid)},${JSON.stringify(userJid)});
                assert.deepEqual(pending.map(row=>row.due_at),[3000,9000]);
                assert.deepEqual(await legacy.getUserPendingReminders(${JSON.stringify(groupJid)},'19995550102@s.whatsapp.net'),[]);
                // db.js has no cooperacha business read export. Its actual exported
                // sqlite handle proves schema retention, without pretending otherwise.
                const session = await new Promise((resolve,reject)=>legacy.db.get(
                    'SELECT group_jid,target_xp,collected_xp,status,created_at,expires_at FROM cooperacha_sessions',
                    (error,row)=>error?reject(error):resolve(row)));
                assert.deepEqual(session,{group_jid:${JSON.stringify(groupJid)},target_xp:100,collected_xp:25,status:'active',created_at:1000,expires_at:100000});
                await legacy.addXp(${JSON.stringify(userJid)},5);
                assert.equal(await legacy.markReminderDelivered(${reminder.lastID}),true);
                await legacy.saveChatMessage(${JSON.stringify(groupJid)},'assistant','Escritura v1 sintética','Botsky',3000);
            } finally {
                await new Promise((resolve,reject)=>legacy.db.close(error=>error?reject(error):resolve()));
            }
            process.stdout.write('ACTUAL_V1_COMPATIBILITY_OK\\n');
        })().catch(()=>{process.stderr.write('Isolated actual-v1 compatibility assertion failed\\n');process.exitCode=1;});
    `;
    const subprocess = await execute(process.execPath, ['-e', child], {
        cwd: directory,
        env: { DATA_DIR: directory, NODE_ENV: 'test', TZ: 'UTC' },
        timeout: 15000,
        maxBuffer: 64 * 1024
    });
    assert.match(subprocess.stdout, /ACTUAL_V1_COMPATIBILITY_OK/);
    assert.equal(subprocess.stderr, '');
    await db.open();
    assert.deepEqual(await users.get(userJid), { jid: userJid, xp: 47, level: 3, strikes: 0 });
    assert.equal((await db.get('SELECT status FROM reminders WHERE id=?', [reminder.lastID])).status, 'delivered');
    assert.equal((await history.recent(groupJid)).at(-1).content, 'Escritura v1 sintética');
    assert.deepEqual(await db.all('SELECT version FROM schema_migrations'), [{ version: '000' }]);
    assert.equal((await db.get('SELECT collected_xp FROM cooperacha_sessions')).collected_xp, 25);
    assert.equal((await db.get('PRAGMA integrity_check')).integrity_check, 'ok');
});
