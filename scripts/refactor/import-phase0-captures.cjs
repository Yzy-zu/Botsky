'use strict';
// Input is already anonymized by capture-preload; never import raw bodies/logs.
const fs = require('node:fs');
const path = require('node:path');
const { validateAnonymizedWebhook } = require('./verify-phase0.cjs');
const root = path.resolve(__dirname, '../..');
const source = '/tmp/botsky-phase0-captures';
const target = path.join(root, 'tests/fixtures/webhooks/real');
const allowed = new Set(['private', 'group', 'text', 'mention', 'quote-bot', 'quote-human',
    'image', 'audio', 'document', 'reaction', 'poll', 'fromMe', 'video', 'sticker', 'lid']);
const files = fs.existsSync(source) ? fs.readdirSync(source).filter(file => /^capture-[a-z0-9-]+\.json$/.test(file)).sort() : [];
if (!files.length) { console.log('No real production captures available yet.'); process.exit(1); }
fs.mkdirSync(target, { recursive: true });
const entries = [];
function contexts(value, result = [], depth = 0) {
    if (!value || typeof value !== 'object' || depth > 10) return result;
    if (value.quotedMessage || value.mentionedJid) result.push(value);
    for (const item of Object.values(value)) if (item && typeof item === 'object') contexts(item, result, depth + 1);
    return result;
}
for (const file of files) {
    const full = path.join(source, file);
    const record = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (record.capture?.provenance !== 'real-anonymized' || record.capture.source !== 'live-http'
        || !record.webhook?.data?.message || !Object.keys(record.webhook.data.message).length) continue;
    validateAnonymizedWebhook(record.webhook, 'production capture');
    const captureId = file.replace(/\.json$/, '');
    const categories = record.capture.categories.filter(category => allowed.has(category));
    // Phase 0 covers the provider's mention structure, including human mentions.
    // This category does not attest that the bot was addressed (scenario S03).
    const capturedUtc = fs.statSync(full).mtime.toISOString();
    const id = `real-${String(entries.length + 1).padStart(3, '0')}`;
    const destination = `${id}.json`;
    const provenance = { source: 'production-webhook', capturedUtc, captureId };
    const botJids = record.capture.botJids || (record.capture.botJid ? [record.capture.botJid] : []);
    const quotes = contexts(record.webhook.data).filter(context => context.quotedMessage && context.stanzaId);
    const quoted = quotes.find(context => botJids.includes(context.participant)) || (quotes.length === 1 ? quotes[0] : null);
    const outboundIds = [];
    if (categories.includes('quote-bot')) {
        if (botJids.includes(quoted?.participant)) provenance.quoteEvidence = 'exact-bot-identity';
        else if (quoted) {
            provenance.quoteEvidence = 'observed-outbound-id';
            outboundIds.push(quoted.stanzaId);
        } else { categories.splice(categories.indexOf('quote-bot'), 1); }
    }
    if (categories.includes('quote-human')) provenance.quoteHumanEvidence = 'known-bot-different-participant';
    fs.writeFileSync(path.join(target, destination), JSON.stringify(record.webhook, null, 4) + '\n');
    entries.push({ id, file: destination, categories, provenance,
        ...(record.capture.botJid ? { botJid: record.capture.botJid } : {}),
        ...(botJids.length ? { botJids } : {}),
        ...(outboundIds.length ? { botOutboundIds: outboundIds } : {}) });
}
const manifest = { version: 1, provenance: { source: 'production-webhook', capturedUtc: entries.at(-1)?.provenance.capturedUtc,
    captureMethod: 'live-http-preload on production wasa; allowlist sanitization before disk writes',
    evolutionVersion: 'botsky/evolution-native-tables:2.3.7-c1 (image sha256:76a792fc0ca7c3c7e02e3a81aa06094b3b29e1c7824215a6ddaf969cdff42808)',
    anonymizer: 'scripts/refactor/anonymize-webhook.cjs' }, fixtures: entries };
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 4) + '\n');
const observed = [...new Set(entries.flatMap(entry => entry.categories))].sort();
console.log(JSON.stringify({ realFixtures: entries.length, categories: observed }));
