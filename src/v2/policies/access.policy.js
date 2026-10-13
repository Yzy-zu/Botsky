// @ts-check
'use strict';
const {normalizeJid}=require('../domain/jid');
/** @typedef {'public'|'member'|'admin'|'owner'} Access */
/** @typedef {import("../pipeline/contracts").Roles} Roles */
/** @param {{senderJid:string,chatId:string,isGroup:boolean,roles:Roles,requiredAccess:Access,scope?:readonly ('private'|'group')[]}} input */
function accessPolicy({senderJid,chatId,isGroup,roles,requiredAccess,scope=['private','group']}) {
    if (!scope.includes(isGroup?'group':'private')) return {allow:false,reason:'scope-denied'};
    const sender = normalizeJid(senderJid);
    if (!sender || !normalizeJid(chatId) || sender.endsWith('@g.us')) return {allow:false,reason:'invalid-sender'};
    const rank = {public:0,member:1,admin:2,owner:3};
    if (!(requiredAccess in rank)) return {allow:false,reason:'invalid-access'};
    /** @param {readonly string[]|undefined} list */
    const has = list => (list||[]).some(jid=>normalizeJid(jid)===sender);
    const actual = has(roles.owners)?3:has(roles.admins)?2:has(roles.members)?1:0;
    return actual>=rank[requiredAccess] ? {allow:true,reason:'access-granted'} : {allow:false,reason:'role-denied'};
}
module.exports={normalizeJid,accessPolicy};
