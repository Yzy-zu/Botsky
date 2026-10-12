// @ts-check
'use strict';
/** @typedef {import('../../platform/clock').Clock} Clock */
/** @typedef {{data:unknown,status:number}} HttpResponse */
/** @typedef {{post:(path:string,body:unknown,options?:{maxContentLength?:number})=>Promise<HttpResponse>,get:(path:string)=>Promise<HttpResponse>,put:(path:string,body:unknown)=>Promise<HttpResponse>}} HttpClient */
/** Extract public protocol classifications without retaining a raw provider body.
 * @param {unknown} data */
function sanitizedFailure(data) {
    if (!data || typeof data !== 'object') return {};
    const body = /** @type {Record<string,unknown>} */ (data);
    const codes = ['NATIVE_TABLE_INVALID','NATIVE_TABLE_UNSUPPORTED','INSTANCE_NOT_FOUND','INSTANCE_DISCONNECTED'];
    const code = typeof body.code === 'string' && codes.includes(body.code) ? body.code : undefined;
    const nested = body.response && typeof body.response === 'object' ? /** @type {Record<string,unknown>} */ (body.response) : {};
    const source = typeof nested.message === 'string' ? nested.message : typeof body.message === 'string' ? body.message : '';
    const expired = /Message not found|expired|expir/i.test(source);
    const failedMedia = /Failed to fetch stream|mmg\.whatsapp\.net|Download Media failed/.test(source);
    const message = expired ? 'Message not found expired' : failedMedia ? 'Download Media failed' : undefined;
    const payload = body.data && typeof body.data === 'object' ? /** @type {Record<string,unknown>} */ (body.data) : {};
    const candidates = [body.key, nested.key, payload.key];
    const deliveryAcknowledged = candidates.some(candidate => {
        if (!candidate || typeof candidate !== 'object') return false;
        const key = /** @type {Record<string,unknown>} */ (candidate);
        return typeof key.id === 'string' && key.id.trim().length > 0;
    });
    return { ...(code ? {code} : {}), ...(message ? {message} : {}), ...(deliveryAcknowledged ? {deliveryAcknowledged:true} : {}) };
}
class EvolutionError extends Error {
    /** @param {string} message @param {number} [status] @param {unknown} [data] */
    constructor(message, status, data) { super(message); this.name = 'EvolutionError'; const safe = sanitizedFailure(data); this.response = status ? { status, data: safe } : undefined; this.deliveryAcknowledged = safe.deliveryAcknowledged === true; this.code = 'EVOLUTION_HTTP'; }
}
/** @param {{baseUrl:string,apiKey:string,clock:Clock,timeoutMs?:number,maxResponseBytes?:number,fetch?:typeof fetch}} options */
function createClient({ baseUrl, apiKey, clock, timeoutMs = 60000, maxResponseBytes = 100 * 1024 * 1024, fetch: fetchImpl = globalThis.fetch }) {
    const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || !apiKey) throw new TypeError('Invalid Evolution connection configuration');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) throw new RangeError('Invalid HTTP bounds');
    /** @param {string} method @param {string} route @param {unknown} [body] @param {{maxContentLength?:number}} [options] */
    async function request(method, route, body, options = {}) {
        if (!route.startsWith('/') || route.startsWith('//')) throw new TypeError('Expected local API path');
        const destination = new URL(`${base.pathname.replace(/\/$/, '')}${route}`, base);
        if (destination.origin !== base.origin) throw new TypeError('External API path rejected');
        const controller = new AbortController();
        const timer = clock.setTimeout(() => controller.abort(), timeoutMs);
        const cap = Math.min(options.maxContentLength ?? maxResponseBytes, maxResponseBytes);
        try {
            const response = await fetchImpl(destination, { method, signal: controller.signal, redirect: 'error',
                headers: { 'Content-Type': 'application/json', apikey: apiKey },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            if (Number(response.headers.get('content-length')) > cap) { await response.body?.cancel(); throw new EvolutionError('Response too large', 413); }
            const reader = response.body?.getReader();
            const chunks = []; let bytes = 0;
            if (reader) {
                try {
                    for (;;) {
                        const result = await reader.read(); if (result.done) break;
                        bytes += result.value.byteLength;
                        if (bytes > cap) { await reader.cancel(); throw new EvolutionError('Response too large', 413); }
                        chunks.push(Buffer.from(result.value));
                    }
                } finally { reader.releaseLock(); }
            }
            const raw = Buffer.concat(chunks).toString('utf8');
            /** @type {unknown} */ let data;
            try { data = raw ? JSON.parse(raw) : null; } catch { throw new EvolutionError('Invalid JSON from Evolution', response.status); }
            if (!response.ok) throw new EvolutionError(`Evolution HTTP ${response.status}`, response.status, data);
            return { data, status: response.status };
        } catch (error) {
            if (error instanceof EvolutionError) throw error;
            throw new EvolutionError(controller.signal.aborted ? 'Evolution request timed out' : 'Evolution transport failed');
        } finally { clock.clearTimeout(timer); }
    }
    return {
        /** @param {string} route @param {unknown} body @param {{maxContentLength?:number}} [options] */
        post: (route, body, options) => request('POST', route, body, options),
        /** @param {string} route */
        get: route => request('GET', route),
        /** @param {string} route @param {unknown} body */
        put: (route, body) => request('PUT', route, body)
    };
}
/** Retry legacy-safe operations only; text/media/voice/edit deliberately bypass.
 * @param {()=>Promise<any>} run @param {Clock} clock @param {number} [retries] @param {number} [delayMs] */
async function withRetry(run, clock, retries = 2, delayMs = 1500) {
    for (let attempt = 0; ; attempt++) {
        try { return await run(); }
        catch (error) {
            const err = /** @type {any} */ (error);
            if (err.deliveryAcknowledged === true || err.response?.data?.deliveryAcknowledged === true || err.code === 'MEDIA_TOO_LARGE' || [400, 401, 403, 404].includes(err.response?.status) || attempt >= retries) throw err;
            await new Promise(resolve => clock.setTimeout(() => resolve(undefined), delayMs));
        }
    }
}
/** @param {unknown} number */
function normalizeJid(number) { const value = number ? String(number).trim() : ''; return value && !value.includes('@') ? `${value}@s.whatsapp.net` : value; }
module.exports = { createClient, EvolutionError, withRetry, normalizeJid };
