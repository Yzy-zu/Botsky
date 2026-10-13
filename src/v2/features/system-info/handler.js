// @ts-check
'use strict';
/** Closed snapshot: providers supply diagnostic counts, never secrets or arbitrary object dumps.
 * @typedef {{version?:string,uptimeMs?:number,queue?:{pending:number,running:number},sessions?:number,ai?:'ready'|'degraded'|'unavailable',memoryMb?:number,details?:string[]}} StatusSnapshot */
/** @param {{getStatus:(signal:AbortSignal)=>StatusSnapshot|Promise<StatusSnapshot>}} options */
function createSystemInfoHandler({ getStatus }) {
    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} args
     * @param {AbortSignal} signal @returns {Promise<import('../../domain/types').Reply>} */
    return async function systemInfo(ctx, args, signal) {
        signal.throwIfAborted();
        const status = await getStatus(signal);
        signal.throwIfAborted();
        /** @param {number|undefined} value */
        const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 'desconocido';
        const version = typeof status.version === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(status.version) ? status.version : 'desconocida';
        const ai = status.ai === 'ready' ? 'disponible' : status.ai === 'degraded' ? 'degradada' : status.ai === 'unavailable' ? 'no disponible' : 'desconocida';
        const lines = [`Botsky · ${version}`, `Activo: ${typeof status.uptimeMs === 'number' ? count(status.uptimeMs / 60000) : 'desconocido'} min`,
            `Cola: ${count(status.queue?.pending)} pendientes, ${count(status.queue?.running)} en curso`,
            `Sesiones: ${count(status.sessions)}`, `IA: ${ai}`, `Memoria: ${count(status.memoryMb)} MB`];
        // Extra lines are intentionally supplied by a trusted read-only snapshot port.
        if (args.detail === true && status.details) lines.push(...status.details.slice(0, 30));
        return { parts: [{ type: 'text', text: lines.join('\n') }], replyTo: ctx.event.id };
    };
}
module.exports = { createSystemInfoHandler };
