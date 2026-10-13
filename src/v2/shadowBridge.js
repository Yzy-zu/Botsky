// @ts-check
'use strict';
/** @typedef {import('./platform/clock').Clock} Clock */
/** @typedef {import('./platform/shadow').ShadowDiff} ShadowDiff */
/** @typedef {{kind:'chat'|'ignore'|'intent',intent?:string,args?:Record<string,unknown>}} RecordedPlan */
/** @typedef {{chatId:string,messageId:string,kind:string,feature?:string,via?:string,respond?:boolean,reason?:string,plan?:RecordedPlan}} V1Decision */
/** @typedef {{resolve:(value:V1Decision|undefined)=>void,promise:Promise<V1Decision|undefined>,timer:number}} Pending */
/** Dedicated sidecar sink only; no business callbacks or providers are accepted.
 * @param {{clock:Clock,sink:(diff:ShadowDiff)=>void|Promise<void>,config:Readonly<Record<string,unknown>>,features?:import('./pipeline/contracts').Feature[],botJid?:string,maxPending?:number,decisionTimeoutMs?:number}} options */
function createShadowBridge({ clock, sink, config, features, botJid = '', maxPending = 32, decisionTimeoutMs = 10000 }) {
    if (config.PIPELINE_MODE !== 'shadow') return disabledBridge();
    if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 1000 || !Number.isSafeInteger(decisionTimeoutMs) || decisionTimeoutMs < 1) throw new RangeError('Invalid shadow bridge bounds');
    // These factories are loaded only after an explicit shadow configuration.
    const { TtlStore } = require('./platform/ttlStore');
    const { TieredQueue } = require('./platform/queue');
    const { createShadowObserver, createNullMessenger } = require('./platform/shadow');
    const { createPipeline } = require('./pipeline');
    const { normalize, normalizeJid } = require('./pipeline/normalize');
    const store = new TtlStore({ clock, maxEntries: 10000 });
    const queue = new TieredQueue({ clock });
    /** @type {Map<string,Pending>} */ const pending = new Map();
    /** @type {V1Decision|undefined} */ let current;
    let unavailable = false; let dropped = 0; let timedOut = 0; let unknownRecords = 0; let clipped = 0; let echoSeeds = 0;
    let stopped = false;
    /** @type {number|undefined} */ let stoppedAt;
    /** @type {import('./pipeline/contracts').Feature[]} */
    const registered = features || [
        require('./features/help/manifest').createHelpFeature({ features: () => registered }),
        require('./features/system-info/manifest').createSystemInfoFeature({ getStatus: () => { throw new Error('Shadow business snapshot forbidden'); } })
    ];
    /** @type {import('./domain/ports').LLM} */
    const replay = { generate: async request => {
        if (request.task !== 'route') throw new Error('Shadow model generation forbidden');
        const plan = current?.plan || (current?.kind === 'chat' || current?.kind === 'ignore' ? { kind: current.kind } : undefined);
        const allowed = plan && (plan.kind === 'chat' || plan.kind === 'ignore' || (plan.kind === 'intent' && registered.some(feature => feature.enabled !== false && feature.intents?.some(intent => intent.id === plan.intent))));
        if (!allowed) { unavailable = true; return { ok: false, failure: { kind: 'unknown', retryable: false } }; }
        return { ok: true, data: { text: JSON.stringify(plan), parts: [], toolCalls: [], provider: 'gemini' } };
    } };
    const pipeline = createPipeline({ clock, store, queue, messenger: createNullMessenger(), llm: replay, features: registered, botJid,
        // Empty immutable history is intentional: no repo access, XP, shell, downloads or jobs.
        conversation: { recent: async () => [], recentThread: async () => [] },
        isSentId: (chatId,id) => store.get('shadow.sent',JSON.stringify([chatId,id])) === true });
    const clippedEvents = new WeakSet();
    /** @type {WeakMap<object,Promise<V1Decision|undefined>>} */ const observations = new WeakMap();
    const observer = createShadowObserver({ clock, writeDiff: sink, maxPending, allowedFeatures: registered.map(feature => feature.id),
        allowedReasons: ['v1-unavailable','recorded-plan-unavailable','shadow-input-clipped'],
        decideOnly: async raw => {
            const wait = raw && typeof raw === 'object' ? observations.get(raw) : undefined;
            current = wait ? await wait : undefined; unavailable = false;
            try {
                const result = await pipeline.decideOnly(raw);
                if (raw && typeof raw === 'object' && clippedEvents.has(raw)) return {kind:'unknown',reason:'shadow-input-clipped',addressing:result.addressing};
                if (unavailable) return { kind:'unknown', reason:'recorded-plan-unavailable', addressing:result.addressing };
                return result;
            } finally { current = undefined; }
        }
    });
    /** Immediate admission, independent of business dispatch. @param {unknown} raw */
    function observeWebhook(raw) {
        if (stopped) { dropped++; return false; }
        const normalized = normalize(raw, { clock, botJid });
        if (!normalized) { unknownRecords++; return false; }
        const key = JSON.stringify([normalized.chatId,normalized.id]);
        if (normalized.isFromMe) { store.set('shadow.sent',key,true,600000); echoSeeds++; return true; }
        if (pending.size >= maxPending) { dropped++; return false; }
        if (pending.has(key)) { dropped++; return false; }
        // Retain no provider envelope/inline bytes. Text remains transient, never sink input.
        const event = { ...normalized, raw: {}, sender: { ...normalized.sender, name: normalized.sender.name.slice(0,128) }, text: normalized.text.slice(0,16384), ...(normalized.quoted ? { quoted: { ...normalized.quoted, text: normalized.quoted.text?.slice(0,4096) } } : {}) };
        if (event.text.length !== normalized.text.length) { clipped++; clippedEvents.add(event); }
        /** @type {(value:V1Decision|undefined)=>void} */ let resolve = () => {};
        const promise = new Promise(yes => { resolve = yes; });
        const timer = clock.setTimeout(() => { pending.delete(key); timedOut++; resolve(undefined); },decisionTimeoutMs);
        pending.set(key,{ resolve,promise,timer }); observations.set(event,promise);
        const v1 = promise.then(value => value || { kind:'unknown',reason:'v1-unavailable' });
        if (!observer.observe(event,v1)) { clock.clearTimeout(timer); pending.delete(key); resolve(undefined); dropped++; return false; }
        return true;
    }
    /** Capture actual branch/handler decision only. Never infer ignore from absence.
     * @param {V1Decision} decision */
    function recordV1Decision(decision) {
        if (stopped || !decision || typeof decision.chatId !== 'string' || typeof decision.messageId !== 'string') return false;
        const key = JSON.stringify([normalizeJid(decision.chatId),decision.messageId]);
        const entry = pending.get(key);
        if (!entry) { unknownRecords++; return false; }
        clock.clearTimeout(entry.timer); pending.delete(key);
        // Drop IDs before observer sanitization. Plans stay exclusively in transient memory.
        let plan;
        try { if (decision.plan) plan = /** @type {RecordedPlan} */(JSON.parse(JSON.stringify(decision.plan))); } catch { unknownRecords++; }
        entry.resolve({ ...decision,plan }); return true;
    }
    function status() {
        const stats = observer.stats();
        return { enabled: true, ...stats, ...(stoppedAt === undefined ? {} : { observedUntil:stoppedAt,elapsedMs:Math.max(0,stoppedAt-stats.startedAt) }), awaitingV1: pending.size, bridgeDropped: dropped, v1TimedOut: timedOut, unmatchedRecords: unknownRecords, clipped, echoSeeds }; }
    function stop() {
        stopped = true; stoppedAt ??= clock.now();
        for (const entry of pending.values()) { clock.clearTimeout(entry.timer); entry.resolve(undefined); }
        pending.clear(); observer.stop(); pipeline.dispose(); store.dispose(); queue.stop();
    }
    return { observeWebhook,recordV1Decision,status,stop,flush: observer.flush };
}
function disabledBridge() { return { observeWebhook: /** @param {unknown} _raw */ (_raw) => false,recordV1Decision: /** @param {V1Decision} _decision */ (_decision) => false,status: () => ({ enabled:false }),stop: () => {},flush:async () => {} }; }
module.exports = { createShadowBridge };
