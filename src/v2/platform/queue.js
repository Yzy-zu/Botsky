// @ts-check
'use strict';
/** @typedef {import('./clock').Clock} Clock */
/** @typedef {{concurrency:number,maxPerUser:number,maxPending?:number}} TierConfig */
/** @typedef {{userId:string,priority:number,task:(signal:AbortSignal)=>unknown|Promise<unknown>,resolve:(value:unknown)=>void,reject:(error:unknown)=>void,timeoutMs:number}} Entry */
/** @typedef {{config:TierConfig,running:number,pending:Entry[],users:Record<string,number>}} Tier */
class QueueError extends Error {
    /** @param {string} code @param {string} message */
    constructor(code, message) { super(message); this.name = 'QueueError'; this.code = code; }
}
/** Translate already validated config; this module never reads process.env.
 * @param {{MAX_QUEUE_LIGHT?:number,MAX_QUEUE_HEAVY?:number,MAX_QUEUE_PER_USER?:number}} [config] */
function queueConfig(config = {}) {
    return {
        light: { concurrency: 4, maxPerUser: config.MAX_QUEUE_LIGHT ?? config.MAX_QUEUE_PER_USER ?? 5, maxPending: 100 },
        heavy: { concurrency: 2, maxPerUser: config.MAX_QUEUE_HEAVY ?? config.MAX_QUEUE_PER_USER ?? 3, maxPending: 100 }
    };
}
class TieredQueue {
    /** @param {{clock:Clock,tiers?:Record<string,TierConfig>}} options */
    constructor({ clock, tiers = queueConfig() }) {
        this.clock = clock;
        this.stopped = false;
        /** @type {Record<string,Tier>} */
        this.tiers = Object.create(null);
        /** @type {Set<Promise<void>>} */
        this.executions = new Set();
        for (const [name, config] of Object.entries(tiers)) {
            for (const value of [config.concurrency, config.maxPerUser, config.maxPending ?? 100]) {
                if (!Number.isInteger(value) || value <= 0) throw new RangeError('Invalid queue limits');
            }
            this.tiers[name] = { config: { ...config, maxPending: config.maxPending ?? 100 }, running: 0, pending: [], users: Object.create(null) };
        }
        if (!this.tiers.heavy || !this.tiers.light) throw new Error('Both tiers are required');
    }
    /** @param {string} userId @param {(signal:AbortSignal)=>unknown|Promise<unknown>} task
     * @param {string} [tierName] @param {string} [taskName]
     * @param {{priority?:number,timeoutMs?:number}} [options] @returns {Promise<unknown>} */
    add(userId, task, tierName = 'heavy', taskName = 'Tarea', options = {}) {
        if (this.stopped) return Promise.reject(new QueueError('STOPPED', 'Queue stopped'));
        const tier = this.tiers[tierName] || this.tiers.heavy;
        const timeoutMs = options.timeoutMs ?? 0;
        if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(options.priority ?? 0)) return Promise.reject(new QueueError('INVALID', 'Invalid task options'));
        if ((tier.users[userId] ?? 0) >= tier.config.maxPerUser) return Promise.reject(new QueueError('USER_LIMIT', 'User queue limit reached'));
        if (tier.running >= tier.config.concurrency && tier.pending.length >= (tier.config.maxPending ?? 100)) return Promise.reject(new QueueError('BACKPRESSURE', 'Queue capacity reached'));
        tier.users[userId] = (tier.users[userId] ?? 0) + 1;
        return new Promise((resolve, reject) => {
            const entry = { userId, task, resolve, reject, timeoutMs, priority: options.priority ?? 0 };
            const position = tier.pending.findIndex(item => item.priority < entry.priority);
            if (position < 0) tier.pending.push(entry); else tier.pending.splice(position, 0, entry);
            this.run(tier);
        });
    }
    /** @param {Tier} tier */
    run(tier) {
        while (!this.stopped && tier.running < tier.config.concurrency && tier.pending.length) {
            const entry = /** @type {Entry} */ (tier.pending.shift());
            tier.running++;
            const execution = this.execute(tier, entry);
            this.executions.add(execution);
            void execution.then(() => this.executions.delete(execution));
        }
    }
    /** @param {Tier} tier @param {Entry} entry */
    async execute(tier, entry) {
        const abort = new AbortController();
        let settled = false;
        /** @type {number|undefined} */
        let timer;
        if (entry.timeoutMs) timer = this.clock.setTimeout(() => {
            settled = true;
            abort.abort();
            entry.reject(new QueueError('TIMEOUT', 'Task deadline exceeded'));
        }, entry.timeoutMs);
        try {
            const result = await entry.task(abort.signal);
            if (!settled) entry.resolve(result);
        } catch (error) {
            if (!settled) entry.reject(error);
        } finally {
            if (timer !== undefined) this.clock.clearTimeout(timer);
            // A timeout rejects the caller but retains the slot until task exit.
            tier.running--;
            tier.users[entry.userId]--;
            if (!tier.users[entry.userId]) delete tier.users[entry.userId];
            this.run(tier);
        }
    }
    stop() {
        this.stopped = true;
        for (const tier of Object.values(this.tiers)) {
            for (const entry of tier.pending.splice(0)) {
                tier.users[entry.userId]--;
                if (!tier.users[entry.userId]) delete tier.users[entry.userId];
                entry.reject(new QueueError('STOPPED', 'Queue stopped'));
            }
        }
    }
    async dispose() { this.stop(); await Promise.all(this.executions); }
    get stats() {
        return Object.fromEntries(Object.entries(this.tiers).map(([name, tier]) => [name, {
            running: tier.running, pending: tier.pending.length, concurrency: tier.config.concurrency, users: { ...tier.users }
        }]));
    }
}
module.exports = { TieredQueue, QueueError, queueConfig };
