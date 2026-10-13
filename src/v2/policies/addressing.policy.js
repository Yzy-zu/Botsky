// @ts-check
'use strict';
const {normalizeJid}=require('./access.policy');
/** @typedef {import('../domain/events').InboundEvent} InboundEvent */
/** @typedef {import('../pipeline/contracts').AddressingMetadata & {now?:number,botJid?:string}} AddressingMeta */
/** @typedef {{botJid:string,prefixes?:readonly string[],wakeWords?:readonly string[],sessionGroupRelaxed?:boolean,now?:number}} AddressingOptions */
/** @param {InboundEvent} event @param {AddressingMeta} meta @param {AddressingOptions} options
 * @returns {import('../domain/types').AddressingDecision} */
function addressingPolicy(event,meta,options) {
    if (event.isFromMe) return {respond:false,reason:'own-message'};
    if (event.isGroup&&meta.airdropActive&&/^yoo$/iu.test(event.text.trim())) return {respond:true,reason:'active-airdrop-claim'};
    if (!event.isGroup) return {respond:true,reason:'private-chat',addressedBy:'private'};
    const bot=normalizeJid(options.botJid);
    const mentioned=!!bot&&event.mentions.some(jid=>normalizeJid(jid)===bot);
    const now=options.now??meta.now??event.receivedAt;
    const session=meta.session;
    const ownerMatches=!!session&&normalizeJid(session.ownerJid)===normalizeJid(event.sender.jid);
    const selection=/^(?:el\s+|#)?[1-9]\d*$/iu.test(event.text.trim());
    const sessionValid=!!session&&ownerMatches&&session.expiresAt>now&&session.selectionValid!==false&&selection;
    const quotedResults=!!session&&!!event.quoted&&event.quoted.messageId===session.resultMessageId&&event.quoted.isFromBot;
    const relaxed=!!session&&options.sessionGroupRelaxed===true&&now>=session.createdAt&&now-session.createdAt<90000;
    if (sessionValid&&(quotedResults||mentioned||relaxed)) return {respond:true,reason:'active-session',addressedBy:'session'};
    if (mentioned) return {respond:true,reason:'bot-mentioned',addressedBy:'mention'};
    if (event.quoted?.isFromBot) return {respond:true,reason:'bot-quoted',addressedBy:'quote-bot'};
    // Numeric continuation without a matching session result is never a command.
    const text=event.text.trim();
    const prefix=(options.prefixes||['/!','/@','!','/','#','.']).find(value=>value&&text.startsWith(value));
    if (prefix&&/^[\p{L}_]/u.test(text.slice(prefix.length).trimStart())) return {respond:true,reason:'explicit-command',addressedBy:'prefix'};
    const words=/** @type {string[]} */ (text.toLocaleLowerCase('es').match(/[\p{L}\p{N}_]+/gu)||[]);
    if ((options.wakeWords||['botsky','botsito']).some(word=>word.toLocaleLowerCase('es')!=='bot'&&words.includes(word.toLocaleLowerCase('es')))) return {respond:true,reason:'wake-word',addressedBy:'wake-word'};
    const attachment=meta.attachment;
    if (attachment&&attachment.expiresAt>now&&normalizeJid(attachment.ownerJid)===normalizeJid(event.sender.jid)&&
        attachment.quotedMatch&&event.quoted?.messageId===attachment.id&&text) {
        return {respond:true,reason:'own-attachment-followup',addressedBy:'attachment-followup'};
    }
    return {respond:false,reason:selection?'session-not-addressed':'group-not-addressed'};
}
module.exports={addressingPolicy};
