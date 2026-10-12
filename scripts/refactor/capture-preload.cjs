'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { anonymizeWebhook } = require('./anonymize-webhook.cjs');

const MESSAGE_TYPES = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage',
    'documentWithCaptionMessage', 'stickerMessage', 'reactionMessage', 'pollUpdateMessage',
    'pollCreationMessage', 'pollCreationMessageV2', 'pollCreationMessageV3'];
const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage'];
function phone(value) {
    if (typeof value !== 'string') return '';
    const number = value.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
    return number.replace(/^521/, '52');
}
function isRecognizedJid(value) {
    return typeof value === 'string' && value.length <= 256 && /^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(value);
}
function sameIdentity(candidate, alias) {
    if (!isRecognizedJid(candidate) || !isRecognizedJid(alias)) return false;
    return candidate === alias || (candidate.endsWith('@s.whatsapp.net') && alias.endsWith('@s.whatsapp.net')
        && phone(candidate) === phone(alias));
}
function trustedAliases({ botNumber = '', botJid = '', botAliases = [] } = {}) {
    const primary = botJid || (phone(botNumber) ? `${phone(botNumber)}@s.whatsapp.net` : '');
    return [...new Set([primary, ...(Array.isArray(botAliases) ? botAliases : [])].filter(isRecognizedJid))].slice(0, 16);
}
function classifyEnvelope(body, { botNumber = '', botJid = '', botAliases = [], outgoingIds = new Set() } = {}) {
    const data = body.data;
    const categories = new Set([data.key?.remoteJid?.endsWith('@g.us') ? 'group' : 'private']);
    const aliases = trustedAliases({ botNumber, botJid, botAliases });
    const ownIdentity = jid => aliases.some(alias => sameIdentity(jid, alias));
    if (body.event === 'send.message') categories.add('outbound-notification');
    if (data.key?.fromMe === true) categories.add('fromMe');
    if (data.key?.participant?.endsWith('@lid') || data.key?.remoteJid?.endsWith('@lid')) categories.add('lid');
    if (typeof data.key?.participantAlt === 'string') categories.add('participant-alt');
    function walk(message, depth = 0) {
        if (!message || typeof message !== 'object' || depth > 8) return;
        if (typeof message.conversation === 'string' || typeof message.extendedTextMessage?.text === 'string') categories.add('text');
        for (const type of MESSAGE_TYPES) {
            if (!message[type] && data.messageType !== type) continue;
            const category = type.startsWith('poll') ? 'poll' : type.startsWith('document') ? 'document' : type.replace('Message', '');
            categories.add(category);
        }
        const contexts = [message.contextInfo, ...Object.values(message).map(value => value?.contextInfo)];
        for (const context of contexts) {
            if (!context || typeof context !== 'object') continue;
            if (Array.isArray(context.mentionedJid) && context.mentionedJid.length) {
                categories.add('mention');
                if (context.mentionedJid.some(ownIdentity)) categories.add('mention-bot');
            }
            if (context.quotedMessage) {
                const knownOutgoing = typeof context.stanzaId === 'string' && outgoingIds.has(JSON.stringify([data.key?.remoteJid, context.stanzaId]));
                if (knownOutgoing || ownIdentity(context.participant)) categories.add('quote-bot');
                else if (isRecognizedJid(context.participant) && aliases.some(alias =>
                    alias.split('@')[1] === context.participant.split('@')[1])) categories.add('quote-human');
                else categories.add('quote-unknown');
            }
        }
        for (const wrapper of WRAPPERS) walk(message[wrapper]?.message, depth + 1);
    }
    walk(data.message);
    if (data.contextInfo) walk({ contextInfo: data.contextInfo });
    if (data.reactionMessage) categories.add('reaction');
    if (data.pollUpdateMessage) categories.add('poll');
    return [...categories].sort();
}

/** Install a bounded observer without changing incoming bytes or response behavior. */
function installCapture({ enabled = false, directory, limit = 50, durationMs = 15 * 60 * 1000,
    maxBytes = 1024 * 1024, maxInFlight = 8, botNumber = '', botJid = '', botAliases = [], deduplicate = false, now = Date.now } = {}) {
    const stats = { accepted: 0, persisted: 0, malformed: 0, oversize: 0, skipped: 0, duplicates: 0, errors: 0 };
    let active = false;
    let writes = Promise.resolve();
    let timer;
    let wrapper;
    let originalEmit;
    const observers = new Set();
    const outgoingIds = new Set();
    const seenSignatures = new Set();
    const controller = {
        get active() { return active; },
        get stats() { return { ...stats }; },
        async flush() { await writes; },
        stop() {
            active = false;
            if (timer) clearTimeout(timer);
            for (const cleanup of [...observers]) cleanup();
            outgoingIds.clear();
            seenSignatures.clear();
            if (wrapper && http.Server.prototype.emit === wrapper) http.Server.prototype.emit = originalEmit;
        }
    };
    if (!enabled) return controller;
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('Capture requires an absolute directory');
    for (const value of [limit, durationMs, maxBytes, maxInFlight]) {
        if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('Capture limits must be positive integers');
    }
    if (limit > 1000 || durationMs > 60 * 60 * 1000 || maxBytes > 1024 * 1024 || maxInFlight > 16) {
        throw new TypeError('Capture limits exceed allowed bounds');
    }
    if (!Array.isArray(botAliases) || botAliases.length > 16 || botAliases.some(alias => !isRecognizedJid(alias))) {
        throw new TypeError('Bot aliases must be recognized JIDs');
    }
    const aliases = trustedAliases({ botNumber, botJid, botAliases });
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new TypeError('Capture directory must be a directory');
    fs.chmodSync(directory, 0o700);
    const captureDirectory = fs.realpathSync(directory);
    const runId = randomUUID();
    const deadline = now() + durationMs;
    active = true;
    function accept(body) {
        if (!active || now() >= deadline) { controller.stop(); return; }
        if (!body || !['messages.upsert', 'send.message'].includes(body.event) || !body.data || typeof body.data !== 'object'
            || Array.isArray(body.data) || typeof body.data.key?.remoteJid !== 'string'
            || (body.event === 'send.message' && body.data.key?.fromMe !== true)) {
            stats.skipped += 1;
            return;
        }
        if (body.data.key.fromMe === true && typeof body.data.key.id === 'string'
            && body.data.key.id.length <= 256 && body.data.key.remoteJid.length <= 128) {
            outgoingIds.add(JSON.stringify([body.data.key.remoteJid, body.data.key.id]));
            if (outgoingIds.size > 500) outgoingIds.delete(outgoingIds.values().next().value);
        }
        // Cache outgoing evidence even when this capture category is duplicated.
        // Signatures consist exclusively of the closed classifier vocabulary.
        const categories = classifyEnvelope(body, { botNumber, botJid, botAliases, outgoingIds });
        const signature = categories.join('|');
        if (deduplicate && seenSignatures.has(signature)) { stats.duplicates += 1; return; }
        // Only sanitized output enters the filesystem write queue.
        // Include a synthetic identity witness in the same anonymizer batch so
        // capture metadata shares the actual mapping of mentions and quotes.
        const candidates = [];
        const preferred = [];
        function findIdentities(value, depth = 0) {
            if (!value || typeof value !== 'object' || depth > 10) return;
            for (const [field, item] of Object.entries(value)) {
                const jids = field === 'mentionedJid' && Array.isArray(item) ? item
                    : ['remoteJid', 'participant', 'participantAlt', 'senderPn', 'participantPn'].includes(field) ? [item] : [];
                for (const candidate of jids) {
                    if (aliases.some(alias => sameIdentity(candidate, alias))) {
                        candidates.push(candidate);
                        if (field === 'mentionedJid' || (field === 'participant' && value.quotedMessage)) preferred.push(candidate);
                    }
                }
                if (item && typeof item === 'object') findIdentities(item, depth + 1);
            }
        }
        if (aliases.length) findIdentities(body.data);
        const resolvedAliases = aliases.map(alias => candidates.find(candidate => sameIdentity(candidate, alias)) || alias);
        const identity = preferred[0] || resolvedAliases[0];
        const identityWitnesses = [...new Set([identity, ...resolvedAliases].filter(Boolean))];
        const sanitizedBatch = anonymizeWebhook([body, ...identityWitnesses.map(alias => ({
            event: 'messages.upsert', data: { key: { remoteJid: alias }, message: {} }
        }))]);
        const sanitized = sanitizedBatch[0];
        const record = {
            capture: { provenance: 'real-anonymized', source: 'live-http',
                contentProvenance: 'synthetic-replacements', categories,
                ...(identity ? { botJid: sanitizedBatch[1].data.key.remoteJid,
                    botJids: sanitizedBatch.slice(1).map(witness => witness.data.key.remoteJid) } : {}) },
            webhook: sanitized
        };
        const serialized = `${JSON.stringify(record, null, 4)}\n`;
        // Record only accepted signatures: the set is bounded by `limit`.
        if (deduplicate) seenSignatures.add(signature);
        const sequence = ++stats.accepted;
        const destination = path.join(captureDirectory, `capture-${runId}-${String(sequence).padStart(4, '0')}.json`);
        writes = writes.then(async () => {
            try {
                await fs.promises.writeFile(destination, serialized, { mode: 0o600, flag: 'wx' });
                stats.persisted += 1;
            } catch { stats.errors += 1; }
        });
        if (stats.accepted >= limit) controller.stop();
    }
    function observe(req) {
        if (!active) return;
        if (now() >= deadline) { controller.stop(); return; }
        if (req.method !== 'POST' || typeof req.url !== 'string' || req.url.split('?')[0] !== '/webhook') return;
        if (observers.size >= maxInFlight) { stats.skipped += 1; return; }
        let chunks = [];
        let bytes = 0;
        function cleanup() {
            req.removeListener('data', onData);
            req.removeListener('end', onEnd);
            req.removeListener('aborted', onFailure);
            req.removeListener('error', onFailure);
            chunks = [];
            observers.delete(cleanup);
        }
        function onFailure() { stats.errors += 1; cleanup(); }
        function onData(chunk) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > maxBytes) { stats.oversize += 1; cleanup(); return; }
            chunks.push(buffer);
        }
        function onEnd() {
            const raw = Buffer.concat(chunks).toString('utf8');
            cleanup();
            let body;
            try { body = JSON.parse(raw); }
            catch { stats.malformed += 1; return; }
            try { accept(body); }
            catch { stats.errors += 1; }
        }
        observers.add(cleanup);
        req.on('data', onData);
        req.on('end', onEnd);
        req.on('aborted', onFailure);
        req.on('error', onFailure);
    }
    originalEmit = http.Server.prototype.emit;
    wrapper = function (event, ...args) {
        if (event === 'request') {
            try { observe(args[0]); }
            catch { stats.errors += 1; }
        }
        return Reflect.apply(originalEmit, this, [event, ...args]);
    };
    http.Server.prototype.emit = wrapper;
    timer = setTimeout(() => controller.stop(), durationMs);
    timer.unref();
    return controller;
}

function optionsFromEnv(env) {
    const rawAliases = env.REFRACTOR_CAPTURE_BOT_ALIASES || '';
    const botAliases = rawAliases.startsWith('[') ? JSON.parse(rawAliases) : rawAliases.split(',').map(alias => alias.trim()).filter(Boolean);
    return {
        enabled: env.REFRACTOR_CAPTURE_ENABLED === '1' || env.REFRACTOR_CAPTURE_ENABLED === 'true',
        directory: env.REFRACTOR_CAPTURE_DIR,
        limit: Number(env.REFRACTOR_CAPTURE_LIMIT || 50),
        durationMs: Number(env.REFRACTOR_CAPTURE_DURATION || 900000),
        botNumber: env.BOT_NUMBER || '',
        botJid: env.REFRACTOR_CAPTURE_BOT_JID || '',
        botAliases,
        deduplicate: env.REFRACTOR_CAPTURE_DEDUPE === '1' || env.REFRACTOR_CAPTURE_DEDUPE === 'true'
    };
}

module.exports = { installCapture, classifyEnvelope, optionsFromEnv };
if (process.env.REFRACTOR_CAPTURE_ENABLED === '1' || process.env.REFRACTOR_CAPTURE_ENABLED === 'true') {
    try { module.exports.preloadController = installCapture(optionsFromEnv(process.env)); }
    catch { process.stderr.write('Webhook capture startup failed; observer not enabled.\n'); }
}
