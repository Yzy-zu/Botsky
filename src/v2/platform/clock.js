// @ts-check
'use strict';

/** @typedef {{now:()=>number,setTimeout:(callback:()=>void,delayMs:number)=>number,clearTimeout:(handle:number)=>void}} Clock */
class SystemClock {
    constructor() {
        /** @type {Record<number, ReturnType<typeof setTimeout>>} */
        this.timers = {};
        this.nextId = 1;
    }
    now() { return Date.now(); }
    /** @param {()=>void} callback @param {number} delayMs */
    setTimeout(callback, delayMs) {
        const id = this.nextId++;
        this.timers[id] = setTimeout(() => { delete this.timers[id]; callback(); }, delayMs);
        this.timers[id].unref();
        return id;
    }
    /** @param {number} id */
    clearTimeout(id) { clearTimeout(this.timers[id]); delete this.timers[id]; }
    dispose() { for (const id of Object.keys(this.timers)) this.clearTimeout(Number(id)); }
}
class FakeClock {
    /** @param {number} [initialTime] */
    constructor(initialTime = 0) {
        this.time = initialTime;
        this.nextId = 1;
        /** @type {Record<number,{at:number,callback:()=>void}>} */
        this.timers = {};
    }
    now() { return this.time; }
    /** @param {()=>void} callback @param {number} delayMs */
    setTimeout(callback, delayMs) {
        if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError('Invalid delay');
        const id = this.nextId++;
        this.timers[id] = { at: this.time + delayMs, callback };
        return id;
    }
    /** @param {number} id */
    clearTimeout(id) { delete this.timers[id]; }
    /** Advance chronologically, flushing async task continuations after callbacks.
     * @param {number} ms */
    async advance(ms) {
        if (!Number.isFinite(ms) || ms < 0) throw new RangeError('Invalid advance');
        const target = this.time + ms;
        let count = 0;
        for (;;) {
            const due = Object.entries(this.timers).filter(([, timer]) => timer.at <= target)
                .sort((a, b) => a[1].at - b[1].at || Number(a[0]) - Number(b[0]))[0];
            if (!due) break;
            if (++count > 10000) throw new Error('Fake clock runaway');
            this.time = due[1].at;
            delete this.timers[Number(due[0])];
            due[1].callback();
            await this.flush();
        }
        this.time = target;
        await this.flush();
    }
    async flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
    get pendingTimers() { return Object.keys(this.timers).length; }
    dispose() { this.timers = {}; }
}
module.exports = { SystemClock, FakeClock };
