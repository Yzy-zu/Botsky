#!/usr/bin/env node
'use strict';

// Read-only evidence audit. Imports only Node standard-library modules.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const problems = [];
const checks = [];
const requiredCategories = ['private', 'group', 'text', 'mention', 'quote-bot',
    'quote-human', 'image', 'audio', 'document', 'reaction', 'poll', 'fromMe'];
const categories = new Set([...requiredCategories, 'video', 'sticker', 'lid',
    'selection-quoted', 'selection-unquoted', 'image-quoted']);
const types = new Set(['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage',
    'audioMessage', 'documentMessage', 'documentWithCaptionMessage', 'stickerMessage',
    'reactionMessage', 'pollUpdateMessage', 'pollCreationMessage', 'pollCreationMessageV2',
    'pollCreationMessageV3', 'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2']);
const wrappers = new Set(['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']);
const mimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4',
    'audio/ogg', 'audio/ogg; codecs=opus', 'audio/mpeg', 'application/pdf']);
const reactionTokens = new Set(['👍', '👎', '✅', '👀', '❤️', '😂', '']);
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const safeJid = value => typeof value === 'string' && /^(?:1999555\d{4}@s\.whatsapp\.net|120363000000\d{6}@g\.us|990000000\d{6}@lid)$/.test(value);
const safeId = value => typeof value === 'string' && /^SYNTH-MESSAGE-[1-9]\d*$/.test(value);
const safeText = value => typeof value === 'string' && (value === '' || /^Texto sintético [1-9]\d*$/.test(value));
const meaningful = value => typeof value === 'string' && value.trim().length >= 3 && value.length <= 512;
const nonFake = value => meaningful(value) && !/(?:synthetic|sint[eé]tic|mock|fake|fixture|pending|pendiente|todo|example|placeholder)/i.test(value);
function utc(value) {
    return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) &&
        Number.isFinite(Date.parse(value)) && Date.parse(value) >= Date.UTC(2000, 0, 1) &&
        Date.parse(value) <= Date.now() + 300000 && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
}
function fail(label, reason) { problems.push(`${label}: ${reason}`); }
function read(relative) {
    try {
        const requested = path.resolve(root, relative);
        const resolved = fs.realpathSync(requested);
        if (resolved !== requested || !resolved.startsWith(root + path.sep)) throw new Error('unsafe evidence path');
        return fs.readFileSync(resolved, 'utf8');
    }
    catch { fail(relative, 'missing or unreadable evidence'); return null; }
}
function json(relative) {
    const source = read(relative);
    if (source === null) return null;
    try { return JSON.parse(source); }
    catch { fail(relative, 'invalid JSON'); return null; }
}
function exactKeys(value, allowed, label) {
    if (!object(value)) throw new Error(`${label}: expected object`);
    if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${label}: unexpected field (not in anonymizer allowlist)`);
}
function field(value, predicate, label) {
    if (!predicate(value)) throw new Error(`${label}: invalid or non-anonymized value`);
}
function key(value, label) {
    exactKeys(value, ['remoteJid', 'participant', 'remoteJidAlt', 'participantAlt', 'participantPn', 'senderPn', 'id', 'fromMe', 'addressingMode'], label);
    for (const name of ['remoteJid', 'participant', 'remoteJidAlt', 'participantAlt', 'participantPn', 'senderPn']) {
        if (name in value) field(value[name], v => safeJid(v) || (name !== 'remoteJid' && v === ''), label);
    }
    if ('id' in value) field(value.id, safeId, label);
    if ('fromMe' in value) field(value.fromMe, v => typeof v === 'boolean', label);
    if ('addressingMode' in value) field(value.addressingMode, v => v === 'lid' || v === 'pn', label);
}
function vote(value, label) {
    exactKeys(value, ['selectedOptions', 'options'], label);
    for (const name of ['selectedOptions', 'options']) {
        if (!(name in value)) continue;
        field(value[name], Array.isArray, label);
        for (const option of value[name]) {
            if (typeof option === 'string') field(option, safeText, label);
            else { exactKeys(option, ['name'], label); field(option.name, safeText, label); }
        }
    }
}
function context(value, depth, label) {
    exactKeys(value, ['participant', 'remoteJid', 'stanzaId', 'mentionedJid', 'quotedMessage'], label);
    for (const name of ['participant', 'remoteJid']) if (name in value) field(value[name], safeJid, label);
    if ('stanzaId' in value) field(value.stanzaId, safeId, label);
    if ('mentionedJid' in value) field(value.mentionedJid, v => Array.isArray(v) && v.every(safeJid), label);
    if ('quotedMessage' in value) message(value.quotedMessage, depth + 1, label);
}
function reaction(value, depth, label) {
    exactKeys(value, ['key', 'text', 'contextInfo'], label);
    if ('key' in value) key(value.key, label);
    if ('text' in value) field(value.text, v => reactionTokens.has(v) || safeText(v), label);
    if ('contextInfo' in value) context(value.contextInfo, depth, label);
}
function poll(value, depth, label) {
    exactKeys(value, ['pollCreationMessageKey', 'vote', 'contextInfo'], label);
    if ('pollCreationMessageKey' in value) key(value.pollCreationMessageKey, label);
    if ('vote' in value) vote(value.vote, label);
    if ('contextInfo' in value) context(value.contextInfo, depth, label);
}
function message(value, depth = 0, label = 'message') {
    if (depth > 8) throw new Error(`${label}: excessive nesting`);
    exactKeys(value, [...types], label);
    for (const [type, body] of Object.entries(value)) {
        if (type === 'conversation') { field(body, safeText, label); continue; }
        if (wrappers.has(type)) {
            exactKeys(body, ['message', 'contextInfo'], label);
            message(body.message, depth + 1, label);
        } else if (type === 'reactionMessage') { reaction(body, depth, label); continue; }
        else if (type === 'pollUpdateMessage') { poll(body, depth, label); continue; }
        else if (type.startsWith('pollCreationMessage')) {
            exactKeys(body, ['name', 'options', 'selectableOptionsCount', 'contextInfo'], label);
            if ('name' in body) field(body.name, safeText, label);
            if ('options' in body) vote({ options: body.options }, label);
            field(body.selectableOptionsCount, v => v === 1, label);
        } else {
            exactKeys(body, ['text', 'caption', 'url', 'mimetype', 'fileName', 'ptt', 'contextInfo'], label);
            for (const name of ['text', 'caption']) if (name in body) field(body[name], safeText, label);
            if ('url' in body) field(body.url, v => typeof v === 'string' && /^https:\/\/media\.example\.invalid\/synthetic-[1-9]\d*$/.test(v), label);
            if ('mimetype' in body) field(body.mimetype, v => mimeTypes.has(v), label);
            if ('fileName' in body) field(body.fileName, v => v === 'synthetic-document.pdf' || v === 'synthetic-file.bin', label);
            if ('ptt' in body) field(body.ptt, v => typeof v === 'boolean', label);
        }
        if ('contextInfo' in body) context(body.contextInfo, depth, label);
    }
}
function payload(value, label) {
    exactKeys(value, ['event', 'instance', 'data'], label);
    field(value.event, v => v === 'messages.upsert' || v === 'send.message', label);
    field(value.instance, v => v === 'synthetic-instance', label);
    exactKeys(value.data, ['key', 'message', 'pushName', 'messageType', 'participant', 'participantAlt',
        'senderPn', 'participantPn', 'sender', 'contextInfo', 'reactionMessage', 'pollUpdateMessage', 'vote'], label);
    key(value.data.key, label);
    field(value.data.key.remoteJid, safeJid, label);
    field(value.data.key.id, safeId, label);
    field(value.data.key.fromMe, v => typeof v === 'boolean', label);
    if (value.event === 'send.message') field(value.data.key.fromMe, v => v === true, label);
    message(value.data.message, 0, label);
    if (!Object.keys(value.data.message).length) throw new Error(`${label}: empty message`);
    if ('pushName' in value.data) field(value.data.pushName, v => v === 'Persona Sintética', label);
    if ('messageType' in value.data) field(value.data.messageType, v => types.has(v), label);
    for (const name of ['participant', 'participantAlt', 'senderPn', 'participantPn', 'sender']) {
            if (name in value.data) field(value.data[name], v => v === '' || safeJid(v), label);
    }
    if ('contextInfo' in value.data) context(value.data.contextInfo, 0, label);
    if ('reactionMessage' in value.data) reaction(value.data.reactionMessage, 0, label);
    if ('pollUpdateMessage' in value.data) poll(value.data.pollUpdateMessage, 0, label);
    if ('vote' in value.data) vote(value.data.vote, label);
}
function observed(value, fixture, manifest) {
    const botJid = fixture.botJid || manifest.botJid;
    const botJids = new Set([botJid, ...(fixture.botJids || manifest.botJids || [])].filter(Boolean));
    const outboundIds = fixture.botOutboundIds || manifest.botOutboundIds || [];
    const found = new Set();
    const group = value.data.key.remoteJid.endsWith('@g.us');
    found.add(group ? 'group' : 'private');
    if (value.data.key.fromMe === true) found.add('fromMe');
    if (Object.values(value.data.key).some(v => typeof v === 'string' && v.endsWith('@lid'))) found.add('lid');
    function ctx(v) {
        if (!object(v)) return;
        if (Array.isArray(v.mentionedJid) && v.mentionedJid.length) found.add('mention');
        if (v.quotedMessage && v.stanzaId && v.participant) {
            const proof = fixture.provenance;
            const identityBot = proof.quoteEvidence === 'exact-bot-identity' && botJids.has(v.participant);
            const outboundBot = proof.quoteEvidence === 'observed-outbound-id' && outboundIds.includes(v.stanzaId);
            const domain = v.participant.split('@')[1];
            const botDomainKnown = [...botJids].some(jid => jid.split('@')[1] === domain);
            const identityHuman = proof.quoteHumanEvidence === 'known-bot-different-participant' && botDomainKnown && !botJids.has(v.participant) && !outboundIds.includes(v.stanzaId);
            if (identityBot || outboundBot) found.add('quote-bot');
            else if (identityHuman) found.add('quote-human');
            if (v.quotedMessage.imageMessage) found.add('image-quoted');
        }
    }
    function scan(v) {
        for (const [type, body] of Object.entries(v)) {
            if (type === 'conversation') { found.add('text'); continue; }
            ctx(body.contextInfo);
            if (wrappers.has(type)) { scan(body.message); continue; }
            const map = { extendedTextMessage: 'text', imageMessage: 'image', audioMessage: 'audio',
                documentMessage: 'document', videoMessage: 'video', stickerMessage: 'sticker', reactionMessage: 'reaction' };
            if (map[type]) found.add(map[type]);
            if (type.startsWith('poll')) found.add('poll');
        }
    }
    scan(value.data.message); ctx(value.data.contextInfo);
    if (value.data.reactionMessage) found.add('reaction');
    if (value.data.pollUpdateMessage || value.data.vote) found.add('poll');
    // Sanitization deliberately removes selection text: no invented proof for
    // selection categories. They require a separate semantic fixture later.
    return found;
}
function baseline() {
    const doc = read('docs/refactor/baseline.md');
    if (!doc) return;
    const metrics = [ ['Tests reportados por Node', 795], ['Pass', 608], ['Fail', 187], ['Exit code', 1] ];
    for (const [name, expected] of metrics) {
        const row = doc.split('\n').find(line => line.includes(`| ${name} |`));
        if (!row || Number(row.split('|')[2].trim()) !== expected) fail('baseline', `missing final metric ${name}`);
    }
    if (!/\| Cancelled \/ skipped \/ todo \| 0 \/ 0 \/ 0 \|/.test(doc)) fail('baseline', 'missing zero cancelled/skipped/todo');
    if (!doc.includes('110067.876698') || !doc.includes('v20.20.2') || !doc.includes('ARM64')) fail('baseline', 'missing final runtime/duration');
    const failures = read('docs/refactor/baseline-failures.md');
    if (!failures || !failures.includes('038ef53fc12e924fe0e7a0baad551fca75c1b786f1f62929f7f3315974d0da83') ||
        failures.split('\n').filter(line => line.startsWith('| BF-')).length !== 187) fail('baseline', 'missing final failure evidence');
    checks.push('Final baseline documented (suite red is recorded, not hidden).');
}
function traceability() {
    const doc = read('docs/refactor/test-traceability.md');
    if (!doc) return;
    const rows = doc.split('\n').filter(line => line.startsWith('| TR-'));
    const ids = new Set();
    for (const row of rows) {
        const cells = row.split(/(?<!\\)\|/).slice(1, -1).map(v => v.trim());
        if (cells.length !== 6 || cells.some(v => !v)) { fail('traceability', 'empty or malformed row'); continue; }
        if (!/^TR-\d{4}$/.test(cells[0]) || ids.has(cells[0])) fail('traceability', 'invalid or duplicate ID');
        ids.add(cells[0]);
    }
    if (rows.length !== 804 || ids.size !== 804) fail('traceability', 'expected 804 unique complete rows');
    const sections = doc.match(/^## test\/.+\.test\.js$/gm) || [];
    if (sections.length !== 72 || new Set(sections).size !== 72 ||
        (doc.match(/Destino de tests propuesto: `tests\//g) || []).length !== 72) fail('traceability', 'missing file/destination coverage');
    checks.push('Traceability checked; pending states are allowed in Phase 0 only.');
}
function fixtures() {
    const relative = 'tests/fixtures/webhooks/real/manifest.json';
    const m = json(relative);
    if (!m) return;
    try {
        field(m.version, v => v === 1, 'real manifest');
        if ('botJid' in m) field(m.botJid, safeJid, 'real manifest bot alias');
        if ('botJids' in m) field(m.botJids, v => Array.isArray(v) && v.length > 0 && v.every(safeJid), 'real manifest bot aliases');
        if ('botOutboundIds' in m) field(m.botOutboundIds, v => Array.isArray(v) && v.every(safeId), 'real manifest outbound aliases');
        field(m.provenance, object, 'real manifest provenance');
        field(m.provenance.source, v => v === 'production-webhook', 'real manifest source');
        field(m.provenance.capturedUtc, utc, 'real manifest capture date');
        field(m.provenance.captureMethod, nonFake, 'real manifest capture method');
        field(m.provenance.evolutionVersion, meaningful, 'real manifest Evolution version');
        field(m.provenance.anonymizer, v => v === 'scripts/refactor/anonymize-webhook.cjs', 'real manifest anonymizer');
        field(m.fixtures, Array.isArray, 'real manifest fixtures');
        if (m.fixtures.length < 12) throw new Error('expected at least 12 real webhook samples');
    } catch (error) { fail(relative, error.message); return; }
    const coverage = new Set(); const files = new Set(); const ids = new Set(); const captures = new Set();
    for (const fixture of m.fixtures) {
        try {
            field(fixture.id, v => typeof v === 'string' && /^[a-z0-9-]{3,80}$/.test(v), 'fixture id');
            if (ids.has(fixture.id)) throw new Error('duplicate fixture id');
            ids.add(fixture.id);
            field(fixture.file, v => typeof v === 'string' && /^[a-z0-9-]+\.json$/.test(v), 'fixture path');
            if (files.has(fixture.file)) throw new Error('duplicate fixture file');
            files.add(fixture.file);
            const file = `tests/fixtures/webhooks/real/${fixture.file}`;
            const resolved = fs.realpathSync(path.join(root, file));
            if (!resolved.startsWith(fs.realpathSync(path.join(root, 'tests/fixtures/webhooks/real')) + path.sep)) throw new Error('fixture escapes real directory');
            field(fixture.provenance, object, 'fixture provenance');
            field(fixture.provenance.source, v => v === 'production-webhook', 'fixture source');
            field(fixture.provenance.capturedUtc, utc, 'fixture capture date');
            field(fixture.provenance.captureId, v => typeof v === 'string' && /^capture-[a-zA-Z0-9-]{3,80}$/.test(v), 'fixture capture ID');
            if (captures.has(fixture.provenance.captureId)) throw new Error('duplicate capture ID');
            captures.add(fixture.provenance.captureId);
            if ('botJid' in fixture) field(fixture.botJid, safeJid, 'fixture bot alias');
            if ('botJids' in fixture) field(fixture.botJids, v => Array.isArray(v) && v.length > 0 && v.every(safeJid), 'fixture bot aliases');
            if ('botOutboundIds' in fixture) field(fixture.botOutboundIds, v => Array.isArray(v) && v.every(safeId), 'fixture outbound aliases');
            field(fixture.categories, v => Array.isArray(v) && v.length > 0 && new Set(v).size === v.length && v.every(c => categories.has(c)), 'fixture categories');
            const data = json(file);
            if (!data) continue;
            payload(data, fixture.id);
            const actual = observed(data, fixture, m);
            for (const category of fixture.categories) {
                if (!actual.has(category)) throw new Error('category not supported by payload evidence');
            }
            for (const category of fixture.categories) coverage.add(category);
        } catch (error) { fail('real fixture', error.code ? 'missing/unreadable fixture path' : error.message); }
    }
    for (const required of requiredCategories) if (!coverage.has(required)) fail('real fixture coverage', `missing ${required}`);
    if (coverage.size < 12) fail('real fixture coverage', 'fewer than 12 distinct observed/documented categories');
    checks.push(`Real fixture categories observed: ${coverage.size}; synthetic manifest is excluded.`);
}
function telemetry() {
    const relative = 'docs/refactor/telemetry-evidence.json';
    const evidence = json(relative);
    if (!evidence) return;
    if (evidence.active !== true) fail('telemetry', 'explicit active:true evidence required');
    if (!utc(evidence.startUtc)) fail('telemetry', 'valid actual startUtc required');
    if (!nonFake(evidence.source)) fail('telemetry', 'actual non-placeholder operational source required');
    if (!(nonFake(evidence.scope) || (object(evidence.scope) && nonFake(evidence.scope.description)))) fail('telemetry', 'documented operational scope required');
    for (const name of ['explicit', 'natural', 'tool']) {
        if (evidence.coverage?.[name] !== true) fail('telemetry', `coverage ${name}:true evidence required`);
    }
    checks.push('Telemetry activation evidence checked; seven-day observation is ideal, not a Phase 0 blocker.');
}
function main() {
    if (process.argv.length > 2) { process.stderr.write('Usage: node scripts/refactor/verify-phase0.cjs\n'); process.exitCode = 2; return; }
    baseline(); traceability();
    for (const file of ['docs/adr/001-javascript-checkjs.md', 'docs/adr/002-sqlite.md', 'docs/refactor/PROGRESS.md']) {
        const doc = read(file); if (doc !== null && doc.trim().length < 80) fail(file, 'evidence document empty/incomplete');
    }
    fixtures(); telemetry();
    for (const check of checks) process.stdout.write(`CHECK ${check}\n`);
    for (const problem of problems) process.stdout.write(`GAP ${problem}\n`);
    process.stdout.write(`Gate 0: ${problems.length ? 'OPEN' : 'PASS'} (${problems.length} gaps). Evidence documents attest provenance; this audit does not independently prove capture or activation.\n`);
    process.exitCode = problems.length ? 1 : 0;
}
if (require.main === module) main();
module.exports = { main, validateAnonymizedWebhook: payload, observedCategories: observed };
