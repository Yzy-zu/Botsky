// @ts-check
'use strict';
const { createIngest } = require('./ingest');
const { createContext } = require('./context');
const { createCoalescer } = require('./coalescer');
const { gate } = require('./gate');
const { addressingPolicy } = require('../policies/addressing.policy');
const { attachmentPolicy } = require('../policies/attachment.policy');
const { createRouter } = require('./router');
const { createExecutor } = require('./executor');
const { createComposer, errorReply } = require('./composer');
/** @typedef {import('./contracts').PipelineResult} PipelineResult */
/** @typedef {import('./contracts').Ctx} Ctx */
/** @param {{clock:import('../platform/clock').Clock,store:import('../platform/ttlStore').TtlStore,queue:import('../platform/queue').TieredQueue,messenger:import('../domain/ports').Messenger,llm:import('../domain/ports').LLM,features:import('./contracts').Feature[],botJid:string,conversation:Parameters<typeof createContext>[0]['conversation'],roles?:import('./contracts').Roles,accessSnapshot?:import('./gate').AccessSnapshot,rateState?:(event:import('../domain/events').InboundEvent)=>import('./gate').RateState,passive?:(event:import('../domain/events').InboundEvent)=>Promise<unknown>,onAccept?:(event:import('../domain/events').InboundEvent)=>void,onReply?:(event:import('../domain/events').InboundEvent)=>void,sessionGroupRelaxed?:boolean,isSentId?:(chatId:string,id:string)=>boolean,rememberSent?:(chatId:string,id:string)=>void,record?:(ctx:Ctx,text:string)=>Promise<unknown>,recentReplies?:(chatId:string)=>Promise<string[]>,releaseMedia?:(ref:string)=>Promise<unknown>,responsePrivateMaxChars?:number,responseGroupMaxChars?:number,llmChatMaxOutputTokens?:number,llmRouteMaxOutputTokens?:number}} options */
function createPipeline(options) {
    const { clock, store, queue, messenger, llm, features, botJid, conversation, roles, accessSnapshot, sessionGroupRelaxed, isSentId, rememberSent, record, recentReplies } = options;
    let observationFailures = 0;
    let closed = false;
    /** @type {Set<Promise<PipelineResult>>} */ const executions = new Set();
    /** @type {Promise<void>|undefined} */ let disposal;
    /** @param {import('../domain/events').InboundEvent} event */
    function afterReply(event) { try { options.onReply?.(event); } catch { observationFailures++; } }
    const ingest = createIngest({ clock, store, botJid, isSentId });
    const context = createContext({ clock, store, conversation, roles });
    const router = createRouter({ features, llm, routeBudget: { maxOutputTokens: options.llmRouteMaxOutputTokens ?? 120, timeoutMs: 15000 } });
    const executor = createExecutor({ features, queue, clock, llm, chatMaxOutputTokens: options.llmChatMaxOutputTokens ?? 300 });
    const composer = createComposer({ messenger, llm, rememberSent, record, recentReplies, releaseMedia: options.releaseMedia,
        privateMaxChars: options.responsePrivateMaxChars ?? 600, groupMaxChars: options.responseGroupMaxChars ?? 350,
        chatMaxOutputTokens: options.llmChatMaxOutputTokens ?? 300, isClosed: () => closed });
    /** @param {import('../domain/events').InboundEvent} event @param {boolean} shadow @returns {Promise<PipelineResult>} */
    async function processEvent(event, shadow) {
        if (closed) return { kind: 'ignore', reason: 'pipeline-closed' };
        const access = gate(event, { accessSnapshot, rateState: options.rateState?.(event), now: clock.now() });
        if (!access.allow) return { kind: 'denied', reason: access.reason, event };
        // Shadow state is scoped to this pipeline instance; no business listeners.
        context.observe(event);
        const metadata = { ...context.addressingMetadata(event), now: clock.now(), botJid };
        const addressed = addressingPolicy(event, metadata, { botJid, sessionGroupRelaxed, now: clock.now() });
        if (!addressed.respond) return { kind: 'ignore', reason: addressed.reason, event, addressing: addressed };
        /** @type {Ctx} */
        let ctx = { event, addressing: addressed, history: [], correlationId: event.id, roles: roles || { admins: [], owners: [] } };
        try {
            ctx = await context.build(event, addressed);
            if (closed) return { kind: 'ignore', reason: 'pipeline-closed' };
            const attachment = attachmentPolicy(event, metadata);
            if (attachment.suggest) {
                if (shadow) return { kind: 'decision', reason: 'attachment-suggestion', event, addressing: addressed, decision: { kind: 'intent', name: 'attachment.suggest', confidence: 1, via: 'rule' } };
                const reply = await composer.compose(ctx, attachment.suggest);
                if (closed) return { kind: 'ignore', reason: 'pipeline-closed' };
                afterReply(event);
                return { kind: 'reply', event, addressing: addressed, reply };
            }
            const decision = await router.route(ctx);
            if (closed) return { kind: 'ignore', reason: 'pipeline-closed' };
            if (shadow) return { kind: 'decision', event, addressing: addressed, decision };
            const reply = await executor.execute(ctx, decision);
            if (closed) return { kind: 'ignore', reason: 'pipeline-closed' };
            const command = features.find(feature => feature.id === decision.feature)?.commands.find(item => item.name === decision.name);
            const composed = await composer.compose(ctx, reply, { allowLong: command?.allowLong, detailRequested: /** @type {Record<string,unknown>|undefined} */ (decision.args)?.detail === true, status: decision.feature === 'system-info' });
            if (closed) return { kind: 'ignore', reason: 'pipeline-closed' };
            if (composed.parts.length) afterReply(event);
            return { kind: 'reply', event, addressing: addressed, decision, reply: composed };
        } catch (error) {
            if (closed) return { kind: 'ignore', reason: 'pipeline-closed' };
            const reply = errorReply(error);
            if (!shadow) await composer.compose(ctx, reply);
            return { kind: 'error', reason: 'operation-failed', event, addressing: addressed, reply };
        }
    }
    /** @param {import('../domain/events').InboundEvent} event @param {boolean} shadow */
    function process(event, shadow) {
        const execution = processEvent(event, shadow);
        executions.add(execution);
        void execution.then(() => executions.delete(execution), () => executions.delete(execution));
        return execution;
    }
    const coalescer = createCoalescer({ clock, dispatch: event => process(event, false) });
    /** @param {unknown} raw @returns {Promise<PipelineResult>} */
    async function handle(raw) {
        if (closed) return { kind: 'ignore', reason: 'pipeline-closed' };
        const accepted = ingest.accept(raw);
        if (!accepted.accepted || !accepted.event) return { kind: 'ignore', reason: accepted.reason };
        const access = gate(accepted.event, { accessSnapshot, rateState: options.rateState?.(accepted.event), now: clock.now() });
        if (!access.allow) return { kind: 'denied', reason: access.reason, event: accepted.event };
        options.onAccept?.(accepted.event);
        if (options.passive) await options.passive(accepted.event);
        try { return /** @type {PipelineResult} */ (await coalescer.push(accepted.event)); }
        catch (error) { if (closed) return { kind: 'ignore', reason: 'pipeline-closed' }; throw error; }
    }
    /** Must be constructed with independent TTL state and read-only snapshots.
     * No executor/composer/passive/shell/jobs can run here. @param {unknown} raw @returns {Promise<PipelineResult>} */
    async function decideOnly(raw) {
        if (closed) return { kind: 'ignore', reason: 'pipeline-closed' };
        const accepted = ingest.accept(raw);
        if (!accepted.accepted || !accepted.event) return { kind: 'ignore', reason: accepted.reason };
        return process(accepted.event, true);
    }
    function dispose() {
        if (!disposal) {
            closed = true;
            coalescer.dispose();
            executor.stop();
            disposal = Promise.allSettled([coalescer.drain(), ...executions]).then(() => {});
        }
        return disposal;
    }
    return { handle, decideOnly, get observationFailures() { return observationFailures; }, dispose, context };
}
module.exports = { createPipeline };
