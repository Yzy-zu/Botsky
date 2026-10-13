// @ts-check
'use strict';
const { resolveCommand } = require('./router');
const { AppError } = require('../domain/errors');
const { isReply } = require('../domain/types');
const { accessPolicy } = require('../policies/access.policy');
/** @param {unknown} args @param {Record<string,unknown>|undefined} schema */
function validArgs(args, schema) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
    if (!schema) return true;
    const value = /** @type {Record<string,unknown>} */ (args);
    const properties = /** @type {Record<string,{type?:string,enum?:unknown[],minimum?:number,maximum?:number,maxLength?:number,minLength?:number}>} */ (schema.properties || {});
    const required = /** @type {string[]} */ (schema.required || []);
    if (required.some(key => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(properties, key))) return false;
    return Object.entries(properties).every(([key, rule]) => {
        const item = value[key];
        if (item === undefined) return true;
        if (rule.enum && !rule.enum.includes(item)) return false;
        if (rule.type === 'integer') return typeof item === 'number' && Number.isSafeInteger(item) && (rule.minimum === undefined || item >= rule.minimum) && (rule.maximum === undefined || item <= rule.maximum);
        if (rule.type === 'string' && typeof item === 'string' && ((rule.maxLength !== undefined && Array.from(item).length > rule.maxLength) || (rule.minLength !== undefined && Array.from(item).length < rule.minLength))) return false;
        if (rule.type === 'number' && typeof item === 'number' && (!Number.isFinite(item) || (rule.minimum !== undefined && item < rule.minimum) || (rule.maximum !== undefined && item > rule.maximum))) return false;
        if (rule.type === 'array') return Array.isArray(item);
        if (rule.type === 'object') return !!item && typeof item === 'object' && !Array.isArray(item);
        return !rule.type || typeof item === rule.type;
    });
}
/** @param {{features:import('./contracts').Feature[],queue:import('../platform/queue').TieredQueue,clock:import('../platform/clock').Clock,llm:import('../domain/ports').LLM,timeoutMs?:number}} options */
function createExecutor({ features, queue, clock, llm, timeoutMs = 30000 }) {
    let stopped = false;
    /** @type {Set<AbortController>} */ const active = new Set();
    function stop() { stopped = true; for (const controller of active) controller.abort(); }
    /** @param {import('./contracts').Ctx} ctx @param {import('../domain/types').Decision} decision @returns {Promise<import('../domain/types').Reply>} */
    async function execute(ctx, decision) {
        if (stopped) throw new AppError('unknown');
        if (decision.kind === 'ignore') return { parts: [] };
        if (decision.kind === 'chat') {
            const result = await llm.generate({ task: 'chat', budget: { maxOutputTokens: 300, timeoutMs }, messages: [
                ...ctx.history.map(message => ({ role: /** @type {'user'|'assistant'} */ (message.role), parts: [{ text: message.content }] })),
                { role: 'user', parts: [{ text: ctx.event.text }] }
            ] });
            if (!result.ok) throw new AppError(result.failure.kind);
            return { parts: [{ type: 'text', text: result.data.text || '' }] };
        }
        const entry = resolveCommand(features, decision);
        if (!entry) throw new AppError('bad_output');
        const access = accessPolicy({ senderJid: ctx.event.sender.jid, chatId: ctx.event.chatId, isGroup: ctx.event.isGroup, roles: ctx.roles, requiredAccess: entry.command.access, scope: entry.command.scope });
        if (!access.allow) return { parts: [{ type: 'text', text: 'Esta acción requiere permisos adicionales. Pide a una persona autorizada que la ejecute.' }] };
        const args = /** @type {Record<string,unknown>} */ (decision.args || {});
        if (!validArgs(args, entry.command.argsSchema)) throw new AppError('bad_output');
        /** @param {AbortSignal} signal */
        const run = async signal => {
            if (stopped) throw new AppError('unknown');
            const controller = new AbortController();
            const abort = () => controller.abort();
            signal.addEventListener('abort', abort, { once: true });
            active.add(controller);
            try {
                if (signal.aborted) controller.abort();
                controller.signal.throwIfAborted();
                const reply = await entry.command.handler(ctx, args, controller.signal);
                controller.signal.throwIfAborted();
                if (!isReply(reply)) throw new AppError('bad_output');
                return reply;
            } finally { signal.removeEventListener('abort', abort); active.delete(controller); }
        };
        if (entry.command.tier !== 'none') return /** @type {Promise<import('../domain/types').Reply>} */ (queue.add(JSON.stringify([ctx.event.chatId, ctx.event.sender.jid]), run, entry.command.tier, entry.command.name, { timeoutMs }));
        // Even unqueued commands have a deadline; abort and prevent a late reply.
        const controller = new AbortController();
        let handle = 0;
        const timeout = new Promise((_, reject) => { handle = clock.setTimeout(() => { controller.abort(); reject(new AppError('timeout')); }, timeoutMs); });
        try { return /** @type {import('../domain/types').Reply} */ (await Promise.race([run(controller.signal), timeout])); }
        finally { clock.clearTimeout(handle); }
    }
    return { execute, stop };
}
module.exports = { createExecutor, validArgs };
