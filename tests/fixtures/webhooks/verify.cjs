'use strict';

// Validate synthetic payloads with only the two pure legacy extraction functions.
// Never require message_normalizer: its dependency graph starts jobs and opens DBs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const source = fs.readFileSync(path.resolve(root, '../../../src/core/message_normalizer.js'), 'utf8');
const mediaTypes = source.match(/const MEDIA_TYPES = (\[[\s\S]*?\]);/);
assert.ok(mediaTypes, 'Legacy MEDIA_TYPES declaration must be present');
const start = source.indexOf('function extractText(message) {');
const end = source.indexOf('function getCachedMediaById(messageId) {', start);
assert.ok(start >= 0 && end > start, 'Pure extractor boundaries must be present');
const extraction = vm.runInNewContext(
    `const MEDIA_TYPES = ${mediaTypes[1]};\n${source.slice(start, end)}\n({ extractText, detectMessageType });`,
    {}, { timeout: 1000 }
);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.ok(manifest.provenance.startsWith('synthetic;'));
assert.ok(manifest.fixtures.length >= 12);
const ids = new Set();
for (const fixture of manifest.fixtures) {
    assert.equal(fixture.source, 'synthetic');
    assert.match(fixture.file, /^\d\d-[a-z-]+\.json$/);
    const body = JSON.parse(fs.readFileSync(path.join(root, fixture.file), 'utf8'));
    assert.equal(body.event, 'messages.upsert');
    assert.equal(body.instance, 'fixture-instance');
    assert.match(body.data.key.id, /^SYNTH-/);
    assert.equal(ids.has(body.data.key.id), false, 'Unique message IDs');
    ids.add(body.data.key.id);
    assert.equal(extraction.extractText(body.data.message), fixture.expectedExtraction.text, fixture.id);
    assert.equal(body.data.messageType || extraction.detectMessageType(body.data.message), fixture.expectedExtraction.messageType, fixture.id);
}
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).data;
const botQuote = read('04-group-quote-bot.json').message.extendedTextMessage.contextInfo;
const humanQuote = read('05-group-quote-human-same-text.json').message.extendedTextMessage.contextInfo;
assert.equal(botQuote.quotedMessage.conversation, humanQuote.quotedMessage.conversation);
assert.notEqual(botQuote.participant, humanQuote.participant);
assert.notEqual(botQuote.stanzaId, humanQuote.stanzaId);
assert.equal(botQuote.participant, manifest.botJid);
assert.ok(manifest.botOutboundIds.includes(botQuote.stanzaId));
assert.equal(manifest.botOutboundIds.includes(humanQuote.stanzaId), false);
assert.equal(read('12-group-from-me-echo.json').key.fromMe, true);
const lid = read('13-group-lid-participant-alt.json').key;
assert.ok(lid.participant.endsWith('@lid'));
assert.equal(lid.participantAlt, manifest.userJid);
assert.equal(read('14-group-selection-quoted.json').message.extendedTextMessage.text, '2');
assert.equal(read('15-group-selection-unquoted.json').message.conversation, '2');
console.log(`${manifest.fixtures.length} synthetic webhook fixtures validated; real-capture evidence pending.`);
