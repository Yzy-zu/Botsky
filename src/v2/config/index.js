// @ts-check
'use strict';

const { ENV_SCHEMA, DYNAMIC_ENV_PATTERNS } = require('./schema');
/** @typedef {import('./schema').ConfigValue} ConfigValue */
/** @typedef {import('./schema').EnvDefinition} EnvDefinition */
/** @typedef {Readonly<Record<string,ConfigValue>>} Config */

class ConfigError extends Error {
    /** @param {string[]} issues */
    constructor(issues) {
        super(`Invalid configuration: ${issues.join('; ')}`);
        this.name = 'ConfigError';
        this.issues = Object.freeze([...issues]);
    }
}

/** @param {string} name @param {string|undefined} raw @param {EnvDefinition} definition
 * @returns {ConfigValue} */
function parseValue(name, raw, definition) {
    if (raw === undefined || raw.trim() === '') return definition.default;
    const value = raw.trim();
    switch (definition.type) {
        case 'boolean':
            if (value === 'true' || value === '1') return true;
            if (value === 'false' || value === '0') return false;
            break;
        case 'integer':
        case 'number': {
            const number = Number(value);
            if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
                && Number.isFinite(number) && (definition.type !== 'integer' || Number.isSafeInteger(number))
                && (definition.min === undefined || number >= definition.min)
                && (definition.max === undefined || number <= definition.max)) return number;
            break;
        }
        case 'list': return Object.freeze(value.split(',').map(item => item.trim()).filter(Boolean));
        case 'enum': if (definition.values?.includes(value)) return value; break;
        case 'url': {
            try {
                const url = new URL(value);
                if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return value;
            } catch (_) { /* Report field/type, never private input. */ }
            break;
        }
        case 'timezone':
            try { new Intl.DateTimeFormat('en', { timeZone: value }); return value; }
            catch (_) { break; }
        case 'hex32': if (/^[a-f\d]{64}$/i.test(value)) return value; break;
        case 'string': return value;
    }
    throw new ConfigError([`${name}: expected ${definition.type}`]);
}

/** Explicit validation, never reads dotenv/files or starts integrations.
 * @param {Record<string,string|undefined>} env
 * @param {{requireEvolution?:boolean,requireBotIdentity?:boolean}} [options]
 * @returns {Config} */
function loadConfig(env, { requireEvolution = false, requireBotIdentity = false } = {}) {
    /** @type {Record<string,ConfigValue>} */
    const config = Object.create(null);
    /** @type {string[]} */
    const issues = [];
    for (const [name, definition] of Object.entries(ENV_SCHEMA)) {
        try { config[name] = parseValue(name, env[name], definition); }
        catch (_) { issues.push(`${name}: expected ${definition.type}`); }
    }
    // Known dynamic names only. Unknown infrastructure/custom settings are excluded.
    for (const name of Object.keys(env).sort((a, b) => Number(a.slice(15)) - Number(b.slice(15)))) {
        if (Object.hasOwn(ENV_SCHEMA, name)) continue;
        if (DYNAMIC_ENV_PATTERNS.some(entry => entry.pattern.test(name))) {
            try { config[name] = parseValue(name, env[name], { type: 'list', default: Object.freeze([]),
                description: 'Dynamic Gemini keys', secret: true }); }
            catch (_) { issues.push(`${name}: expected list`); }
        }
    }
    for (const [name, definition] of Object.entries(ENV_SCHEMA)) {
        if (definition.aliasFor && !env[definition.aliasFor]?.trim() && env[name]?.trim()) {
            config[definition.aliasFor] = config[name];
        }
    }
    for (const name of ['MAX_QUEUE_LIGHT', 'MAX_QUEUE_HEAVY']) {
        if (!env[name]?.trim() && env.MAX_QUEUE_PER_USER?.trim()) config[name] = config.MAX_QUEUE_PER_USER;
    }
    if (Number(config.RAM_WARN_MB) >= Number(config.RAM_CRIT_MB)) issues.push('RAM_WARN_MB: must be below RAM_CRIT_MB');
    for (const name of ['PROACTIVE_QUIET_START', 'PROACTIVE_QUIET_END']) {
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(config[name]))) issues.push(`${name}: expected HH:mm`);
    }
    if (requireEvolution) {
        for (const name of ['EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE']) {
            if (!config[name]) issues.push(`${name}: required for Evolution connection`);
        }
    }
    if (requireBotIdentity && !config.BOT_NUMBER) issues.push('BOT_NUMBER: required for bot identity');
    if (issues.length) throw new ConfigError(issues);
    return Object.freeze(config);
}

/** Call only at the composition root; no environment reads at module load.
 * @param {{requireEvolution?:boolean,requireBotIdentity?:boolean}} [options] */
function readConfigFromProcessEnv(options) { return loadConfig(process.env, options); }

/** Deterministic pure template: defaults only, never caller credentials.
 * @returns {string} */
function generateEnvExample() {
    const lines = ['# Botsky environment schema (generated; no credentials)',
        '# Empty optional values use schema defaults. Set integration credentials before activation.',
        '# Dynamic GEMINI_API_KEY_N (positive integer N): CSV keys, secret, numeric order.',
        '# Infrastructure HOME/PATH/USER/SHELL/NODE_ENV/NODE_OPTIONS/PM2_HOME is managed by the runtime.', ''];
    for (const [name, definition] of Object.entries(ENV_SCHEMA)) {
        const suffix = [definition.secret ? 'secret' : 'public', definition.type,
            definition.aliasFor ? `alias of ${definition.aliasFor}` : '', definition.scope || ''].filter(Boolean).join('; ');
        const fallback = definition.secret ? '' : definition.default;
        const value = Array.isArray(fallback) ? fallback.join(',') : fallback === undefined ? '' : String(fallback);
        lines.push(`# ${definition.description} (${suffix})`, `${name}=${value}`, '');
    }
    return lines.join('\n');
}

module.exports = { ConfigError, loadConfig, readConfigFromProcessEnv, generateEnvExample };
