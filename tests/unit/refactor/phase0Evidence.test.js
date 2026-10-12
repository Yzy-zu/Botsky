'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { anonymizeWebhook } = require('../../../scripts/refactor/anonymize-webhook.cjs');
const { validateAnonymizedWebhook, observedCategories } = require('../../../scripts/refactor/verify-phase0.cjs');

function sample() {
    return anonymizeWebhook({ event: 'messages.upsert', data: {
        key: { id: 'input-message', remoteJid: '19995550000@s.whatsapp.net', fromMe: false },
        message: { imageMessage: { caption: '', mimetype: 'image/jpeg', url: 'https://private.invalid/original' } }
    } });
}
test('real bare-media captures retain blank captions without inventing an instruction', () => {
    const data = sample();
    assert.equal(data.data.message.imageMessage.caption, '');
    assert.doesNotThrow(() => validateAnonymizedWebhook(data, 'capture'));
});

test('Phase 0 mention coverage accepts human mentions without claiming bot addressing', () => {
    const data = sample();
    data.data.contextInfo = { mentionedJid: ['19995550007@s.whatsapp.net'] };
    const fixture = { botJid: '19995550003@s.whatsapp.net' };
    assert.equal(observedCategories(data, fixture, {}).has('mention'), true);
    assert.equal(observedCategories(data, fixture, {}).has('quote-bot'), false);
});

test('human quote evidence requires a trusted bot alias in the same identity domain', () => {
    const data = sample();
    data.data.contextInfo = { participant: '990000000000002@lid', stanzaId: 'SYNTH-MESSAGE-2', quotedMessage: { conversation: 'Texto sintético 1' } };
    const fixture = { botJid: '19995550003@s.whatsapp.net', provenance: { quoteHumanEvidence: 'known-bot-different-participant' } };
    assert.equal(observedCategories(data, fixture, {}).has('quote-human'), false);
    fixture.botJids = [fixture.botJid, '990000000000004@lid'];
    assert.equal(observedCategories(data, fixture, {}).has('quote-human'), true);
});
test('evidence validator refuses private text, metadata and media credentials before import', () => {
    for (const mutate of [
        data => { data.data.message.imageMessage.caption = 'PRIVATE_CONTENT'; },
        data => { data.headers = { authorization: 'PRIVATE_TOKEN' }; },
        data => { data.data.message.imageMessage.mediaKey = 'PRIVATE_KEY'; }
    ]) {
        const data = sample(); mutate(data);
        assert.throws(() => validateAnonymizedWebhook(data, 'capture'));
    }
});
