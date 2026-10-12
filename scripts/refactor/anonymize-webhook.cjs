'use strict';

/**
 * Offline allowlist sanitizer. One invocation owns all mappings; pass an array
 * of related envelopes to preserve quote, mention and echo relationships.
 * No application imports, hashing, network, environment or persistent state.
 */
function anonymizeWebhook(input) {
    const maps = { jid: new Map(), id: new Map(), text: new Map(), url: new Map() };
    const types = new Set(['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage',
        'audioMessage', 'documentMessage', 'documentWithCaptionMessage', 'stickerMessage',
        'reactionMessage', 'pollUpdateMessage', 'pollCreationMessage', 'pollCreationMessageV2',
        'pollCreationMessageV3', 'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2']);
    const mimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4',
        'audio/ogg', 'audio/ogg; codecs=opus', 'audio/mpeg', 'application/pdf']);
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    function mapped(kind, value, make) {
        if (typeof value !== 'string' || !value) return '';
        if (!maps[kind].has(value)) maps[kind].set(value, make(maps[kind].size + 1));
        return maps[kind].get(value);
    }
    function jid(value) {
        return mapped('jid', value, index => {
            if (value.endsWith('@g.us')) return `120363000000${String(index).padStart(6, '0')}@g.us`;
            if (value.endsWith('@lid')) return `990000000${String(index).padStart(6, '0')}@lid`;
            return `1999555${String(index).padStart(4, '0')}@s.whatsapp.net`;
        });
    }
    const id = value => mapped('id', value, index => `SYNTH-MESSAGE-${index}`);
    const text = value => mapped('text', value, index => `Texto sintético ${index}`);
    const url = value => mapped('url', value, index => `https://media.example.invalid/synthetic-${index}`);
    function key(value) {
        const result = {};
        if (!object(value)) return result;
        for (const name of ['remoteJid', 'participant', 'remoteJidAlt', 'participantAlt', 'participantPn', 'senderPn']) {
            if (typeof value[name] === 'string') result[name] = jid(value[name]);
        }
        if (typeof value.id === 'string') result.id = id(value.id);
        if (typeof value.fromMe === 'boolean') result.fromMe = value.fromMe;
        if (value.addressingMode === 'lid' || value.addressingMode === 'pn') result.addressingMode = value.addressingMode;
        return result;
    }
    function context(value, depth) {
        const result = {};
        if (!object(value)) return result;
        for (const name of ['participant', 'remoteJid']) {
            if (typeof value[name] === 'string') result[name] = jid(value[name]);
        }
        if (typeof value.stanzaId === 'string') result.stanzaId = id(value.stanzaId);
        if (Array.isArray(value.mentionedJid)) result.mentionedJid = value.mentionedJid.filter(v => typeof v === 'string').map(jid);
        if (object(value.quotedMessage)) result.quotedMessage = message(value.quotedMessage, depth + 1);
        return result;
    }
    function vote(value) {
        const result = {};
        if (!object(value)) return result;
        for (const field of ['selectedOptions', 'options']) {
            if (!Array.isArray(value[field])) continue;
            result[field] = value[field].flatMap(option => {
                if (typeof option === 'string') return [text(option)];
                if (object(option) && typeof option.name === 'string') return [{ name: text(option.name) }];
                return [];
            });
        }
        return result;
    }
    function reaction(value) {
        const result = {};
        if (!object(value)) return result;
        if (object(value.key)) result.key = key(value.key);
        if (typeof value.text === 'string') {
            // Only known, non-identifying reaction tokens survive verbatim.
            result.text = ['👍', '👎', '✅', '👀', '❤️', '😂', ''].includes(value.text) ? value.text : text(value.text);
        }
        return result;
    }
    function pollUpdate(value) {
        const result = {};
        if (!object(value)) return result;
        if (object(value.pollCreationMessageKey)) result.pollCreationMessageKey = key(value.pollCreationMessageKey);
        if (object(value.vote)) result.vote = vote(value.vote);
        return result;
    }
    function message(value, depth = 0) {
        if (!object(value) || depth > 8) return {};
        const result = {};
        for (const type of types) {
            if (type === 'conversation') {
                if (typeof value.conversation === 'string') result.conversation = text(value.conversation);
                continue;
            }
            if (!object(value[type])) continue;
            const original = value[type];
            let clean = {};
            if (['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage'].includes(type)) {
                clean.message = message(original.message, depth + 1);
            } else if (type === 'reactionMessage') clean = reaction(original);
            else if (type === 'pollUpdateMessage') clean = pollUpdate(original);
            else if (type.startsWith('pollCreationMessage')) {
                if (typeof original.name === 'string') clean.name = text(original.name);
                if (Array.isArray(original.options)) clean.options = vote({ options: original.options }).options;
                clean.selectableOptionsCount = 1;
            } else {
                for (const field of ['text', 'caption']) {
                    if (typeof original[field] === 'string') clean[field] = text(original[field]);
                }
                if (typeof original.url === 'string') clean.url = url(original.url);
                if (mimeTypes.has(original.mimetype)) clean.mimetype = original.mimetype;
                if (typeof original.fileName === 'string') clean.fileName = original.mimetype === 'application/pdf' ? 'synthetic-document.pdf' : 'synthetic-file.bin';
                if (typeof original.ptt === 'boolean') clean.ptt = original.ptt;
            }
            if (object(original.contextInfo)) clean.contextInfo = context(original.contextInfo, depth);
            result[type] = clean;
        }
        return result;
    }
    function envelope(value) {
        if (!object(value) || !['messages.upsert', 'send.message'].includes(value.event) || !object(value.data)
            || (value.event === 'send.message' && value.data.key?.fromMe !== true)) {
            throw new TypeError('Expected messages.upsert or outgoing send.message envelope with object data');
        }
        const original = value.data;
        const data = { key: key(original.key), message: message(original.message) };
        if (typeof original.pushName === 'string') data.pushName = 'Persona Sintética';
        if (types.has(original.messageType)) data.messageType = original.messageType;
        for (const field of ['participant', 'participantAlt', 'senderPn', 'participantPn', 'sender']) {
            if (typeof original[field] === 'string') data[field] = jid(original[field]);
        }
        if (object(original.contextInfo)) data.contextInfo = context(original.contextInfo, 0);
        if (object(original.reactionMessage)) data.reactionMessage = reaction(original.reactionMessage);
        if (object(original.pollUpdateMessage)) data.pollUpdateMessage = pollUpdate(original.pollUpdateMessage);
        if (object(original.vote)) data.vote = vote(original.vote);
        return { event: value.event, instance: 'synthetic-instance', data };
    }
    return Array.isArray(input) ? input.map(envelope) : envelope(input);
}

module.exports = { anonymizeWebhook };

if (require.main === module) {
    try {
        const fs = require('node:fs');
        const input = JSON.parse(fs.readFileSync(0, 'utf8'));
        process.stdout.write(`${JSON.stringify(anonymizeWebhook(input), null, 4)}\n`);
    } catch {
        process.stderr.write('Cannot anonymize: expected valid JSON messages.upsert or outgoing send.message envelope or array.\n');
        process.exitCode = 1;
    }
}
