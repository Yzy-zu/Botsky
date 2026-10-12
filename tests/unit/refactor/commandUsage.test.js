'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveCommand, classifySuccess, createCommandUsage, createSqliteCommandUsageSink } = require('../../../src/services/commandUsage');
const meta = { command: 'help', chat_type: 'group' };
const turn = () => new Promise(resolve => setImmediate(resolve));

test('import and disabled factories have no SQLite, clock, classifier or sink effects', async () => {
    const modulePath = path.resolve(__dirname, '../../../src/services/commandUsage.js');
    execFileSync(process.execPath, ['-e', `
        const Module = require('node:module');
        const load = Module._load;
        Module._load = function(name, ...rest) {
            if (name === 'sqlite3') throw Error('unexpected sqlite import');
            return load.call(this, name, ...rest);
        };
        require(${JSON.stringify(modulePath)});
    `]);
    const forbidden = () => { throw new Error('disabled effect'); };
    const sink = createSqliteCommandUsageSink({ sqliteFactory: forbidden });
    assert.equal(await sink.start(), false);
    assert.equal(sink.enqueue({}), false);
    await sink.flush();
    await sink.close();
    const usage = createCommandUsage({ sink: forbidden, wallClock: forbidden, monotonicClock: forbidden });
    const result = {};
    assert.equal(await usage.track(meta, () => result, forbidden), result);
    usage.observe(meta, result, forbidden);
    assert.deepEqual(usage.stats, { initiated: 0, recorded: 0, unknown: 0, ignored: 0, sinkErrors: 0, dropped: 0 });
});

test('closed canonical map covers every registry alias without loading registry side effects', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/core/commandRegistry.js'), 'utf8');
    const matches = [...source.matchAll(/^register\((\[[^\n]*\])/gm)];
    assert.ok(matches.length > 35);
    for (const match of matches) {
        const names = [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
        for (const name of names) assert.ok(resolveCommand(name), `Unmapped alias ${name}`);
        if (resolveCommand(names[0]).feature === 'moderation') {
            for (const name of names) assert.equal(resolveCommand(name).command, name);
        } else assert.deepEqual(resolveCommand(names[0]), resolveCommand(names[names.length - 1]));
    }
    assert.deepEqual(resolveCommand('HELP'), { feature: 'help', command: 'ayuda' });
    assert.deepEqual(resolveCommand('comprar', { item: 'pack' }), resolveCommand('pack'));
    assert.deepEqual(resolveCommand('dl', { adult: true }), { feature: 'adult-media', command: 'descargar' });
    for (const input of ['__proto__', 'constructor', '!ayuda', 'send 5215551234567', '', undefined]) {
        assert.equal(resolveCommand(input), null);
    }
});

test('explicit outcomes, monotonic latency and allowlisted fields preserve result identity', async () => {
    const rows = [];
    let mono = 40;
    const usage = createCommandUsage({ enabled: true, sink: row => rows.push(row),
        wallClock: () => 1234, monotonicClock: () => mono });
    const result = { success: true, phone: '5215551234567', message: 'private content' };
    const richMeta = { ...meta, raw: 'secret text', jid: '5215551234567@s.whatsapp.net', feature: 'injected' };
    assert.equal(await usage.track(richMeta, () => { mono = 47; return result; }, classifySuccess), result);
    await turn();
    assert.deepEqual(rows, [{ feature: 'help', command: 'ayuda', chat_type: 'group', ts: 1234, ok: 1, latency_ms: 7 }]);
    await usage.track(meta, () => ({ success: false }), classifySuccess);
    await turn();
    assert.equal(rows[1].ok, 0);
    assert.equal(usage.stats.recorded, 2);
    const mutableMeta = { ...meta };
    await usage.track(mutableMeta, () => {
        mutableMeta.chat_type = 'private user identifier';
        mutableMeta.command = 'raw private text';
        return { success: true };
    }, classifySuccess);
    await turn();
    assert.equal(rows[2].chat_type, 'group');
    assert.equal(rows[2].command, 'ayuda');
});

test('undefined, HTTP resolution, boolean return and classifier errors record unknown NULL', async () => {
    const rows = [];
    const usage = createCommandUsage({ enabled: true, sink: row => rows.push(row) });
    for (const result of [undefined, true, { status: 200 }, { consumed: true }, { success: 'yes' }]) {
        await usage.track(meta, () => result, classifySuccess);
    }
    await usage.track(meta, () => ({ success: true }));
    await usage.track(meta, () => undefined, () => { throw new Error('classifier'); });
    await turn();
    assert.equal(rows.length, 7);
    assert.ok(rows.every(row => row.ok === null));
    assert.equal(usage.stats.unknown, 7);
});

test('throws preserve original rejection and record failure; ignored and unknown commands produce no rows', async () => {
    const rows = [];
    const usage = createCommandUsage({ enabled: true, sink: row => rows.push(row) });
    const original = new Error('private payload');
    await assert.rejects(usage.track(meta, () => { throw original; }), error => error === original);
    await usage.track(meta, () => undefined, () => 'ignored');
    await usage.track({ ...meta, command: 'private raw input' }, () => 1, () => true);
    await usage.track({ ...meta, chat_type: 'private-jid' }, () => 1, () => true);
    await turn();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ok, 0);
    assert.equal(usage.stats.ignored, 3);
    assert.ok(!JSON.stringify(rows).includes(original.message));
});

test('stalled, throwing and rejected sinks never block or replace operation results', async () => {
    for (const sink of [() => new Promise(() => {}), () => { throw Error('secret'); }, () => Promise.reject(Error('secret'))]) {
        const usage = createCommandUsage({ enabled: true, sink });
        assert.equal(await usage.track(meta, () => 'result', () => true), 'result');
        const original = new Error('operation failed');
        await assert.rejects(usage.track(meta, () => Promise.reject(original)), error => error === original);
        await turn();
        assert.ok(usage.stats.sinkErrors === 0 || usage.stats.sinkErrors === 2);
    }
    const usage = createCommandUsage({ enabled: true, sink: () => false });
    usage.observe(meta, { success: true }, classifySuccess);
    await turn();
    assert.equal(usage.stats.dropped, 1);
});

function fakeSqlite({ holdInserts = false, failInsert = false, failInit = false } = {}) {
    const calls = [];
    const held = [];
    let opens = 0;
    let closes = 0;
    class Database {
        constructor(filename, callback) { opens++; calls.push({ filename }); queueMicrotask(() => callback(null)); }
        run(sql, params, callback) {
            calls.push({ sql, params });
            if (sql.startsWith('INSERT') && holdInserts) held.push(callback);
            else queueMicrotask(() => callback((failInsert && sql.startsWith('INSERT')) || (failInit && sql.startsWith('CREATE')) ? new Error('sqlite error') : null));
        }
        close(callback) { closes++; queueMicrotask(() => callback(null)); }
    }
    return { factory: () => ({ Database }), calls, held, get opens() { return opens; }, get closes() { return closes; } };
}
const row = { feature: 'help', command: 'ayuda', chat_type: 'group', ts: 1234, ok: null, latency_ms: 5 };

test('SQLite sidecar is lazy; schema permits NULL and inserts are parameterized and sanitized', async () => {
    const sqlite = fakeSqlite();
    const sink = createSqliteCommandUsageSink({ enabled: true, filename: '/isolated/usage.db', sqliteFactory: sqlite.factory });
    assert.equal(sqlite.opens, 0);
    assert.equal(sink.enqueue(row), false);
    assert.equal(await sink.start(), true);
    assert.equal(await sink.start(), true);
    assert.equal(sqlite.opens, 1);
    assert.equal(sink.enqueue({ ...row, raw: 'private text', jid: 'private jid' }), true);
    assert.equal(sink.enqueue({ ...row, command: 'private raw input' }), false);
    assert.equal(sink.enqueue({ ...row, feature: 'injected' }), false);
    await sink.flush();
    const insert = sqlite.calls.find(call => call.sql?.startsWith('INSERT'));
    assert.deepEqual(insert.params, ['help', 'ayuda', 'group', 1234, null, 5]);
    assert.ok(insert.sql.endsWith('VALUES (?,?,?,?,?,?)'));
    assert.ok(sqlite.calls.find(call => call.sql?.startsWith('CREATE')).sql.includes('ok IS NULL'));
    assert.equal(sink.stats.written, 1);
    await sink.close();
    await sink.close();
    assert.equal(sqlite.closes, 1);
    assert.equal(sink.enqueue(row), false);
    assert.equal(await sink.start(), false);
});

test('bound includes in-flight inserts; flush and close drain pending rows without retries', async () => {
    const sqlite = fakeSqlite({ holdInserts: true });
    const sink = createSqliteCommandUsageSink({ enabled: true, filename: 'sidecar.db', maxBuffer: 2, sqliteFactory: sqlite.factory });
    await sink.start();
    assert.equal(sink.enqueue(row), true);
    const firstFlush = sink.flush();
    assert.equal(sink.stats.pending, 1);
    assert.equal(sink.enqueue(row), true);
    assert.equal(sink.enqueue(row), false);
    const closed = sink.close();
    assert.equal(sink.enqueue(row), false);
    sqlite.held.shift()(null);
    await turn();
    assert.equal(sqlite.held.length, 1);
    sqlite.held.shift()(null);
    await firstFlush;
    await closed;
    assert.equal(sink.stats.written, 2);
    assert.equal(sink.stats.pending, 0);
    assert.equal(sink.stats.dropped, 2);
});

test('SQLite write and init failures are observable without unhandled errors', async () => {
    const sqlite = fakeSqlite({ failInsert: true });
    const sink = createSqliteCommandUsageSink({ enabled: true, filename: 'sidecar.db', sqliteFactory: sqlite.factory });
    await sink.start();
    sink.enqueue(row);
    await sink.flush();
    assert.equal(sink.stats.errors, 1);
    assert.equal(sink.stats.dropped, 1);
    assert.equal(sink.stats.written, 0);
    await sink.close();
    const failedSqlite = fakeSqlite({ failInit: true });
    const failed = createSqliteCommandUsageSink({ enabled: true, filename: 'sidecar.db', sqliteFactory: failedSqlite.factory });
    await assert.rejects(failed.start(), /sqlite error/);
    assert.equal(failed.enqueue(row), false);
    await failed.close();
    assert.equal(failedSqlite.closes, 1);
    assert.equal(failed.stats.errors, 1);
});
