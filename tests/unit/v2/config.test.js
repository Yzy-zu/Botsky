'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ENV_SCHEMA, DYNAMIC_ENV_PATTERNS, INFRASTRUCTURE_ENV } = require('../../../src/v2/config/schema');
const { loadConfig, readConfigFromProcessEnv, ConfigError, generateEnvExample } = require('../../../src/v2/config');
const project = path.resolve(__dirname, '../../..');

test('imports have no environment read, dotenv, I/O or integration startup', () => {
    const filename = path.join(project, 'src/v2/config/index.js');
    execFileSync(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        const Module = require('node:module');
        const old = Module._load;
        Module._load = function(name, ...args) {
            assert.ok(!/dotenv|sqlite3|axios/.test(name));
            return old.call(this, name, ...args);
        };
        let reads = 0;
        const env = process.env;
        process.env = new Proxy(env, { get(target, key) { reads++; return target[key]; }, ownKeys(target) { reads++; return Reflect.ownKeys(target); } });
        const before = reads;
        require(${JSON.stringify(filename)});
        assert.equal(reads, before);
    `]);
});

test('defaults document every field and remain immutable without personal paths', () => {
    const config = loadConfig({});
    assert.ok(Object.keys(config).length > 85);
    assert.equal(Object.keys(config).length, Object.keys(ENV_SCHEMA).length);
    assert.equal(config.PIPELINE_MODE, 'legacy');
    assert.equal(config.FEATURE_ADMIN_TERMINAL, false);
    assert.equal(config.FEATURE_ADULT_MEDIA, false);
    assert.equal(config.PROACTIVE_ENABLED, false);
    assert.equal(config.REFRACTOR_CAPTURE_ENABLED, false);
    assert.equal(config.MAX_DOCUMENT_SIZE_MB, 200);
    assert.equal(config.WHISPER_LANGUAGE, 'auto');
    assert.equal(config.YTDLP_DEFAULT_QUALITY, 480);
    assert.ok(Object.isFrozen(config));
    assert.ok(Object.isFrozen(ENV_SCHEMA));
    for (const [name, definition] of Object.entries(ENV_SCHEMA)) {
        assert.ok(definition.description, name);
        assert.ok(Object.isFrozen(definition));
        assert.equal(typeof definition.secret, 'boolean');
        assert.equal(String(definition.default).includes('/home/petrov'), false);
        if (Array.isArray(config[name])) assert.ok(Object.isFrozen(config[name]));
    }
    assert.throws(() => { config.TZ = 'UTC'; }, TypeError);
});

test('strict scalar/list parsing supports CSV keys, whitespace and explicit zero', () => {
    const config = loadConfig({ TZ: ' UTC ', WEBHOOK_PORT: ' 65535 ', EVOLUTION_API_URL: 'https://example.invalid/api',
        PIPELINE_MODE: 'shadow', MESSAGE_DEBOUNCE_MS: '0', PROACTIVE_MAX_PER_DAY: '0', MAX_FILE_SIZE_MB: '10.5',
        GEMINI_API_KEY: ' first, ,second ', GEMINI_API_KEY_9: 'third,fourth', GEMINI_API_KEYS: 'fifth',
        ALLOWED_GROUPS_NORMAL: 'synthetic-a@g.us,synthetic-b@g.us', MASTER_KEY: 'a'.repeat(64),
        FEATURE_ADMIN_TERMINAL: 'true', FEATURE_ADULT_MEDIA: '1', PROACTIVE_ENABLED: '0',
        REFRACTOR_CAPTURE_ENABLED: 'false', WEBHOOK_SECRET: ' synthetic ' });
    assert.equal(config.TZ, 'UTC');
    assert.equal(config.WEBHOOK_PORT, 65535);
    assert.equal(config.MESSAGE_DEBOUNCE_MS, 0);
    assert.equal(config.MAX_FILE_SIZE_MB, 10.5);
    assert.deepEqual(config.GEMINI_API_KEY, ['first', 'second']);
    assert.deepEqual(config.GEMINI_API_KEY_9, ['third', 'fourth']);
    assert.deepEqual(config.ALLOWED_GROUPS_NORMAL, ['synthetic-a@g.us', 'synthetic-b@g.us']);
    assert.equal(config.MASTER_KEY, 'a'.repeat(64));
    assert.equal(config.FEATURE_ADMIN_TERMINAL, true);
    assert.equal(config.FEATURE_ADULT_MEDIA, true);
    assert.equal(config.PROACTIVE_ENABLED, false);
    assert.equal(config.WEBHOOK_SECRET, 'synthetic');
    assert.equal(config.PIPELINE_MODE, 'shadow');
    assert.equal(config.EVOLUTION_API_URL, 'https://example.invalid/api');
});

test('invalid fields aggregate clear errors without exposing their values', () => {
    const env = { WEBHOOK_PORT: 'private-port-value', EVOLUTION_API_URL: 'https://private-user:private-pass@example.invalid',
        GEMINI_TIMEOUT_MS: 'Infinity', RAM_WARN_MB: '-1', MASTER_KEY: 'private-master-key',
        TZ: 'private-zone-value', PIPELINE_MODE: 'private-mode', LEGACY_COMMAND_USAGE_ENABLED: 'private-boolean',
        PROACTIVE_QUIET_START: 'private-time', PROACTIVE_QUIET_END: '25:77' };
    assert.throws(() => loadConfig(env), error => {
        assert.ok(error instanceof ConfigError);
        assert.ok(error.issues.length >= 10);
        for (const value of Object.values(env)) assert.ok(!error.message.includes(value));
        assert.equal(error.name, 'ConfigError');
        assert.ok(Object.isFrozen(error.issues));
        return true;
    });
    for (const value of ['1.1', '0', '65536', '12junk', '0x10', 'NaN', '1e99']) {
        assert.throws(() => loadConfig({ WEBHOOK_PORT: value }), ConfigError);
    }
    for (const value of ['ftp://example.invalid', 'not-a-url']) {
        assert.throws(() => loadConfig({ EVOLUTION_API_URL: value }), ConfigError);
    }
    assert.throws(() => loadConfig({ MAX_FILE_SIZE_MB: '-2' }), ConfigError);
    assert.throws(() => loadConfig({ RAM_WARN_MB: '900', RAM_CRIT_MB: '700' }), /RAM_WARN_MB/);
});

test('required integrations validate only during explicit load and names stay private', () => {
    assert.doesNotThrow(() => loadConfig({}));
    assert.throws(() => loadConfig({}, { requireEvolution: true, requireBotIdentity: true }), error => {
        assert.ok(error.message.includes('EVOLUTION_API_KEY'));
        assert.ok(error.message.includes('BOT_NUMBER'));
        return true;
    });
    assert.doesNotThrow(() => loadConfig({ EVOLUTION_API_KEY: 'synthetic', BOT_NUMBER: 'synthetic' },
        { requireEvolution: true, requireBotIdentity: true }));
});

test('aliases and queue fallback use explicit canonical precedence', () => {
    let config = loadConfig({ COOKIES_FILE: './alias.txt', WHATSAPP_MAX_MB: '30', MAX_QUEUE_PER_USER: '7' });
    assert.equal(config.YOUTUBE_COOKIES_FILE, './alias.txt');
    assert.equal(config.WHATSAPP_MAX_MEDIA_MB, 30);
    assert.equal(config.MAX_QUEUE_LIGHT, 7);
    assert.equal(config.MAX_QUEUE_HEAVY, 7);
    config = loadConfig({ COOKIES_FILE: './alias.txt', YOUTUBE_COOKIES_FILE: './canonical.txt',
        WHATSAPP_MAX_MB: '30', WHATSAPP_MAX_MEDIA_MB: '40', MAX_QUEUE_PER_USER: '7', MAX_QUEUE_LIGHT: '2' });
    assert.equal(config.YOUTUBE_COOKIES_FILE, './canonical.txt');
    assert.equal(config.WHATSAPP_MAX_MEDIA_MB, 40);
    assert.equal(config.MAX_QUEUE_LIGHT, 2);
    assert.equal(config.MAX_QUEUE_HEAVY, 7);
    assert.equal(loadConfig({ MAX_QUEUE_PER_USER: ' ' }).MAX_QUEUE_LIGHT, 5);
});

test('dynamic key names are closed and infrastructure/unknown values are excluded', () => {
    const config = loadConfig({ GEMINI_API_KEY_10: 'ten', GEMINI_API_KEY_4: 'four', GEMINI_API_KEY_1: 'one',
        GEMINI_API_KEY_0: 'zero', GEMINI_API_KEY_evil: 'evil', GEMINI_API_KEY_01: 'bad',
        HOME: '/private/home', DATABASE_URL: 'private-url', RANDOM_SECRET: 'private' });
    assert.deepEqual(config.GEMINI_API_KEY_4, ['four']);
    assert.deepEqual(config.GEMINI_API_KEY_10, ['ten']);
    assert.equal(config.GEMINI_API_KEY_0, undefined);
    assert.equal(config.GEMINI_API_KEY_evil, undefined);
    assert.equal(config.GEMINI_API_KEY_01, undefined);
    assert.equal(config.HOME, undefined);
    assert.equal(config.DATABASE_URL, undefined);
    assert.equal(config.RANDOM_SECRET, undefined);
    assert.ok(INFRASTRUCTURE_ENV.includes('HOME'));
    assert.ok(DYNAMIC_ENV_PATTERNS[0].secret);
});

test('explicit process reader snapshots settings and template never reads credentials', () => {
    const previous = process.env.GEMINI_API_KEY;
    try {
        process.env.GEMINI_API_KEY = 'synthetic-private-marker';
        const config = readConfigFromProcessEnv();
        assert.deepEqual(config.GEMINI_API_KEY, ['synthetic-private-marker']);
        const generated = generateEnvExample();
        assert.ok(!generated.includes('synthetic-private-marker'));
        assert.equal(generated, generateEnvExample());
        for (const name of Object.keys(ENV_SCHEMA)) assert.ok(generated.includes(`\n${name}=`), name);
        for (const [name, definition] of Object.entries(ENV_SCHEMA)) {
            if (definition.secret) assert.ok(generated.includes(`\n${name}=\n`), name);
        }
        const lines = generated.split('\n').filter(line => line && !line.startsWith('#'));
        const templateEnv = Object.fromEntries(lines.map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
        assert.deepEqual(loadConfig(templateEnv), loadConfig({}));
    } finally {
        if (previous === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previous;
    }
});

test('schema covers static legacy references, capture env aliases, shell runner and existing template keys', () => {
    function walk(directory) {
        return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
            const filename = path.join(directory, entry.name);
            return entry.isDirectory() ? walk(filename) : [filename];
        });
    }
    const files = [...walk(path.join(project, 'src')), ...walk(path.join(project, 'scripts')),
        path.join(project, 'ecosystem.config.js'), path.join(project, 'Dockerfile')];
    for (const filename of files) {
        if (!/\.(js|cjs|sh|py)$/.test(filename) && !filename.endsWith('Dockerfile')) continue;
        const source = fs.readFileSync(filename, 'utf8');
        const references = [...source.matchAll(/process\.env\.([A-Z][A-Z_0-9]*)/g),
            ...source.matchAll(/\benv\.([A-Z][A-Z_0-9]*)/g), ...source.matchAll(/\$\{(BOTSKY_[A-Z_]+)(?=[:-])/g),
            ...source.matchAll(/os\.environ(?:\.get\(|\[)["']([A-Z][A-Z_0-9]*)["']/g)];
        for (const reference of references) {
            assert.ok(Object.hasOwn(ENV_SCHEMA, reference[1]) || INFRASTRUCTURE_ENV.includes(reference[1]),
                `Undocumented ${reference[1]} in ${path.relative(project, filename)}`);
        }
    }
    const template = fs.readFileSync(path.join(project, '.env.example'), 'utf8');
    for (const match of template.matchAll(/^([A-Z][A-Z_0-9]*)=/gm)) assert.ok(Object.hasOwn(ENV_SCHEMA, match[1]), match[1]);
});
