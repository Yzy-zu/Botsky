// @ts-check
'use strict';
/** @typedef {{clock:{now:()=>number},write:(line:string)=>void,secrets?:string[],allowedEvents?:string[],allowedFields?:string[],allowedValues?:Record<string,string[]>}} LoggerOptions */
/** @param {LoggerOptions} options */
function createLogger({ clock, write, secrets = [], allowedEvents = [], allowedFields = ['latencyMs','ok','count','size','error','self','retryable','depth','durationMs','attempts'], allowedValues = {} }) {
    const events = new Set(allowedEvents);
    const values = Object.fromEntries(Object.entries(allowedValues).map(([key,options]) => [key,[...options]]));
    const fields = new Set([...allowedFields,...Object.keys(values),'correlationId']);
    const configuredSecrets = [...secrets].filter(Boolean);
    /** @param {unknown} value @param {number} [depth] @param {Set<object>} [seen] @param {string} [field] @returns {unknown} */
    function sanitize(value, depth = 0, seen = new Set(), field = '') {
        if (depth > 5) return '[TRUNCATED]';
        if (value instanceof Error) {
            const kind = Object.getOwnPropertyDescriptor(value, 'kind')?.value;
            return { name: 'Error', kind: ['quota','auth_key','timeout','safety_block','bad_output','unsupported_media','too_large','network','unknown'].includes(kind) ? kind : 'unknown' };
        }
        if (typeof value === 'string') {
            if (field === 'correlationId' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
            if (Object.hasOwn(values,field) && values[field].includes(value)) return value;
            // Caller supplies closed technical vocabularies, never user text.
            return '[REDACTED]';
        }
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        if (typeof value === 'boolean' || value === null) return value;
        if (!value || typeof value !== 'object') return '[REDACTED]';
        if (seen.has(value)) return '[CIRCULAR]'; seen.add(value);
        if (Array.isArray(value)) return value.slice(0, 32).map(v => sanitize(v, depth + 1, seen));
        /** @type {Record<string,unknown>} */ const result = {};
        for (const name of Object.keys(value).slice(0, 32)) {
            if (!fields.has(name) || !/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(name) || /secret|key|token|auth|jid|text|prompt|caption|message|stack|url|header|raw|body|number|name|command/i.test(name)) continue;
            const descriptor = Object.getOwnPropertyDescriptor(value, name);
            if (descriptor && 'value' in descriptor) result[name] = sanitize(descriptor.value, depth + 1, seen, name);
        }
        return result;
    }
    /** @param {string} level @param {string} event @param {unknown} [fields] */
    function log(level, event, fields = {}) {
        const safeEvent = events.has(event) && /^[a-z][a-z0-9_.-]{0,80}$/.test(event) ? event : 'redacted';
        const line = JSON.stringify({timestamp:clock.now(),level,event:safeEvent,fields:sanitize(fields)}, (_key,value) => {
            if (typeof value !== 'string') return value;
            return configuredSecrets.reduce((text,secret) => text.split(secret).join('[REDACTED]'),value);
        });
        try { write(line + '\n'); } catch { /* Logging cannot change business outcome. */ }
    }
    return { info: /** @param {string} e @param {unknown} [f] */ (e,f) => log('info',e,f),
        warn: /** @param {string} e @param {unknown} [f] */ (e,f) => log('warn',e,f),
        error: /** @param {string} e @param {unknown} [f] */ (e,f) => log('error',e,f) };
}
module.exports = { createLogger };
