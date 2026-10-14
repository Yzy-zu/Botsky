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
const MAX_COMMAND_TIMEOUT_MS = 900_000;
/** @param {unknown} timeout @returns {timeout is number} */
function isValidTimeout(timeout) { return Number.isSafeInteger(timeout) && /** @type {number} */ (timeout) > 0 && /** @type {number} */ (timeout) <= MAX_COMMAND_TIMEOUT_MS; }
/** @param {{features:import('./contracts').Feature[],queue:import('../platform/queue').TieredQueue,clock:import('../platform/clock').Clock,llm:import('../domain/ports').LLM,timeoutMs?:number,chatMaxOutputTokens?:number,onProgress?:import('./contracts').ExecutorProgressHook,prepareChatContext?:(ctx:import('./contracts').Ctx,signal:AbortSignal)=>Promise<import('./contracts').PreparedChatContext>}} options */
function createExecutor({ features, queue, clock, llm, timeoutMs = 30000, chatMaxOutputTokens = 300, onProgress, prepareChatContext }) {
    if (!isValidTimeout(timeoutMs)) throw new RangeError('Invalid default executor timeout');
    for (const feature of features) {
        for (const command of feature.commands) {
            if (command.timeoutMs !== undefined && !isValidTimeout(command.timeoutMs)) {
                throw new RangeError(`Invalid timeout for command ${command.name}`);
            }
        }
    }
    let stopped = false;
    /** @type {Set<AbortController>} */ const active = new Set();
    function stop() { stopped = true; for (const controller of active) controller.abort(); }
    /** @param {import('./contracts').Ctx} ctx @param {import('./contracts').Command} command @param {import('./contracts').ProgressPhase} phase */
    function progress(ctx, command, phase) {
        if (!onProgress || stopped) return;
        const event = { correlationId: ctx.correlationId, chatId: ctx.event.chatId, command: command.name, phase };
        // Hooks are best-effort telemetry/output adapters. Never await them or let
        // a rejection change command execution, retries, or delivery behavior.
        void Promise.resolve().then(() => { if (!stopped) return onProgress(event); }).catch(() => {});
    }
    /** @param {import('./contracts').Ctx} ctx @param {import('../domain/types').Decision} decision @returns {Promise<import('../domain/types').Reply>} */
    async function execute(ctx, decision) {
        if (stopped) throw new AppError('unknown');
        if (decision.kind === 'ignore') return { parts: [] };
        if (decision.kind === 'chat') {
            let result;
            if (!prepareChatContext) {
                result = await llm.generate({ task: 'chat', budget: { maxOutputTokens: chatMaxOutputTokens, timeoutMs }, messages: [
                    ...ctx.history.map(message => ({ role: /** @type {'user'|'assistant'} */ (message.role), parts: [{ text: message.content }] })),
                    { role: 'user', parts: [{ text: ctx.event.text }] }
                ] });
            } else {
                const controller = new AbortController();
                active.add(controller);
                let handle = 0;
                const operation = (async () => {
                    controller.signal.throwIfAborted();
                    const prepared = await prepareChatContext(ctx, controller.signal);
                    controller.signal.throwIfAborted();
                    if (!prepared || !Array.isArray(prepared.parts) || prepared.parts.some(part => !validLLMPart(part))) throw new AppError('bad_output');
                    const task = prepared.task ?? 'chat';
                    const maxOutputTokens = prepared.maxOutputTokens ?? chatMaxOutputTokens;
                    if (!['chat', 'vision'].includes(task) || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 8192) throw new AppError('bad_output');
                    const response = await llm.generate({ task, budget: { maxOutputTokens, timeoutMs }, messages: [
                        ...ctx.history.map(message => ({ role: /** @type {'user'|'assistant'} */ (message.role), parts: [{ text: message.content }] })),
                        { role: 'user', parts: [{ text: ctx.event.text }, ...prepared.parts] }
                    ] });
                    controller.signal.throwIfAborted();
                    return response;
                })();
                const timeout = new Promise((_, reject) => { handle = clock.setTimeout(() => { controller.abort(); reject(new AppError('timeout')); }, timeoutMs); });
                try { result = await Promise.race([operation, timeout]); }
                finally { clock.clearTimeout(handle); active.delete(controller); }
            }
            if (!result.ok) throw new AppError(result.failure.kind);
            return { parts: [{ type: 'text', text: result.data.text || '' }] };
        }
        const entry = resolveCommand(features, decision);
        if (!entry) throw new AppError('bad_output');
        const commandTimeoutMs = entry.command.timeoutMs ?? timeoutMs;
        const access = accessPolicy({ senderJid: ctx.event.sender.jid, chatId: ctx.event.chatId, isGroup: ctx.event.isGroup, roles: ctx.roles, requiredAccess: entry.command.access, scope: entry.command.scope });
        if (!access.allow) return { parts: [{ type: 'text', text: 'Esta acción requiere permisos adicionales. Pide a una persona autorizada que la ejecute.' }] };
        const args = /** @type {Record<string,unknown>} */ (decision.args || {});
        if (!validArgs(args, entry.command.argsSchema)) throw new AppError('bad_output');
        const tracksProgress = entry.command.tier === 'heavy' && !!onProgress;
        let taskStarted = false;
        /** @param {AbortSignal} signal */
        const run = async signal => {
            if (stopped) throw new AppError('unknown');
            taskStarted = true;
            if (tracksProgress) progress(ctx, entry.command, 'running');
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
                if (tracksProgress) progress(ctx, entry.command, 'completed');
                return reply;
            } catch (error) {
                if (tracksProgress) progress(ctx, entry.command, stopped ? 'cancelled' : 'failed');
                throw error;
            } finally { signal.removeEventListener('abort', abort); active.delete(controller); }
        };
        if (entry.command.tier !== 'none') {
            if (tracksProgress) progress(ctx, entry.command, 'queued');
            try {
                return /** @type {import('../domain/types').Reply} */ (await queue.add(JSON.stringify([ctx.event.chatId, ctx.event.sender.jid]), run, entry.command.tier, entry.command.name, { timeoutMs: commandTimeoutMs }));
            } catch (error) {
                const stoppedQueue = !!error && typeof error === 'object' && 'code' in error && error.code === 'STOPPED';
                if (tracksProgress && !taskStarted) progress(ctx, entry.command, stoppedQueue || stopped ? 'cancelled' : 'failed');
                throw error;
            }
        }
        // Even unqueued commands have a deadline; abort and prevent a late reply.
        const controller = new AbortController();
        let handle = 0;
        const timeout = new Promise((_, reject) => { handle = clock.setTimeout(() => { controller.abort(); reject(new AppError('timeout')); }, commandTimeoutMs); });
        try { return /** @type {import('../domain/types').Reply} */ (await Promise.race([run(controller.signal), timeout])); }
        finally { clock.clearTimeout(handle); }
    }
    return { execute, stop };
}
/** @param {unknown} value @returns {value is import('../domain/ports').LLMPart} */
function validLLMPart(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const part = /** @type {Record<string,unknown>} */ (value);
    if (typeof part.text === 'string') return Object.keys(part).every(key => key === 'text');
    if (!part.inlineData || typeof part.inlineData !== 'object' || Array.isArray(part.inlineData)) return false;
    const data = /** @type {Record<string,unknown>} */ (part.inlineData);
    return typeof data.mimeType === 'string' && typeof data.data === 'string' && Object.keys(part).every(key => key === 'inlineData')
        && Object.keys(data).every(key => key === 'mimeType' || key === 'data');
}
module.exports = { createExecutor, validArgs, isValidTimeout, MAX_COMMAND_TIMEOUT_MS };
