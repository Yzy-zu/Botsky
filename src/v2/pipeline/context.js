// @ts-check
'use strict';
const { normalizeJid } = require('../domain/jid');
/** @typedef {import('./contracts').Attachment} Attachment */
/** @typedef {import('./contracts').Session} Session */
/** @typedef {import('./contracts').AddressingMetadata} AddressingMetadata */
/** @typedef {import('../domain/events').InboundEvent} InboundEvent */
/** @typedef {{role:string,content:string}} HistoryMessage */
/** @typedef {{recent:(chatId:string,limit?:number)=>Promise<HistoryMessage[]>,recentThread?:(chatId:string,senderJid:string,quotedId?:string,limit?:number)=>Promise<HistoryMessage[]>}} Conversation */
/** @param {string} chatId @param {string} ownerJid */
function contextKey(chatId, ownerJid) { return JSON.stringify([chatId,ownerJid]); }
/** @param {{clock:import('../platform/clock').Clock,store:import('../platform/ttlStore').TtlStore,conversation:Conversation,roles?:import('./contracts').Roles,historyLimit?:number}} options */
function createContext({ clock, store, conversation, roles = { admins: [], owners: [] }, historyLimit = 20 }) {
    if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 100) throw new RangeError('Invalid history limit');
    /** Cache only lightweight current references; no downloads/history/XP writes. @param {InboundEvent} event */
    function observe(event) {
        if (!event.media || event.isFromMe) return;
        /** @type {Attachment} */ const attachment = { id:event.id,ownerJid:event.sender.jid,chatId:event.chatId,expiresAt:clock.now()+600000,ref:event.media.ref,mime:event.media.mime,kind:event.kind };
        const raw = /** @type {Record<string,unknown>} */ (event.raw || {});
        const key = /** @type {{id?:unknown,remoteJid?:unknown,participant?:unknown,participantAlt?:unknown,fromMe?:unknown}|undefined} */ (raw.key);
        if (key?.id === event.id && typeof key.remoteJid === 'string' && normalizeJid(key.remoteJid) === event.chatId) {
            // Canonical IDs address policies; the provider needs its original lookup key.
            attachment.providerKey = { id:event.id,remoteJid:key.remoteJid,fromMe:Boolean(key.fromMe),
                ...(typeof key.participant === 'string' ? {participant:key.participant} : {}) };
        }
        store.set('pipeline.attachment.owner',contextKey(event.chatId,event.sender.jid),attachment,600000);
        store.set('pipeline.attachment.id',contextKey(event.chatId,event.id),attachment,600000);
    }
    /** Minimal read-only view for Addressing; never consume sessions/echo IDs. @param {InboundEvent} event @returns {AddressingMetadata} */
    function addressingMetadata(event) {
        const now = clock.now();
        const key = contextKey(event.chatId,event.sender.jid);
        const storedSession = /** @type {Session|undefined} */(store.get('pipeline.session',key));
        const session = storedSession && storedSession.ownerJid === event.sender.jid && storedSession.expiresAt > now ? { ...storedSession } : undefined;
        const quoted = event.quoted ? /** @type {Attachment|undefined} */(store.get('pipeline.attachment.id',contextKey(event.chatId,event.quoted.messageId))) : undefined;
        const own = /** @type {Attachment|undefined} */(store.get('pipeline.attachment.owner',key));
        // An unknown quote must never silently select a different recent file.
        const source = event.quoted ? quoted && quoted.expiresAt > now ? quoted : undefined
            : own && own.ownerJid === event.sender.jid && own.expiresAt > now ? own : undefined;
        const attachment = source ? { ...source, quotedMatch: Boolean(quoted && quoted === source) } : undefined;
        return { ...(session ? { session } : {}), ...(attachment ? { attachment } : {}), airdropActive: store.get('pipeline.airdrop',event.chatId) === true };
    }
    /** Only addressed requests may read conversation IO. Group query fails closed without thread port.
     * @param {InboundEvent} event @param {import('../domain/types').AddressingDecision} addressing
     * @returns {Promise<import('./contracts').Ctx>} */
    async function build(event,addressing) {
        const metadata = addressingMetadata(event);
        /** @type {HistoryMessage[]} */ let history = [];
        if (addressing.respond) history = event.isGroup ? conversation.recentThread ? await conversation.recentThread(event.chatId,event.sender.jid,event.quoted?.messageId,historyLimit) : [] : await conversation.recent(event.chatId,historyLimit);
        return { event,addressing,history:history.slice(-historyLimit).map(row => ({role:row.role,content:row.content})),attachment:metadata.attachment,session:metadata.session,correlationId:event.id,roles:{admins:[...roles.admins],owners:[...roles.owners],...(roles.members ? { members:[...roles.members] } : {}),...(roles.groups ? { groups:[...roles.groups] } : {})} };
    }
    return { observe,addressingMetadata,build };
}
module.exports = { createContext, contextKey };
