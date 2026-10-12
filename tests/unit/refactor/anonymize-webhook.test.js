'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { anonymizeWebhook } = require('../../../scripts/refactor/anonymize-webhook.cjs');

function envelope(message, key = {}) {
    return { event: 'messages.upsert', instance: 'PRIVATE_INSTANCE', data: {
        key: { remoteJid: '551234567890@s.whatsapp.net', id: 'PRIVATE_MESSAGE_ID', fromMe: false, ...key },
        pushName: 'PRIVATE_PERSON_NAME', message
    } };
}

test('Allowlist removes secrets, private media fields and arbitrary nested metadata', () => {
    const input = envelope({ imageMessage: {
        url: 'https://private-host.example/photo?token=PRIVATE_URL_TOKEN',
        caption: 'PRIVATE_ADDRESS_AND_TEXT', fileName: 'PRIVATE_FILENAME.jpg', mimetype: 'image/jpeg',
        mediaKey: 'PRIVATE_DECRYPTION_KEY', base64: 'PRIVATE_BYTES', jpegThumbnail: 'PRIVATE_THUMBNAIL',
        directPath: '/PRIVATE_PATH', metadata: { token: 'PRIVATE_NESTED_TOKEN' },
        contextInfo: { quotedMessage: { conversation: 'PRIVATE_QUOTED_TEXT', custom: 'PRIVATE_EXTRA' }, forwardingSecret: 'PRIVATE_FORWARD_SECRET' }
    } });
    input.apikey = 'PRIVATE_API_KEY';
    input.headers = { authorization: 'PRIVATE_BEARER' };
    input.data.device = 'PRIVATE_DEVICE';
    input.data.key.secret = 'PRIVATE_KEY_SECRET';
    const before = JSON.stringify(input);
    const result = anonymizeWebhook(input);
    const output = JSON.stringify(result);
    assert.equal(output.includes('PRIVATE_'), false);
    assert.equal(output.includes('551234567890'), false);
    assert.equal(output.includes('private-host.example'), false);
    assert.equal(JSON.stringify(input), before, 'Input remains unchanged');
    assert.deepEqual(Object.keys(result).sort(), ['data', 'event', 'instance']);
    assert.deepEqual(Object.keys(result.data.message.imageMessage).sort(), ['caption', 'contextInfo', 'fileName', 'mimetype', 'url']);
    assert.equal(result.data.message.imageMessage.mimetype, 'image/jpeg');
});

test('Batch mappings preserve mentions, quotes, outgoing IDs and same-text human distinction', () => {
    const bot = '551111111111@s.whatsapp.net';
    const human = '552222222222@s.whatsapp.net';
    const group = '120363999999999999@g.us';
    const outgoing = envelope({ conversation: 'PRIVATE_IDENTICAL_TEXT' }, { remoteJid: group, participant: bot, id: 'BOT_MESSAGE', fromMe: true });
    const quoted = (participant, stanzaId) => envelope({ extendedTextMessage: {
        text: 'PRIVATE_REQUEST', contextInfo: { mentionedJid: [bot], participant, stanzaId,
            quotedMessage: { conversation: 'PRIVATE_IDENTICAL_TEXT' } }
    } }, { remoteJid: group, participant: human });
    const [sent, botQuote, humanQuote] = anonymizeWebhook([outgoing, quoted(bot, 'BOT_MESSAGE'), quoted(human, 'HUMAN_MESSAGE')]);
    const a = botQuote.data.message.extendedTextMessage.contextInfo;
    const b = humanQuote.data.message.extendedTextMessage.contextInfo;
    assert.equal(sent.data.key.fromMe, true);
    assert.equal(a.stanzaId, sent.data.key.id);
    assert.equal(a.participant, sent.data.key.participant);
    assert.equal(a.mentionedJid[0], sent.data.key.participant);
    assert.equal(a.quotedMessage.conversation, sent.data.message.conversation);
    assert.equal(a.quotedMessage.conversation, b.quotedMessage.conversation);
    assert.notEqual(a.stanzaId, b.stanzaId);
    assert.notEqual(a.participant, b.participant);
    assert.equal(botQuote.data.key.remoteJid, sent.data.key.remoteJid);
    assert.ok(sent.data.key.remoteJid.endsWith('@g.us'));
});

test('LID participantAlt relationship survives without retaining either real identity', () => {
    const phone = '551111111111@s.whatsapp.net';
    const payload = envelope({ extendedTextMessage: { text: '/estado', contextInfo: { mentionedJid: [phone] } } }, {
        remoteJid: '120363999999999999@g.us', participant: '890123456789:2@lid', participantAlt: phone,
        addressingMode: 'lid', remoteJidAlt: '890123456700@lid', participantPn: phone, senderPn: phone
    });
    const result = anonymizeWebhook(payload);
    const key = result.data.key;
    assert.ok(key.participant.endsWith('@lid'));
    assert.ok(key.remoteJidAlt.endsWith('@lid'));
    assert.ok(key.participantAlt.endsWith('@s.whatsapp.net'));
    assert.equal(key.participantAlt, result.data.message.extendedTextMessage.contextInfo.mentionedJid[0]);
    assert.equal(key.addressingMode, 'lid');
    assert.equal(key.participantPn, key.participantAlt);
    assert.equal(key.senderPn, key.participantAlt);
    assert.equal(JSON.stringify(result).includes('551111111111'), false);
    assert.equal(JSON.stringify(result).includes('890123456789'), false);
});

test('Reaction targets and decoded poll options use coherent mappings; unknown fields omitted', () => {
    const target = envelope({ documentWithCaptionMessage: { message: { documentMessage: {
        mimetype: 'application/pdf', caption: 'PRIVATE_PDF_CAPTION', fileName: 'PRIVATE_STUDENT.pdf', mediaKey: [1, 2, 3]
    } } } });
    const reaction = envelope({ reactionMessage: { text: '👍', key: target.data.key, secret: 'PRIVATE_REACTION' } }, { id: 'REACTION_ID' });
    const poll = envelope({ pollUpdateMessage: { pollCreationMessageKey: target.data.key,
        vote: { selectedOptions: [{ name: 'PRIVATE_VOTE', secret: 'PRIVATE_OPTION_SECRET' }], encPayload: 'PRIVATE_ENCRYPTED_VOTE' } } }, { id: 'POLL_VOTE' });
    const [a, b, c] = anonymizeWebhook([target, reaction, poll]);
    assert.equal(b.data.message.reactionMessage.text, '👍');
    assert.equal(b.data.message.reactionMessage.key.id, a.data.key.id);
    assert.equal(c.data.message.pollUpdateMessage.pollCreationMessageKey.id, a.data.key.id);
    assert.equal(JSON.stringify([a, b, c]).includes('PRIVATE_'), false);
    assert.equal(a.data.message.documentWithCaptionMessage.message.documentMessage.fileName, 'synthetic-document.pdf');
    assert.deepEqual(anonymizeWebhook(envelope({ completelyUnknown: { conversation: 'PRIVATE_UNKNOWN' } })).data.message, {});
});

test('Mappings reset deterministically per call and avoid private MIME/messageType passthrough', () => {
    const input = envelope({ audioMessage: { mimetype: 'audio/PRIVATE_MIME', ptt: true, seconds: 234 } });
    input.data.messageType = 'PRIVATE_TYPE';
    const first = anonymizeWebhook(input);
    assert.deepEqual(first, anonymizeWebhook(input));
    assert.equal('messageType' in first.data, false);
    assert.deepEqual(first.data.message.audioMessage, { ptt: true });
    assert.throws(() => anonymizeWebhook({ event: 'PRIVATE_BAD_EVENT', data: {} }), /Expected messages.upsert/);
});

test('CLI emits JSON only on success and never echoes malformed input in diagnostics', () => {
    const cli = path.resolve(__dirname, '../../../scripts/refactor/anonymize-webhook.cjs');
    const good = spawnSync(process.execPath, [cli], { input: JSON.stringify(envelope({ conversation: 'PRIVATE_CLI_TEXT' })), encoding: 'utf8' });
    assert.equal(good.status, 0);
    assert.equal(good.stderr, '');
    assert.equal(JSON.parse(good.stdout).event, 'messages.upsert');
    assert.equal(good.stdout.includes('PRIVATE_'), false);
    const bad = spawnSync(process.execPath, [cli], { input: '{PRIVATE_SECRET_BROKEN_JSON', encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, '');
    assert.equal(bad.stderr.includes('PRIVATE_SECRET'), false);
});

test('Outgoing send.message retains its real event name and rejects unproven fromMe', () => {
    const outgoing = envelope({ conversation: 'PRIVATE_SENT_TEXT' }, { fromMe: true });
    outgoing.event = 'send.message';
    const result = anonymizeWebhook(outgoing);
    assert.equal(result.event, 'send.message');
    assert.equal(result.data.key.fromMe, true);
    assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
    outgoing.data.key.fromMe = false;
    assert.throws(() => anonymizeWebhook(outgoing), /outgoing send.message/);
    delete outgoing.data.key.fromMe;
    assert.throws(() => anonymizeWebhook(outgoing), /outgoing send.message/);
});
