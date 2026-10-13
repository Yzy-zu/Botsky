// @ts-check
'use strict';
/** @typedef {Pick<import('../domain/events').InboundEvent,'id'|'chatId'|'sender'>} RateEvent */
/** @typedef {{id:string,at:number}} SeenEvent */
/** @typedef {{events:SeenEvent[],cooldownUntil:number}} Bucket */
/** @typedef {{limited:boolean,blockedUntil?:number,cooldownUntil:number}} RateSnapshot */
/** Rolling admissions are bounded by maxEvents; rejected IDs never allocate more memory.
 * Reads project the current event, so the last admitted ID remains allowed when read again.
 * @param {{clock:Pick<import('./clock').Clock,'now'>,store:Pick<import('./ttlStore').TtlStore,'get'|'set'|'delete'>,windowMs?:number,maxEvents?:number,cooldownMs?:number}} options */
function createRateLimiter({ clock, store, windowMs = 60000, maxEvents = 60, cooldownMs = 3000 }) {
    if (!Number.isSafeInteger(windowMs) || windowMs < 1 || !Number.isSafeInteger(maxEvents) || maxEvents < 1
        || !Number.isSafeInteger(cooldownMs) || cooldownMs < 0) throw new RangeError('Invalid rate limiter options');
    const namespace = 'rate-limiter';
    /** Entries tracked only for safe cleanup of this factory's own writes. */
    /** @type {Map<string,Bucket>} */
    const owned = new Map();
    /** @param {RateEvent} event */
    function key(event) {
        if (!event || typeof event.id !== 'string' || !event.id || event.id.length > 512
            || typeof event.chatId !== 'string' || !event.chatId || event.chatId.length > 512
            || !event.sender || typeof event.sender.jid !== 'string' || !event.sender.jid || event.sender.jid.length > 512) throw new TypeError('Invalid rate event');
        return JSON.stringify([event.chatId, event.sender.jid]);
    }
    function now() {
        const value = clock.now();
        if (!Number.isSafeInteger(value) || !Number.isSafeInteger(value + Math.max(windowMs, cooldownMs))) throw new RangeError('Invalid rate clock');
        return value;
    }
    /** Returns a copy; snapshot never mutates a retained bucket or extends its TTL.
     * @param {string} id @param {number} time @returns {Bucket} */
    function read(id, time) {
        const stored = /** @type {Bucket|undefined} */ (store.get(namespace, id));
        const cooldownUntil = stored?.cooldownUntil ?? 0;
        return { events: (stored?.events || []).filter(event => event.at + windowMs > time),
            cooldownUntil: cooldownUntil > time ? cooldownUntil : 0 };
    }
    /** @param {Bucket} bucket @param {string} messageId @returns {RateSnapshot} */
    function state(bucket, messageId) {
        const limited = bucket.events.length >= maxEvents && !bucket.events.some(event => event.id === messageId);
        return { limited, ...(limited ? { blockedUntil: bucket.events[0].at + windowMs } : {}), cooldownUntil: bucket.cooldownUntil };
    }
    /** @param {string} id @param {Bucket} bucket @param {number} time */
    function write(id, bucket, time) {
        for (const [entry, value] of owned) if (store.get(namespace, entry) !== value) owned.delete(entry);
        const last = bucket.events.at(-1);
        const expiresAt = Math.max(last ? last.at + windowMs : 0, bucket.cooldownUntil);
        if (expiresAt > time) {
            store.set(namespace, id, bucket, expiresAt - time);
            owned.set(id, bucket);
        }
    }
    /** Pure TTL read (get may lazily purge expired entries); no counter/TTL writes.
     * @param {RateEvent} event @returns {RateSnapshot} */
    function snapshot(event) { const id = key(event); return state(read(id, now()), event.id); }
    /** Idempotent admission per chat/sender/message ID; saturation does not allocate rejected IDs.
     * @param {RateEvent} event @returns {RateSnapshot} */
    function observe(event) {
        const id = key(event); const time = now(); const bucket = read(id, time);
        const result = state(bucket, event.id);
        if (!result.limited && !bucket.events.some(seen => seen.id === event.id)) {
            bucket.events.push({ id: event.id, at: time });
            write(id, bucket, time);
        }
        return result;
    }
    /** Only call after a delivered reply, never on receipt/coalescing.
     * @param {RateEvent} event @returns {RateSnapshot} */
    function markReply(event) {
        const id = key(event); const time = now(); const bucket = read(id, time);
        bucket.cooldownUntil = cooldownMs ? time + cooldownMs : 0;
        write(id, bucket, time);
        return state(bucket, event.id);
    }
    function dispose() {
        for (const [id, value] of owned) if (store.get(namespace, id) === value) store.delete(namespace, id);
        owned.clear();
    }
    return { snapshot, observe, markReply, dispose };
}
module.exports = { createRateLimiter };
