// @ts-check
'use strict';
const {normalizeJid}=require('./access.policy');
/** @param {import('../domain/events').InboundEvent} event @param {import('./addressing.policy').AddressingMeta} meta
 * @returns {{cache:boolean,suggest?:import('../domain/types').Reply,followupAllowed:boolean}} */
function attachmentPolicy(event,meta) {
    if (event.isFromMe) return {cache:false,followupAllowed:false};
    const cache=['image','video','audio','document','sticker'].includes(event.kind)&&!!event.media;
    const attachment=meta.attachment;
    const available=!!attachment&&attachment.expiresAt>(meta.now??event.receivedAt)&&normalizeJid(attachment.ownerJid)===normalizeJid(event.sender.jid);
    const shortInstruction=event.text.trim().length>0&&event.text.trim().length<=80;
    const mentioned=!!meta.botJid&&event.mentions.some(jid=>normalizeJid(jid)===normalizeJid(meta.botJid||''));
    const followupAllowed=available&&shortInstruction&&(!event.isGroup||mentioned||!!(attachment?.quotedMatch&&event.quoted?.messageId===attachment.id));
    if (!cache||event.isGroup||event.text.trim()||event.kind==='sticker') return {cache,followupAllowed};
    const actions=event.kind==='image'?'¿Hacemos un sticker, leemos el texto o la guardamos en Drive?'
        :event.kind==='video'?'¿Extraemos el audio, hacemos un sticker o lo guardamos en Drive?'
        :event.kind==='audio'?'¿Quieres que lo transcriba?':'¿Lo resumimos o extraemos el texto?';
    return {cache,followupAllowed,suggest:{replyTo:event.id,parts:[{type:'reaction',emoji:'👀',messageId:event.id},{type:'text',text:actions}]}};
}
module.exports={attachmentPolicy};
