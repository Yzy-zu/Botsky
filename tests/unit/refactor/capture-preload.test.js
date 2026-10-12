'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { installCapture, classifyEnvelope, optionsFromEnv } = require('../../../scripts/refactor/capture-preload.cjs');

function payload(message = { conversation: 'PRIVATE_MESSAGE_TEXT' }, key = {}) {
    return { event: 'messages.upsert', instance: 'PRIVATE_INSTANCE', data: {
        key: { remoteJid: '551234567890@s.whatsapp.net', id: 'PRIVATE_MESSAGE_ID', fromMe: false, ...key },
        pushName: 'PRIVATE_NAME', message
    }, apiKey: 'PRIVATE_API_KEY' };
}
async function harness(t, options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'botsky-capture-test-'));
    const original = http.Server.prototype.emit;
    const controller = installCapture({ enabled: true, directory, limit: 20, durationMs: 2000, ...options });
    const bodies = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            bodies.push(body);
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end(body);
        });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        controller.stop();
        await controller.flush();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(directory, { recursive: true, force: true });
        assert.equal(http.Server.prototype.emit, original);
    });
    async function post(value, target = '/webhook') {
        const raw = typeof value === 'string' ? value : JSON.stringify(value);
        const result = await new Promise((resolve, reject) => {
            const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: target,
                method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'PRIVATE_HEADER_SECRET' } }, res => {
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => resolve({ status: res.statusCode, body }));
            });
            req.on('error', reject);
            req.end(raw);
        });
        await controller.flush();
        return result;
    }
    const files = () => fs.readdirSync(directory).map(name => ({ name, fullPath: path.join(directory, name),
        record: JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) }));
    return { directory, controller, post, files, bodies, original };
}

test('Disabled observer performs no hook or filesystem changes', () => {
    const before = http.Server.prototype.emit;
    const nonexistent = path.join(os.tmpdir(), `capture-disabled-${process.pid}-${Date.now()}`);
    const capture = installCapture({ enabled: false, directory: nonexistent });
    assert.equal(capture.active, false);
    assert.equal(http.Server.prototype.emit, before);
    assert.equal(fs.existsSync(nonexistent), false);
    capture.stop();
    assert.deepEqual(optionsFromEnv({ REFRACTOR_CAPTURE_ENABLED: '0' }).enabled, false);
    assert.equal(optionsFromEnv({ REFRACTOR_CAPTURE_ENABLED: '1', REFRACTOR_CAPTURE_LIMIT: '12', REFRACTOR_CAPTURE_DURATION: '2000' }).limit, 12);
});

test('Live HTTP body and response remain byte-for-byte unchanged; only sanitized bytes reach disk', async t => {
    const h = await harness(t);
    const input = payload({ imageMessage: { caption: 'PRIVATE_ADDRESS', mimetype: 'image/jpeg',
        url: 'https://PRIVATE_HOST/file?token=PRIVATE_TOKEN', mediaKey: 'PRIVATE_MEDIA_KEY',
        jpegThumbnail: 'PRIVATE_THUMBNAIL', base64: 'PRIVATE_BYTES' } });
    const raw = `  ${JSON.stringify(input)}\n`;
    const response = await h.post(raw);
    assert.deepEqual(response, { status: 200, body: raw });
    assert.equal(h.bodies[0], raw);
    assert.equal(h.files().length, 1);
    const file = h.files()[0];
    const persisted = fs.readFileSync(file.fullPath, 'utf8');
    assert.equal(persisted.includes('PRIVATE_'), false);
    assert.equal(persisted.includes('551234567890'), false);
    assert.equal(persisted.includes('PRIVATE_HEADER_SECRET'), false);
    assert.equal(file.record.capture.provenance, 'real-anonymized');
    assert.equal(file.record.capture.source, 'live-http');
    assert.equal(file.record.capture.contentProvenance, 'synthetic-replacements');
    assert.deepEqual(file.record.capture.categories, ['image', 'private']);
    assert.equal(fs.statSync(h.directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(file.fullPath).mode & 0o777, 0o600);
});

test('Malformed, unrelated and oversized requests do not persist and keep flowing to application', async t => {
    const h = await harness(t, { maxBytes: 512 });
    const malformed = '{PRIVATE_BROKEN_JSON';
    assert.equal((await h.post(malformed)).body, malformed);
    await h.post({ event: 'connection.update', data: {} });
    await h.post(payload(), '/other');
    const large = JSON.stringify(payload({ conversation: 'PRIVATE_'.repeat(200) }));
    assert.equal((await h.post(large)).body, large);
    assert.equal(h.files().length, 0);
    assert.equal(h.controller.stats.malformed, 1);
    assert.equal(h.controller.stats.oversize, 1);
    assert.equal(h.controller.stats.skipped, 1);
});

test('Count limit stops observer and restores HTTP emitter while requests still succeed', async t => {
    const h = await harness(t, { limit: 1 });
    await h.post(payload());
    assert.equal(h.controller.active, false);
    assert.equal(http.Server.prototype.emit, h.original);
    await h.post(payload({ conversation: 'PRIVATE_SECOND_MESSAGE' }));
    assert.equal(h.files().length, 1);
    assert.equal(h.controller.stats.accepted, 1);
    assert.equal(h.controller.stats.persisted, 1);
});

test('Deadline stops without capturing a request after expiry', async t => {
    let now = 1000;
    const h = await harness(t, { durationMs: 1000, now: () => now });
    now = 2000;
    await h.post(payload());
    assert.equal(h.controller.active, false);
    assert.equal(http.Server.prototype.emit, h.original);
    assert.equal(h.files().length, 0);
});

test('Timer disables idle observer independently of incoming requests', async t => {
    const h = await harness(t, { durationMs: 25 });
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(h.controller.active, false);
    assert.equal(http.Server.prototype.emit, h.original);
});

test('Quote classification requires bot identity or an outgoing ID observed in the same chat', async t => {
    const group = '120363999999999999@g.us';
    const bot = '551111111111@s.whatsapp.net';
    const human = '552222222222@s.whatsapp.net';
    const quote = participant => payload({ extendedTextMessage: { text: 'PRIVATE_REQUEST', contextInfo: {
        participant, stanzaId: 'PRIVATE_OUTGOING', mentionedJid: [bot], quotedMessage: { conversation: 'PRIVATE_SAME_TEXT' }
    } } }, { remoteJid: group, participant: human });
    const unknown = classifyEnvelope(quote(bot));
    assert.ok(unknown.includes('quote-unknown'));
    assert.equal(unknown.includes('quote-bot'), false);
    assert.ok(classifyEnvelope(quote(bot), { botNumber: '551111111111' }).includes('quote-bot'));
    assert.ok(classifyEnvelope(quote(human), { botNumber: '551111111111' }).includes('quote-human'));
    assert.ok(classifyEnvelope(quote('PRIVATE_PARTICIPANT@lid'), { botNumber: '551111111111' }).includes('quote-unknown'));
    const h = await harness(t);
    await h.post(payload({ conversation: 'PRIVATE_OUTGOING_TEXT' }, { remoteJid: group, id: 'PRIVATE_OUTGOING', fromMe: true }));
    await h.post(quote(bot));
    const records = h.files().sort((a, b) => a.name.localeCompare(b.name));
    assert.ok(records[0].record.capture.categories.includes('fromMe'));
    assert.ok(records[1].record.capture.categories.includes('quote-bot'));
    assert.equal(JSON.stringify(records).includes('PRIVATE_'), false);
});


test('Dedicated bot JID overrides BOT_NUMBER and is persisted only through the same synthetic mapping', async t => {
    const botJid = '5215512345678@s.whatsapp.net';
    const h = await harness(t, { botJid: '525512345678@s.whatsapp.net', botNumber: '199900000000' });
    await h.post(payload({ extendedTextMessage: { text: 'PRIVATE_QUOTE_REQUEST', contextInfo: {
        participant: botJid, stanzaId: 'PRIVATE_BOT_ID', mentionedJid: [botJid],
        quotedMessage: { conversation: 'PRIVATE_BOT_TEXT' }
    } } }, { remoteJid: '120363999999999999@g.us' }));
    const record = h.files()[0].record;
    assert.ok(record.capture.categories.includes('quote-bot'));
    assert.ok(record.capture.categories.includes('mention-bot'));
    assert.equal(record.capture.botJid, record.webhook.data.message.extendedTextMessage.contextInfo.participant);
    assert.equal(record.capture.botJid, record.webhook.data.message.extendedTextMessage.contextInfo.mentionedJid[0]);
    assert.equal(JSON.stringify(record).includes('5512345678'), false);
    assert.equal(optionsFromEnv({ REFRACTOR_CAPTURE_BOT_JID: botJid }).botJid, botJid);
});


test('Optional category dedupe preserves request bodies, ignores repeated chatter and captures rare categories', async t => {
    const h = await harness(t, { deduplicate: true });
    const first = payload({ conversation: 'PRIVATE_FIRST_TEXT' });
    const second = payload({ conversation: 'PRIVATE_DIFFERENT_TEXT' }, { id: 'PRIVATE_OTHER_ID' });
    assert.equal((await h.post(first)).body, JSON.stringify(first));
    assert.equal((await h.post(second)).body, JSON.stringify(second));
    assert.equal(h.files().length, 1);
    assert.equal(h.controller.stats.accepted, 1);
    assert.equal(h.controller.stats.duplicates, 1);
    const rare = payload({ audioMessage: { mimetype: 'audio/ogg', ptt: true } });
    assert.equal((await h.post(rare)).body, JSON.stringify(rare));
    assert.equal(h.files().length, 2);
    assert.equal(h.controller.stats.accepted, 2);
    const lid = payload({ conversation: 'PRIVATE_LID_TEXT' }, { participant: '991111111111@lid', participantAlt: '551234567890@s.whatsapp.net' });
    await h.post(lid);
    assert.equal(h.files().length, 3);
    const serialized = JSON.stringify(h.files().map(file => file.record));
    assert.equal(serialized.includes('PRIVATE_'), false);
    assert.equal(serialized.includes('991111111111'), false);
    assert.equal(optionsFromEnv({ REFRACTOR_CAPTURE_DEDUPE: 'true' }).deduplicate, true);
    assert.equal(optionsFromEnv({}).deduplicate, false);
});

test('Deduplicated outgoing events still seed quote evidence for subsequently captured messages', async t => {
    const h = await harness(t, { deduplicate: true });
    const group = '120363999999999999@g.us';
    for (const id of ['PRIVATE_OUTGOING_ONE', 'PRIVATE_OUTGOING_TWO']) {
        await h.post(payload({ conversation: 'PRIVATE_SAME_CATEGORY' }, { remoteJid: group, id, fromMe: true }));
    }
    assert.equal(h.files().length, 1);
    await h.post(payload({ extendedTextMessage: { text: 'PRIVATE_QUOTE', contextInfo: {
        participant: '551111111111@s.whatsapp.net', stanzaId: 'PRIVATE_OUTGOING_TWO',
        quotedMessage: { conversation: 'PRIVATE_RESPONSE' }
    } } }, { remoteJid: group }));
    assert.equal(h.files().length, 2);
    assert.ok(h.files().some(file => file.record.capture.categories.includes('quote-bot')));
});

test('Outbound notifications preserve send.message event and supply quote evidence even when deduplicated', async t => {
    const h = await harness(t, { deduplicate: true });
    const group = '120363999999999999@g.us';
    const sent = id => ({ ...payload({ conversation: 'PRIVATE_SEND_TEXT' }, { remoteJid: group, id, fromMe: true }), event: 'send.message' });
    const first = sent('PRIVATE_SENT_ONE');
    assert.equal((await h.post(first)).body, JSON.stringify(first));
    await h.post(sent('PRIVATE_SENT_TWO'));
    assert.equal(h.files().length, 1);
    const record = h.files()[0].record;
    assert.equal(record.webhook.event, 'send.message');
    assert.equal(record.webhook.data.key.fromMe, true);
    assert.ok(record.capture.categories.includes('outbound-notification'));
    assert.ok(record.capture.categories.includes('fromMe'));
    assert.equal(record.capture.source, 'live-http');
    const invalid = sent('PRIVATE_UNPROVEN_SENT');
    invalid.data.key.fromMe = false;
    await h.post(invalid);
    assert.equal(h.files().length, 1);
    assert.equal(h.controller.stats.skipped, 1);
    await h.post(payload({ extendedTextMessage: { text: 'PRIVATE_QUOTE', contextInfo: {
        stanzaId: 'PRIVATE_SENT_TWO', participant: '551111111111@s.whatsapp.net',
        quotedMessage: { conversation: 'PRIVATE_SENT_TEXT' }
    } } }, { remoteJid: group }));
    assert.equal(h.files().length, 2);
    assert.ok(h.files().some(file => file.record.capture.categories.includes('quote-bot')));
});

test('Trusted LID aliases prove mentions and quotes and are mapped consistently alongside PN metadata', async t => {
    const botPN = '551111111111@s.whatsapp.net';
    const botLID = '991111111111@lid';
    const humanLID = '992222222222@lid';
    const quote = participant => payload({ extendedTextMessage: { text: 'PRIVATE_LID_REQUEST', contextInfo: {
        participant, mentionedJid: [participant], stanzaId: 'PRIVATE_QUOTE_ID',
        quotedMessage: { conversation: 'PRIVATE_LID_SAME_TEXT' }
    } } }, { remoteJid: '120363999999999999@g.us', participant: humanLID });
    const options = { botJid: botPN, botAliases: [botPN, botLID] };
    assert.ok(classifyEnvelope(quote(botLID), options).includes('quote-bot'));
    assert.ok(classifyEnvelope(quote(botLID), options).includes('mention-bot'));
    assert.ok(classifyEnvelope(quote(humanLID), options).includes('quote-human'));
    assert.equal(classifyEnvelope(quote(humanLID), options).includes('mention-bot'), false);
    assert.ok(classifyEnvelope(quote(botLID), { botJid: botPN }).includes('quote-unknown'), 'PN-only identity cannot classify unknown LID as human');
    assert.equal(classifyEnvelope(quote(botLID), { botJid: botPN }).includes('quote-human'), false);
    assert.ok(classifyEnvelope(quote(botPN), { botAliases: [botLID] }).includes('quote-unknown'), 'LID-only identity cannot classify unknown PN as human');
    assert.ok(classifyEnvelope(quote(botLID)).includes('quote-unknown'));
    assert.equal(classifyEnvelope(quote(botLID)).includes('mention-bot'), false);
    const unknownAlias = classifyEnvelope(quote(botLID), { botAliases: ['not-a-valid-jid'] });
    assert.ok(unknownAlias.includes('quote-unknown'));
    assert.equal(unknownAlias.includes('mention-bot'), false);
    const deviceVariant = classifyEnvelope(quote('991111111111:2@lid'), options);
    assert.equal(deviceVariant.includes('quote-bot'), false, 'LID match is exact, including any device suffix');
    const h = await harness(t, options);
    await h.post(quote(botLID));
    await h.post(quote(humanLID));
    const records = h.files().sort((a, b) => a.name.localeCompare(b.name));
    const botRecord = records[0].record;
    const context = botRecord.webhook.data.message.extendedTextMessage.contextInfo;
    assert.equal(botRecord.capture.botJid, context.participant);
    assert.equal(botRecord.capture.botJid, context.mentionedJid[0]);
    assert.ok(botRecord.capture.botJids.includes(context.participant));
    assert.ok(botRecord.capture.botJids.some(jid => jid.endsWith('@s.whatsapp.net')));
    assert.ok(botRecord.capture.botJids.some(jid => jid.endsWith('@lid')));
    assert.ok(records[1].record.capture.categories.includes('quote-human'));
    const output = JSON.stringify(records.map(file => file.record));
    for (const privateValue of [botPN, botLID, humanLID, 'PRIVATE_']) assert.equal(output.includes(privateValue), false);
    assert.deepEqual(optionsFromEnv({ REFRACTOR_CAPTURE_BOT_ALIASES: JSON.stringify([botPN, botLID]) }).botAliases, [botPN, botLID]);
    assert.deepEqual(optionsFromEnv({ REFRACTOR_CAPTURE_BOT_ALIASES: `${botPN}, ${botLID}` }).botAliases, [botPN, botLID]);
});
