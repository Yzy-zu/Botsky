// @ts-check
'use strict';
/** @typedef {{id:string, chatId:string, isGroup:boolean, sender:{jid:string,number:string,name:string}, text:string, kind:'text'|'image'|'video'|'audio'|'document'|'sticker'|'reaction'|'poll'|'unknown', media?:{ref:string,mime:string,size?:number}, quoted?:{messageId:string,senderJid:string,text?:string,isFromBot:boolean}, mentions:string[], isFromMe:boolean, receivedAt:number, raw:object}} InboundEvent */
/** @param {unknown} value @returns {value is InboundEvent} */
function isInboundEvent(value) {
    if (!value || typeof value !== 'object') return false;
    const v = /** @type {InboundEvent} */ (value);
    return typeof v.id === 'string' && !!v.id && typeof v.chatId === 'string' && !!v.chatId &&
        typeof v.isGroup === 'boolean' && !!v.sender && typeof v.sender === 'object' && !Array.isArray(v.sender) && ['jid', 'number', 'name'].every(k => typeof v.sender[/** @type {'jid'|'number'|'name'} */(k)] === 'string') &&
        typeof v.text === 'string' && ['text', 'image', 'video', 'audio', 'document', 'sticker', 'reaction', 'poll', 'unknown'].includes(v.kind) &&
        Array.isArray(v.mentions) && v.mentions.every(j => typeof j === 'string') && typeof v.isFromMe === 'boolean' &&
        Number.isFinite(v.receivedAt) && !!v.raw && typeof v.raw === 'object' && !Array.isArray(v.raw) &&
        (v.media === undefined || (!!v.media && typeof v.media === 'object' && !Array.isArray(v.media) && typeof v.media.ref === 'string' && typeof v.media.mime === 'string' && (v.media.size === undefined || (Number.isFinite(v.media.size) && v.media.size >= 0)))) &&
        (v.quoted === undefined || (!!v.quoted && typeof v.quoted === 'object' && !Array.isArray(v.quoted) && typeof v.quoted.messageId === 'string' && typeof v.quoted.senderJid === 'string' && typeof v.quoted.isFromBot === 'boolean' && (v.quoted.text === undefined || typeof v.quoted.text === 'string')));
}
module.exports = { isInboundEvent };
