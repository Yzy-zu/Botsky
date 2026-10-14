// @ts-check
'use strict';
const {normalizeJid}=require('./jid');
/** @typedef {{respond:boolean,reason:string,addressedBy?:'mention'|'quote-bot'|'prefix'|'wake-word'|'session'|'private'|'attachment-followup'}} AddressingDecision */
/** @typedef {{kind:'command'|'intent'|'chat'|'ignore',feature?:string,name?:string,args?:object,confidence:number,via:'explicit'|'session'|'rule'|'llm'}} Decision */
/** @typedef {{scope:'current_chat'|'main_group'|'contact',contactQuery?:string,expectedJid?:string}} DeliveryRequest */
/** @typedef {{type:'text',text:string}|{type:'image'|'audio'|'video'|'document'|'sticker',ref:string,mime:string,caption?:string,transcript?:string,durationSeconds?:number|null,delivery?:DeliveryRequest}|{type:'reaction',emoji:string,messageId:string}|{type:'poll',name:string,options:string[]}} ReplyPart */
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
        return ['image', 'audio', 'video', 'document', 'sticker'].includes(p.type) && 'ref' in p && typeof p.ref === 'string' && 'mime' in p && typeof p.mime === 'string' && (!('caption' in p) || p.caption === undefined || typeof p.caption === 'string')
            && (!('delivery' in p) || p.delivery === undefined || (p.type === 'audio' && isDeliveryRequest(p.delivery)))
            && (!('transcript' in p) || p.transcript === undefined || (p.type === 'audio' && typeof p.transcript === 'string' && p.transcript.length <= 20000))
            && (!('durationSeconds' in p) || p.durationSeconds === undefined || p.durationSeconds === null || (p.type === 'audio' && typeof p.durationSeconds === 'number' && Number.isFinite(p.durationSeconds) && p.durationSeconds > 0));
    });
}
/** @param {unknown} value @returns {value is DeliveryRequest} */
function isDeliveryRequest(value) {
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const request=/** @type {DeliveryRequest} */(value);
    return ['current_chat','main_group','contact'].includes(request.scope)
        && (request.scope==='current_chat'||(typeof request.expectedJid==='string'&&normalizeJid(request.expectedJid)===request.expectedJid&&['@g.us','@s.whatsapp.net'].some(suffix=>request.expectedJid?.endsWith(suffix))))
        && (request.contactQuery===undefined||(typeof request.contactQuery==='string'&&request.contactQuery.trim().length>0&&request.contactQuery.length<=160))
        && (request.expectedJid===undefined||(typeof request.expectedJid==='string'&&request.expectedJid.length>0&&request.expectedJid.length<=512));
}
module.exports = { isReply, isDeliveryRequest };
