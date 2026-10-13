// @ts-check
'use strict';
const { normalize, normalizeJid } = require('./normalize');
/** @param {{clock:import('../platform/clock').Clock,store:import('../platform/ttlStore').TtlStore,botJid?:string,isSentId?:(chatId:string,id:string)=>boolean,echoGuard?:{consume:(event:{chatId:string,messageId:string,text:string})=>boolean}}} options */
function createIngest({ clock, store, botJid, isSentId, echoGuard }) {
    /** HTTP acknowledgement belongs to transport, never waits for dispatch here. @param {unknown} raw */
    function accept(raw) {
        const event = normalize(raw, { clock, botJid, isSentId });
        if (!event) return { accepted: false, reason: 'invalid-event' };
        const key = JSON.stringify([event.chatId, event.id]);
        if (store.get('pipeline.ingest', key)) return { accepted: false, reason: 'duplicate' };
        // Capacity failure is explicit; do not dispatch an event without dedupe protection.
        store.set('pipeline.ingest', key, true, 600000);
        // consume may have a pending-text fallback; never expose human messages to it.
        const own = event.isFromMe || Boolean(botJid && normalizeJid(botJid) === event.sender.jid) || Boolean(isSentId?.(event.chatId,event.id));
        if (own) {
            echoGuard?.consume({ chatId: event.chatId, messageId: event.id, text: event.text });
            return { accepted: false, reason: 'outbound-echo' };
        }
        return { accepted: true, reason: 'accepted', event };
    }
    return { accept };
}
module.exports = { createIngest };
