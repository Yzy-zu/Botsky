// @ts-check
'use strict';
/** @typedef {import('./clock').Clock} Clock */
class TtlStore {
    /** @param {{clock:Clock,maxEntries?:number}} options */
    constructor({ clock, maxEntries = 1000 }) {
        if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('Invalid capacity');
        this.clock = clock;
        this.maxEntries = maxEntries;
        /** @type {Record<string,{value:unknown,expiresAt:number}>} */
        this.entries = Object.create(null);
    }
    /** @param {string} namespace @param {string} key */
    entryKey(namespace, key) { return JSON.stringify([namespace, key]); }
    /** @param {number} ttlMs */
    validateTtl(ttlMs) { if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError('Invalid TTL'); }
    /** @param {string} namespace @param {string} key @param {unknown} value @param {number} ttlMs */
    set(namespace, key, value, ttlMs) {
        this.validateTtl(ttlMs);
        this.sweep();
        const id = this.entryKey(namespace, key);
        if (!(id in this.entries) && Object.keys(this.entries).length >= this.maxEntries) throw new Error('TTL store capacity exceeded');
        this.entries[id] = { value, expiresAt: this.clock.now() + ttlMs };
    }
    /** @param {string} namespace @param {string} key @returns {unknown} */
    get(namespace, key) {
        const id = this.entryKey(namespace, key);
        const entry = this.entries[id];
        if (!entry) return undefined;
        if (entry.expiresAt <= this.clock.now()) { delete this.entries[id]; return undefined; }
        return entry.value;
    }
    /** @param {string} namespace @param {string} key */
    delete(namespace, key) { const id = this.entryKey(namespace, key); const found = id in this.entries; delete this.entries[id]; return found; }
    /** @param {string} namespace @param {string} key @param {number} ttlMs */
    touch(namespace, key, ttlMs) {
        this.validateTtl(ttlMs);
        this.get(namespace, key);
        const entry = this.entries[this.entryKey(namespace, key)];
        if (!entry) return false;
        entry.expiresAt = this.clock.now() + ttlMs;
        return true;
    }
    sweep() { for (const [id, entry] of Object.entries(this.entries)) if (entry.expiresAt <= this.clock.now()) delete this.entries[id]; }
    get size() { this.sweep(); return Object.keys(this.entries).length; }
    get stats() {
        this.sweep();
        /** @type {Record<string,number>} */
        const namespaces = Object.create(null);
        for (const id of Object.keys(this.entries)) {
            const [namespace] = /** @type {[string,string]} */ (JSON.parse(id));
            namespaces[namespace] = (namespaces[namespace] ?? 0) + 1;
        }
        return { size: Object.keys(this.entries).length, maxEntries: this.maxEntries, namespaces };
    }
    dispose() { this.entries = Object.create(null); }
}
module.exports = { TtlStore };
