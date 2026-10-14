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
    /** Cache only lightweight current references; no downloads/history/XP writes. A full store is best-effort.
     * @param {InboundEvent} event @returns {boolean} true if no cache was needed or both references were stored */
    function observe(event) {
        if (!event.media || event.isFromMe) return true;
        /** @type {Attachment} */ const attachment = { id:event.id,ownerJid:event.sender.jid,chatId:event.chatId,expiresAt:clock.now()+600000,ref:event.media.ref,mime:event.media.mime,kind:event.kind };
        const providerKey=originalMediaKey(event);
        if(providerKey){attachment.providerKey=providerKey;const alternate=originalOwnerAlternate(event);if(alternate)attachment.providerOwnerAlt=alternate;}
        const ownerKey=contextKey(event.chatId,event.sender.jid);
        const idKey=contextKey(event.chatId,event.id);
        const hasOwner=!!store.get('pipeline.attachment.owner',ownerKey);
        const hasId=!!store.get('pipeline.attachment.id',idKey);
        const needed=Number(!hasOwner)+Number(!hasId);
        // Preflight both writes so a full cache cannot update one index while
        // failing the other. Do not evict unrelated TtlStore entries.
        if(store.maxEntries-store.size<needed)return false;
        const previousOwner=store.get('pipeline.attachment.owner',ownerKey);
        const previousId=store.get('pipeline.attachment.id',idKey);
        try {
            store.set('pipeline.attachment.owner',ownerKey,attachment,600000);
            store.set('pipeline.attachment.id',idKey,attachment,600000);
            return true;
        } catch(error) {
            restoreRef(store,'pipeline.attachment.owner',ownerKey,previousOwner,clock.now());
            restoreRef(store,'pipeline.attachment.id',idKey,previousId,clock.now());
            if(error instanceof Error&&error.message==='TTL store capacity exceeded')return false;
            throw error;
        }
    }
    /** Minimal read-only view for Addressing; never consume sessions/echo IDs. @param {InboundEvent} event @returns {AddressingMetadata} */
    function addressingMetadata(event) {
        const now = clock.now();
        const key = contextKey(event.chatId,event.sender.jid);
        const storedSession = /** @type {Session|undefined} */(store.get('pipeline.session',key));
        const session = storedSession && storedSession.ownerJid === event.sender.jid && storedSession.expiresAt > now ? { ...storedSession } : undefined;
        const cachedQuote = event.quoted ? /** @type {Attachment|undefined} */(store.get('pipeline.attachment.id',contextKey(event.chatId,event.quoted.messageId))) : undefined;
        const quoted=cachedQuote&&cachedQuote.expiresAt>now?cachedQuote:quotedMediaReference(event,now);
        const own = /** @type {Attachment|undefined} */(store.get('pipeline.attachment.owner',key));
        // An unknown quote must never silently select a different recent file.
        const source = event.quoted ? quoted && quoted.expiresAt > now ? quoted : undefined
            : own && own.ownerJid === event.sender.jid && own.expiresAt > now ? own : undefined;
        const attachment = source ? { ...source, quotedMatch: Boolean(quoted && quoted === source) } : undefined;
        return { ...(session ? { session } : {}), ...(attachment ? { attachment } : {}), airdropActive: store.get('pipeline.airdrop',event.chatId) === true };
    }
    /** Only addressed requests may read conversation IO. Group query fails closed without thread port.
     * @param {InboundEvent} event @param {import('../domain/types').AddressingDecision} addressing @param {{allowCurrentMediaFallback?:boolean}} [options]
     * @returns {Promise<import('./contracts').Ctx>} */
    async function build(event,addressing,options={}) {
        const metadata = addressingMetadata(event);
        if(options.allowCurrentMediaFallback&&event.media&&!event.quoted) {
            metadata.attachment={id:event.id,ownerJid:event.sender.jid,chatId:event.chatId,expiresAt:clock.now()+600000,
                ref:event.media.ref,mime:event.media.mime,kind:event.kind};
            const providerKey=originalMediaKey(event);
            if(providerKey){metadata.attachment.providerKey=providerKey;const alternate=originalOwnerAlternate(event);if(alternate)metadata.attachment.providerOwnerAlt=alternate;}
        }
        /** @type {HistoryMessage[]} */ let history = [];
        if (addressing.respond) history = event.isGroup ? conversation.recentThread ? await conversation.recentThread(event.chatId,event.sender.jid,event.quoted?.messageId,historyLimit) : [] : await conversation.recent(event.chatId,historyLimit);
        return { event,addressing,history:history.slice(-historyLimit).map(row => ({role:row.role,content:row.content})),attachment:metadata.attachment,session:metadata.session,correlationId:event.id,roles:{admins:[...roles.admins],owners:[...roles.owners],...(roles.members ? { members:[...roles.members] } : {}),...(roles.groups ? { groups:[...roles.groups] } : {})} };
    }
    return { observe,addressingMetadata,build };
}
/** An explicit provider quote can hydrate a pre-canary attachment by its exact
 * chat/message key. No recent-file substitution, URL fetch or media bytes retained.
 * @param {InboundEvent} event @param {number} now @returns {Attachment|undefined} */
function quotedMediaReference(event,now) {
    if(!event.quoted||!event.quoted.senderJid)return undefined;
    const quotedIdentity=event.quoted;
    /** @param {unknown} value @returns {Record<string,unknown>} */
    const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?/** @type {Record<string,unknown>} */(value):{};
    const raw=record(event.raw),data=record(raw.data||raw),key=record(data.key);
    if(key.id!==event.id||typeof key.remoteJid!=='string'||normalizeJid(key.remoteJid)!==event.chatId)return undefined;
    /** @param {unknown} input */
    function unwrap(input){let value=record(input);for(let i=0;i<8;i++){
        const wrapper=record(value.ephemeralMessage||value.viewOnceMessage||value.viewOnceMessageV2||value.viewOnceMessageV2Extension||value.documentWithCaptionMessage);
        if(!wrapper.message)break;value=record(wrapper.message);
    }return value;}
    const message=unwrap(data.message);
    const contexts=[message.messageContextInfo,data.contextInfo,...Object.values(message).map(value=>record(value).contextInfo)].map(record);
    const context=contexts.find(value=>value.stanzaId===quotedIdentity.messageId&&typeof value.participant==='string'&&normalizeJid(value.participant)===quotedIdentity.senderJid);
    if(!context)return undefined;
    const quoted=unwrap(context.quotedMessage);
    for(const kind of ['image','video','audio','document','sticker']){
        const payload=record(quoted[kind+'Message']);if(!Object.keys(payload).length)continue;
        if(typeof payload.mimetype!=='string'||!payload.mimetype||payload.mimetype.length>160)return undefined;
        return {id:event.quoted.messageId,chatId:event.chatId,ownerJid:event.quoted.senderJid,expiresAt:now+600000,
            kind,ref:event.quoted.messageId,mime:payload.mimetype,quotedMatch:true,
            providerKey:{id:event.quoted.messageId,remoteJid:key.remoteJid,participant:/** @type {string} */(context.participant),fromMe:event.quoted.isFromBot}};
    }
    return undefined;
}
/** Keep only an explicit provider alternate that normalized to this event's owner.
 * @param {InboundEvent} event @returns {string|undefined} */
function originalOwnerAlternate(event){
    const raw=/** @type {{data?:unknown,key?:unknown}|undefined} */(event.raw);
    const source=raw?.data&&typeof raw.data==='object'?raw.data:raw;
    const key=/** @type {{participantAlt?:unknown,remoteJidAlt?:unknown}|undefined} */(/** @type {{key?:unknown}|undefined} */(source)?.key);
    const alternate=event.isGroup?key?.participantAlt:key?.remoteJidAlt;
    return typeof alternate==='string'&&normalizeJid(alternate)===event.sender.jid?alternate:undefined;
}
/** Preserve the provider lookup identity for both Evolution envelope shapes.
 * Only copy the key fields; never retain raw message/media bytes in TTL state.
 * @param {InboundEvent} event @returns {import('../domain/ports').MessageKey|undefined} */
function originalMediaKey(event) {
    const raw=/** @type {{data?:unknown,key?:unknown}|undefined} */(event.raw);
    const source=raw?.data&&typeof raw.data==='object'?raw.data:raw;
    const key=/** @type {{id?:unknown,remoteJid?:unknown,participant?:unknown,fromMe?:unknown}|undefined} */(/** @type {{key?:unknown}|undefined} */(source)?.key);
    if(key?.id!==event.id||typeof key.remoteJid!=='string'||normalizeJid(key.remoteJid)!==event.chatId)return undefined;
    return{id:event.id,remoteJid:key.remoteJid,fromMe:Boolean(key.fromMe),
        ...(typeof key.participant==='string'?{participant:key.participant}:{})};
}
/** @param {import('../platform/ttlStore').TtlStore} store @param {string} namespace @param {string} key @param {unknown} previous @param {number} now */
function restoreRef(store,namespace,key,previous,now) {
    if(previous&&typeof previous==='object'&&'expiresAt' in previous&&typeof previous.expiresAt==='number'&&previous.expiresAt>now) {
        store.set(namespace,key,previous,previous.expiresAt-now);
    } else store.delete(namespace,key);
}
module.exports = { createContext, contextKey };
