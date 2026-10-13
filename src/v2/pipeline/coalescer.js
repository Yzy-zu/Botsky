// @ts-check
'use strict';
/** @typedef {import('../domain/events').InboundEvent} InboundEvent */
/** @typedef {{events:InboundEvent[],timer:number,startedAt:number,promise:Promise<unknown>,resolve:(value:unknown)=>void,reject:(reason:unknown)=>void}} Batch */
/** @param {{clock:import('../platform/clock').Clock,windowMs?:number,maxWaitMs?:number,maxPending?:number,maxBufferedEvents?:number,dispatch:(event:InboundEvent,ids:readonly string[])=>unknown|Promise<unknown>}} options */
function createCoalescer({ clock, windowMs = 1200, maxWaitMs = 3500, maxPending = 1000, maxBufferedEvents = 10000, dispatch }) {
    if (!Number.isFinite(windowMs) || windowMs < 0 || !Number.isFinite(maxWaitMs) || maxWaitMs < windowMs || !Number.isInteger(maxPending) || maxPending < 1 || !Number.isInteger(maxBufferedEvents) || maxBufferedEvents < 1) throw new RangeError('Invalid coalescer bounds');
    /** @type {Map<string,Batch>} */ const pending = new Map();
    /** @type {Map<string,Promise<unknown>>} */ const chains = new Map();
    let disposed = false;
    let bufferedEvents = 0;
    /** @param {string} key */
    function flush(key) {
        const batch = pending.get(key);
        if (!batch) return Promise.resolve();
        pending.delete(key); clock.clearTimeout(batch.timer);
        const events = batch.events.slice().sort((a,b) => a.receivedAt - b.receivedAt);
        const last = events[events.length - 1];
        const attachment = [...events].reverse().find(event => event.media);
        const quote = [...events].reverse().find(event => event.quoted);
        const event = { ...last, text: events.map(item => item.text).filter(Boolean).join('\n'), mentions: [...new Set(events.flatMap(item => item.mentions))], ...(attachment ? { media: attachment.media, kind: attachment.kind } : {}), ...(quote ? { quoted: quote.quoted } : {}) };
        const ids = events.map(item => item.id);
        const run = () => dispatch(event, ids);
        const previous = chains.get(key);
        const result = previous ? previous.then(run, run) : Promise.resolve().then(run);
        chains.set(key, result);
        // Settlement is attached before dispatch; timer-triggered failures never become unhandled.
        result.then(value => { bufferedEvents -= events.length; batch.resolve(value); }, error => { bufferedEvents -= events.length; batch.reject(error); });
        void result.then(() => { if (chains.get(key) === result) chains.delete(key); }, () => { if (chains.get(key) === result) chains.delete(key); });
        return batch.promise;
    }
    /** @param {InboundEvent} event */
    function push(event) {
        if (disposed) return Promise.reject(new Error('Coalescer disposed'));
        if (bufferedEvents >= maxBufferedEvents) return Promise.reject(new Error('Coalescer event capacity exceeded')); 
        const key = JSON.stringify([event.chatId,event.sender.jid]);
        const previous = pending.get(key);
        // Distinct uploads preserve both identities and cannot overwrite attachment state.
        if (previous && event.media && previous.events.some(item => item.media && item.id !== event.id)) void flush(key);
        let batch = pending.get(key);
        if (!batch) {
            if (pending.size >= maxPending) return Promise.reject(new Error('Coalescer capacity exceeded'));
            /** @type {(value:unknown)=>void} */ let resolve = () => {};
            /** @type {(reason:unknown)=>void} */ let reject = () => {};
            const promise = new Promise((yes,no) => { resolve = yes; reject = no; });
            void promise.catch(() => {});
            batch = { events: [], timer: 0, startedAt: clock.now(), promise, resolve, reject };
            pending.set(key,batch);
        }
        bufferedEvents++;
        batch.events.push(event);
        clock.clearTimeout(batch.timer);
        const immediate = windowMs === 0 || event.kind === 'reaction' || event.kind === 'poll' || /^[!/#.][\p{L}\p{N}_]/u.test(event.text);
        if (immediate) return flush(key);
        const wait = Math.max(0, Math.min(windowMs, maxWaitMs - (clock.now() - batch.startedAt)));
        batch.timer = clock.setTimeout(() => { void flush(key); },wait);
        return batch.promise;
    }
    async function drain() {
        const outcomes = await Promise.allSettled([...pending.keys()].map(flush));
        const active = await Promise.allSettled([...chains.values()]);
        const rejected = [...outcomes,...active].find(result => result.status === 'rejected');
        if (rejected?.status === 'rejected') throw rejected.reason;
    }
    function dispose() {
        disposed = true;
        for (const batch of pending.values()) { clock.clearTimeout(batch.timer); bufferedEvents -= batch.events.length; batch.reject(new Error('Coalescer disposed')); }
        pending.clear();
    }
    return { push, drain, dispose, get pendingCount() { return pending.size; } };
}
module.exports = { createCoalescer };
