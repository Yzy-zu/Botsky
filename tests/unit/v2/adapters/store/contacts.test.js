'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createContactsRepo, MAX_CONTACT_RESULTS } = require('../../../../../src/v2/adapters/store/repos/contacts');

function stubDb(rows) {
    const calls = [];
    return { calls, db: { all: async (sql, params) => { calls.push({ sql, params }); return rows; } } };
}

test('contact repository performs exact name matching, bounded read-only lookup, and returns sanitized targets', async () => {
    const { db, calls } = stubDb([
        { jid: '5215555555555@s.whatsapp.net', user_name: '  Ana López  ', secret: 'discard' },
        { jid: '5216666666666@s.whatsapp.net', user_name: 'Ana Lópezita' },
        { jid: '99999@lid', user_name: 'Ana López' }
    ]);
    const targets = await createContactsRepo(db).resolve('Ana López');
    assert.deepEqual(targets, [{ jid: '525555555555@s.whatsapp.net', name: 'Ana López', isGroup: false }]);
    assert.match(calls[0].sql, /LOWER\(TRIM\(user_name\)\)=LOWER\(TRIM\(\?\)\)/);
    assert.match(calls[0].sql, /LIMIT 8$/);
    assert.deepEqual(calls[0].params, ['Ana López']);
    assert.doesNotMatch(calls[0].sql, /INSERT|UPDATE|DELETE/i);
});

test('contact repository returns every exact candidate up to the fixed limit for caller ambiguity handling', async () => {
    const rows = Array.from({ length: MAX_CONTACT_RESULTS }, (_, i) => ({ jid: `${5215550000000 + i}@s.whatsapp.net`, user_name: 'Alex' }));
    const { db, calls } = stubDb(rows);
    const targets = await createContactsRepo(db).resolve('Alex');
    assert.equal(targets.length, MAX_CONTACT_RESULTS);
    assert.ok(targets.every(target => target.name === 'Alex'));
    assert.match(calls[0].sql, /LIMIT 8$/);
});

test('phone lookup binds exact variants including legacy Mexico 521 storage without fuzzy search', async () => {
    const { db, calls } = stubDb([{ jid: '5215555555555@s.whatsapp.net', user_name: 'Ana' }]);
    const targets = await createContactsRepo(db).resolve('+52 (55) 5555-5555');
    assert.deepEqual(calls[0].params, ['525555555555@s.whatsapp.net', '5215555555555@s.whatsapp.net']);
    assert.match(calls[0].sql, /jid IN \(\?,\?\).*LIMIT 8/s);
    assert.deepEqual(targets, [{ jid: '525555555555@s.whatsapp.net', name: 'Ana', isGroup: false }]);
});

test('10 digit Mexico phone lookup includes legacy 521 and does not construct a JID from a name', async () => {
    const { db, calls } = stubDb([{ jid: '5215555555555@s.whatsapp.net', user_name: 'Ana' }]);
    const targets = await createContactsRepo(db).resolve('5555555555');
    assert.deepEqual(calls[0].params, ['5555555555@s.whatsapp.net', '5215555555555@s.whatsapp.net']);
    assert.deepEqual(targets, [{ jid: '525555555555@s.whatsapp.net', name: 'Ana', isGroup: false }]);
    const nameDb = stubDb([]);
    await createContactsRepo(nameDb.db).resolve('Fernando 12');
    assert.match(nameDb.calls[0].sql, /user_name/);
});

test('invalid and oversized queries do not reach the database', async () => {
    const { db, calls } = stubDb([]);
    const repo = createContactsRepo(db);
    assert.deepEqual(await repo.resolve('  '), []);
    assert.deepEqual(await repo.resolve('x'.repeat(161)), []);
    assert.equal(calls.length, 0);
});
