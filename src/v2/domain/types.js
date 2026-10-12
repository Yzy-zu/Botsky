// @ts-check
'use strict';
/** @typedef {{respond:boolean,reason:string,addressedBy?:'mention'|'quote-bot'|'prefix'|'wake-word'|'session'|'private'|'attachment-followup'}} AddressingDecision */
/** @typedef {{kind:'command'|'intent'|'chat'|'ignore',feature?:string,name?:string,args?:object,confidence:number,via:'explicit'|'session'|'rule'|'llm'}} Decision */
/** @typedef {{type:'text',text:string}|{type:'image'|'audio'|'video'|'document'|'sticker',ref:string,mime:string,caption?:string}|{type:'reaction',emoji:string,messageId:string}|{type:'poll',name:string,options:string[]}} ReplyPart */
/** @typedef {{parts:ReplyPart[],replyTo?:string,ephemeralHint?:boolean}} Reply */
/** @param {unknown} value @returns {value is Reply} */
function isReply(value) {
    if (!value || typeof value !== 'object') return false;
    const v = /** @type {Reply} */ (value);
    if (!Array.isArray(v.parts) || (v.replyTo !== undefined && typeof v.replyTo !== 'string') || (v.ephemeralHint !== undefined && typeof v.ephemeralHint !== 'boolean')) return false;
    return v.parts.every(p => {
        if (!p || typeof p !== 'object') return false;
        if (p.type === 'text') return typeof p.text === 'string';
        if (p.type === 'reaction') return typeof p.emoji === 'string' && typeof p.messageId === 'string';
        if (p.type === 'poll') return typeof p.name === 'string' && Array.isArray(p.options) && p.options.length >= 2 && p.options.every(o => typeof o === 'string');
        return ['image', 'audio', 'video', 'document', 'sticker'].includes(p.type) && 'ref' in p && typeof p.ref === 'string' && 'mime' in p && typeof p.mime === 'string' && (!('caption' in p) || p.caption === undefined || typeof p.caption === 'string');
    });
}
module.exports = { isReply };
