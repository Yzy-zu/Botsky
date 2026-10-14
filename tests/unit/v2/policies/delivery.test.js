'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDeliveryTarget } = require('../../../../src/v2/policies/delivery.policy');

const roles = { admins: ['5215555555555@s.whatsapp.net'], owners: ['5214444444444@s.whatsapp.net'] };
const base = { currentChatId: '120363000000000001@g.us', senderJid: '5211111111111@s.whatsapp.net', isGroup: true, roles,
    mainGroupJid: '120363315296139888@g.us', contacts: { resolve: () => [] } };

test('current chat is available without external-destination admin privilege', async () => {
    const result = await resolveDeliveryTarget({ ...base, senderJid: '5219999999999@s.whatsapp.net', scope: 'current_chat' });
    assert.deepEqual(result, { status: 'ready', target: { jid: '120363000000000001@g.us', name: 'este chat', isGroup: true, scope: 'current_chat' } });
});

test('main group requires admin or owner and uses only explicit configured group JID', async () => {
    const denied = await resolveDeliveryTarget({ ...base, scope: 'main_group' });
    assert.deepEqual(denied, { status: 'denied', reason: 'admin_required' });
    const allowed = await resolveDeliveryTarget({ ...base, senderJid: roles.owners[0], scope: 'main_group' });
    assert.equal(allowed.status, 'ready');
    if (allowed.status === 'ready') assert.equal(allowed.target.jid, base.mainGroupJid);
    const malformed = await resolveDeliveryTarget({ ...base, senderJid: roles.admins[0], scope: 'main_group', mainGroupJid: '120363315296139888' });
    assert.equal(malformed.status, 'needs_clarification');
});

test('missing scope and missing contact query ask for clarification without lookup', async () => {
    let calls = 0;
    const contacts = { resolve: () => { calls++; return []; } };
    assert.equal((await resolveDeliveryTarget({ ...base, contacts })).status, 'needs_clarification');
    const missingContact = await resolveDeliveryTarget({ ...base, senderJid: roles.admins[0], scope: 'contact', contacts });
    assert.equal(missingContact.status, 'needs_clarification');
    assert.equal(calls, 0);
});

test('contact lookup happens only for admins, and zero or multiple matches never choose a destination', async () => {
    let calls = 0;
    const contacts = { resolve: () => { calls++; return []; } };
    assert.equal((await resolveDeliveryTarget({ ...base, scope: 'contact', contactQuery: 'Fer', contacts })).status, 'denied');
    assert.equal(calls, 0);
    const notFound = await resolveDeliveryTarget({ ...base, senderJid: roles.admins[0], scope: 'contact', contactQuery: 'Fer', contacts });
    assert.equal(notFound.status, 'needs_clarification');
    const ambiguous = await resolveDeliveryTarget({ ...base, senderJid: roles.admins[0], scope: 'contact', contactQuery: 'Fer',
        contacts: { resolve: () => [{ jid: '5211111111111@s.whatsapp.net', name: 'Fernando' }, { jid: '5212222222222@s.whatsapp.net', name: 'Fer' }] } });
    assert.equal(ambiguous.status, 'needs_clarification');
    if (ambiguous.status === 'needs_clarification') assert.deepEqual(ambiguous.candidates, [{ name: 'Fernando', suffix: '1111' }, { name: 'Fer', suffix: '2222' }]);
});

test('contact result is normalized and sanitized; malformed, LID, and mismatched identities are discarded', async () => {
    const result = await resolveDeliveryTarget({ ...base, senderJid: roles.admins[0], scope: 'contact', contactQuery: 'Ana',
        contacts: { resolve: () => [
            { jid: '12345@lid', name: 'forged LID' },
            { jid: '5213333333333@s.whatsapp.net', name: 'bad group flag', isGroup: true },
            { jid: '5214444444444:3@c.us', name: ' Ana ', isGroup: false, secret: 'discard' }
        ] } });
    assert.deepEqual(result, { status: 'ready', target: { jid: '524444444444@s.whatsapp.net', name: 'Ana', isGroup: false, scope: 'contact' } });
});

test('current-chat LID remains LID and is never reinterpreted as a phone destination', async () => {
    const result = await resolveDeliveryTarget({ ...base, currentChatId: '12345@lid', senderJid: '12345@lid', scope: 'current_chat' });
    assert.equal(result.status, 'ready');
    if (result.status === 'ready') assert.equal(result.target.jid, '12345@lid');
});

test('authorized literal phone destinations bypass contact lookup; names containing digits do not', async () => {
    let lookups = 0;
    const contacts = { resolve: () => { lookups++; return []; } };
    const phone = await resolveDeliveryTarget({ ...base, senderJid: roles.admins[0], scope: 'contact', contactQuery: '+52 55 5555 5555', contacts });
    assert.equal(phone.status, 'ready');
    if (phone.status === 'ready') assert.equal(phone.target.jid, '525555555555@s.whatsapp.net');
    assert.equal(lookups, 0);
    const name = await resolveDeliveryTarget({ ...base, senderJid: roles.admins[0], scope: 'contact', contactQuery: 'Fer 2', contacts });
    assert.equal(name.status, 'needs_clarification');
    assert.equal(lookups, 1);
    const unauthorized = await resolveDeliveryTarget({ ...base, scope: 'contact', contactQuery: '5555555555', contacts });
    assert.equal(unauthorized.status, 'denied');
    assert.equal(lookups, 1, 'phone parsing must remain behind external-target authorization');
});
