// @ts-check
'use strict';
const { isInboundEvent } = require('../domain/events');
/** @typedef {import('../domain/events').InboundEvent} InboundEvent */
/** @param {unknown} value @returns {Record<string,unknown>} */
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string,unknown>} */(value) : {}; }
/** @param {unknown} value */
function string(value) { return typeof value === 'string' ? value : ''; }
const { normalizeJid } = require('../domain/jid');
/** @param {Record<string,unknown>} message */
function unwrap(message) {
    for (let depth = 0; depth < 8; depth++) {
        const wrapper = object(message.ephemeralMessage || message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension || message.documentWithCaptionMessage);
        if (!wrapper.message) break;
        message = object(wrapper.message);
    }
    return message;
}
/** @param {Record<string,unknown>} message */
function textOf(message) {
    if (typeof message.conversation === 'string') return message.conversation;
    const extended = object(message.extendedTextMessage);
    if (typeof extended.text === 'string') return extended.text;
    for (const key of ['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage']) {
        const media = object(message[key]);
        if (typeof media.caption === 'string') return media.caption;
    }
    return '';
}
/** No provider calls or media downloads. Bot quote trust uses exact identity/registered IDs only.
 * @param {unknown} raw
 * @param {{botJid?:string,isSentId?:(chatId:string,id:string)=>boolean,clock:import('../platform/clock').Clock}} options
 * @returns {InboundEvent|null} */
function normalize(raw, { botJid = '', isSentId = () => false, clock }) {
    const botIdentity = normalizeJid(botJid);
    if (isInboundEvent(raw)) {
        const senderJid = normalizeJid(raw.sender.jid);
        const chatId = normalizeJid(raw.chatId);
        if (!senderJid || !chatId || senderJid.endsWith('@g.us') || raw.isGroup !== chatId.endsWith('@g.us')) return null;
        const event = { ...raw, sender: { ...raw.sender, jid: senderJid, number: senderJid.split('@')[0] }, chatId, mentions: raw.mentions.map(normalizeJid).filter(Boolean) };
        if (raw.quoted) event.quoted = { ...raw.quoted, senderJid: normalizeJid(raw.quoted.senderJid), isFromBot: Boolean((botIdentity && normalizeJid(raw.quoted.senderJid) === botIdentity) || isSentId(event.chatId, raw.quoted.messageId)) };
        return isInboundEvent(event) ? event : null;
    }
    const envelope = object(raw);
    const envelopeType = string(envelope.event).toLowerCase().replace(/[._]/g, '');
    if (envelopeType && envelopeType !== 'messagesupsert') return null;
    const data = object(envelope.data || raw);
    const key = object(data.key);
    const chatId = normalizeJid(string(key.remoteJid));
    const id = string(key.id);
    if (!chatId || !id) return null;
    const isGroup = chatId.endsWith('@g.us');
    // LID alternative is an explicit provider identity mapping, never guessed from digits.
    const participant = string(key.participant || data.participant);
    const senderJid = normalizeJid(isGroup ? string(key.participantAlt) || participant : string(key.remoteJidAlt) || chatId);
    if (!senderJid || (isGroup && senderJid.endsWith('@g.us'))) return null;
    const message = unwrap(object(data.message));
    /** @type {InboundEvent['kind']} */ let kind = 'unknown';
    /** @type {InboundEvent['media']} */ let media;
    if (typeof message.conversation === 'string' || message.extendedTextMessage) kind = 'text';
    for (const [type, value] of /** @type {Array<[string,InboundEvent['kind']]>} */([['imageMessage','image'],['videoMessage','video'],['audioMessage','audio'],['documentMessage','document'],['stickerMessage','sticker'],['reactionMessage','reaction'],['pollCreationMessage','poll'],['pollCreationMessageV2','poll'],['pollCreationMessageV3','poll'],['pollUpdateMessage','poll']])) {
        if (!message[type]) continue;
        kind = value;
        if (['image','video','audio','document','sticker'].includes(value)) {
            const payload = object(message[type]);
            const ref = string(payload.url || payload.directPath) || id;
            const size = typeof payload.fileLength === 'number' && Number.isFinite(payload.fileLength) && payload.fileLength >= 0 ? payload.fileLength : undefined;
            media = { ref, mime: string(payload.mimetype) || 'application/octet-stream', ...(size === undefined ? {} : { size }) };
        }
        break;
    }
    let context = object(message.messageContextInfo || data.contextInfo);
    for (const value of Object.values(message)) {
        const info = object(object(value).contextInfo);
        if (Object.keys(info).length) { context = info; break; }
    }
    const mentioned = context.mentionedJid;
    const mentions = Array.isArray(mentioned) ? mentioned.filter((jid) => typeof jid === 'string').map(jid => normalizeJid(/** @type {string} */(jid))).filter(Boolean) : [];
    const quoteId = string(context.stanzaId);
    const quotedJid = normalizeJid(string(context.participant));
    /** @type {InboundEvent} */ const event = {
        id, chatId, isGroup, sender: { jid: senderJid, number: senderJid.split('@')[0], name: string(data.pushName) },
        text: textOf(message).trim(), kind, mentions, isFromMe: key.fromMe === true, receivedAt: clock.now(), raw: envelope,
        ...(media ? { media } : {})
    };
    if (quoteId) event.quoted = { messageId: quoteId, senderJid: quotedJid, text: textOf(unwrap(object(context.quotedMessage))), isFromBot: Boolean((botIdentity && quotedJid === botIdentity) || isSentId(chatId, quoteId)) };
    return isInboundEvent(event) ? event : null;
}
module.exports = { normalize, normalizeJid };
