// @ts-check
'use strict';
const { normalizeJid } = require('./client');
/** @typedef {{jid:string,text:string,textKey:string,createdAt:number,ids:string[],pending:boolean,echoed:boolean,recorded:boolean}} Entry */
class EchoGuard {
    /** @param {{clock:import('../../platform/clock').Clock,store:import('../../platform/ttlStore').TtlStore,record?:(jid:string,text:string)=>void,ttlMs?:number,maxEntries?:number,namespace?:string}} options */
    constructor({ clock, store, record = () => {}, ttlMs = 300000, maxEntries = 1000, namespace = 'evolution.outbound' }) {
        if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || !Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new RangeError('Invalid echo bounds');
        this.clock = clock; this.store = store; this.recordHistory = record; this.ttlMs = ttlMs; this.maxEntries = maxEntries; this.namespace = namespace;
        /** @type {Entry[]} */ this.entries = [];
    }
    /** @param {string} jid */
    chat(jid) { return normalizeJid(jid).replace(/:[0-9]+@/, '@'); }
    /** @param {Entry} entry */
    forget(entry) { this.entries = this.entries.filter(candidate => candidate !== entry); for (const id of entry.ids) this.store.delete(this.namespace, JSON.stringify([entry.jid, id])); }
    prune() { for (const entry of [...this.entries]) if (entry.createdAt + this.ttlMs <= this.clock.now() || this.entries.length > this.maxEntries) this.forget(entry); }
    /** @param {string} jid @param {string} text */
    begin(jid, text) {
        this.prune(); const chat = this.chat(jid);
        const entry = { jid: chat, text, textKey: JSON.stringify([chat, text]), createdAt: this.clock.now(), ids: [], pending: true, echoed: false, recorded: false };
        this.entries.push(entry); this.prune(); return entry;
    }
    /** @param {Entry} entry @param {unknown} id */
    associate(entry, id) {
        if (!id || !this.entries.includes(entry)) return;
        const value = String(id); if (!entry.ids.includes(value)) entry.ids.push(value);
        try { this.store.set(this.namespace, JSON.stringify([entry.jid, value]), entry, Math.max(1, entry.createdAt + this.ttlMs - this.clock.now())); }
        catch { /* Cache capacity cannot turn acknowledged delivery into a send failure. Bounded entries retain IDs. */ }
    }
    /** @param {Entry} entry @param {any} response */
    finish(entry, response) { entry.pending = false; this.associate(entry, response?.data?.key?.id); }
    /** @param {Entry} entry */
    record(entry) { if (entry.recorded) return; entry.recorded = true; try { this.recordHistory(entry.jid, entry.text); } catch { /* History failure never resends. */ } }
    /** @param {{chatId?:string,messageId?:string,text?:string}} [event] */
    consume({ chatId, messageId, text } = {}) {
        if (!chatId || !messageId) return false; this.prune(); const jid = this.chat(chatId);
        const known = /** @type {Entry|undefined} */ (this.store.get(this.namespace, JSON.stringify([jid, messageId]))) || this.entries.find(entry=>entry.jid===jid&&entry.ids.includes(messageId));
        if (known) { known.echoed = true; return true; }
        if (typeof text !== 'string') return false;
        const entry = this.entries.find(item => item.textKey === JSON.stringify([jid, text]) && item.pending && !item.echoed);
        if (!entry) return false; entry.echoed = true; this.associate(entry, messageId); return true;
    }
    /** @param {Entry} entry @param {any} error */
    fail(entry, error) { this.finish(entry, null); if (entry.echoed) this.record(entry); if ([400, 401, 403, 404, 413, 422, 429].includes(error.response?.status) && !entry.echoed) this.forget(entry); }
    dispose() { for (const entry of [...this.entries]) this.forget(entry); }
}
module.exports = { EchoGuard };
