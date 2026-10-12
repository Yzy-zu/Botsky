// @ts-check
'use strict';
/** @typedef {import('./clock').Clock} Clock */
/** @typedef {{run:()=>unknown|Promise<unknown>,intervalMs:number,lastRun:number,running:boolean}} Job */
class Scheduler {
    /** @param {{clock:Clock,tickMs?:number,onError?:(error:unknown,id:string)=>void}} options */
    constructor({ clock, tickMs = 10000, onError = () => {} }) {
        if (!Number.isFinite(tickMs) || tickMs <= 0) throw new RangeError('Invalid tick interval');
        this.clock = clock;
        this.tickMs = tickMs;
        this.onError = onError;
        /** @type {Record<string,Job>} */
        this.jobs = Object.create(null);
        /** @type {Record<string,boolean>} */
        this.runningJobs = Object.create(null);
        /** @type {Set<Promise<void>>} */
        this.executions = new Set();
        /** @type {number|undefined} */
        this.timer = undefined;
        this.started = false;
        this.disposed = false;
    }
    /** @param {string} id @param {number} intervalMs @param {()=>unknown|Promise<unknown>} run */
    register(id, intervalMs, run) {
        if (this.disposed) throw new Error('Scheduler disposed');
        if (!id || !Number.isFinite(intervalMs) || intervalMs <= 0 || typeof run !== 'function') throw new RangeError('Invalid job');
        if (this.jobs[id] || this.runningJobs[id]) throw new Error('Job already registered or running');
        this.jobs[id] = { run, intervalMs, lastRun: this.clock.now(), running: false };
        return () => this.unregister(id);
    }
    /** @param {string} id */
    unregister(id) { const present = id in this.jobs; delete this.jobs[id]; return present; }
    /** @param {string} id @param {Job} job */
    launch(id, job) {
        if (job.running) return Promise.resolve();
        job.running = true;
        this.runningJobs[id] = true;
        job.lastRun = this.clock.now();
        const execution = (async () => {
            try { await job.run(); }
            catch (error) { try { this.onError(error, id); } catch { /* Logging must not break ticker. */ } }
            finally { job.running = false; delete this.runningJobs[id]; }
        })();
        this.executions.add(execution);
        void execution.then(() => this.executions.delete(execution));
        return execution;
    }
    tick() {
        if (this.disposed) return;
        for (const [id, job] of Object.entries(this.jobs)) {
            if (!job.running && this.clock.now() - job.lastRun >= job.intervalMs) void this.launch(id, job);
        }
    }
    async runAllMaintenance() {
        if (this.disposed) return;
        for (const [id, job] of Object.entries(this.jobs)) await this.launch(id, job);
    }
    schedule() {
        this.timer = this.clock.setTimeout(() => {
            this.timer = undefined;
            if (!this.started) return;
            this.tick();
            if (this.started) this.schedule();
        }, this.tickMs);
    }
    start() {
        if (this.disposed) throw new Error('Scheduler disposed');
        if (this.started) return;
        this.started = true;
        this.schedule();
    }
    stop() {
        this.started = false;
        if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
        this.timer = undefined;
    }
    async dispose() { this.stop(); this.disposed = true; this.jobs = Object.create(null); await Promise.all(this.executions); }
    getRegisteredTasks() { return Object.keys(this.jobs); }
}
module.exports = { Scheduler };
