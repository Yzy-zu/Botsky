'use strict';

// Operator tool: never prints credentials, phone numbers or complete PM2 state.
// The inspected local PM2 RPC lets us merge only the flags we change, rather
// than importing this coding session's environment into the production bot.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const pm2 = require('/usr/lib/node_modules/pm2');
const root = path.resolve(__dirname, '../..');
const production = process.env.BOTSKY_PRODUCTION_DIR || '/home/petrov/botsky';
const stateFile = '/tmp/botsky-phase0-runtime-state.json';
const captureDirectory = '/tmp/botsky-phase0-captures';
const preload = path.join(root, 'scripts/refactor/capture-preload.cjs');
const modified = ['src/core/server.js', 'src/core/dispatcher.js', 'src/services/toolRegistry.js'];
const added = ['src/services/commandUsage.js', 'src/services/commandUsageRuntime.js'];
const keys = ['LEGACY_COMMAND_USAGE_ENABLED', 'LEGACY_COMMAND_USAGE_DB', 'REFRACTOR_CAPTURE_ENABLED',
    'REFRACTOR_CAPTURE_DIR', 'REFRACTOR_CAPTURE_LIMIT', 'REFRACTOR_CAPTURE_DURATION',
    'REFRACTOR_CAPTURE_BOT_JID', 'REFRACTOR_CAPTURE_BOT_ALIASES', 'REFRACTOR_CAPTURE_DEDUPE'];
const call = (method, ...args) => new Promise((resolve, reject) => pm2[method](...args, (error, value) => error ? reject(error) : resolve(value)));
const rpcRestart = (id, flags, nodeArgs) => new Promise((resolve, reject) => {
    pm2.Client.executeRemote('restartProcessId', { id, env: { ...flags, current_conf: { node_args: nodeArgs } } },
        (error, value) => error ? reject(error) : resolve(value));
});
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
function base(relative) { return execFileSync('git', ['show', 'v1-legacy:' + relative], { cwd: root }); }
async function botIdentity() {
    const dotenv = require(path.join(production, 'node_modules/dotenv'));
    const axios = require(path.join(production, 'node_modules/axios'));
    const config = dotenv.parse(fs.readFileSync(path.join(production, '.env')));
    const response = await axios.get(config.EVOLUTION_API_URL.replace(/\/$/, '') + '/instance/fetchInstances', {
        params: { instanceName: config.EVOLUTION_INSTANCE }, headers: { apikey: config.EVOLUTION_API_KEY }, timeout: 10000
    });
    const instances = Array.isArray(response.data) ? response.data : [response.data];
    const instance = instances.find(item => item.name === config.EVOLUTION_INSTANCE);
    if (!instance?.ownerJid) throw new Error('Bot identity unavailable');
    return instance.ownerJid;
}
async function main() {
    const action = process.argv[2];
    if (!['activate', 'resume-capture', 'disable-capture', 'rollback', 'status'].includes(action)) throw new Error('Invalid action');
    await call('connect');
    const live = (await call('list')).filter(app => app.name === 'wasa');
    if (live.length !== 1 || live[0].pm2_env.pm_cwd !== production) throw new Error('Unexpected production process');
    const app = live[0];
    if (action === 'status') {
        console.log(JSON.stringify({ name: app.name, status: app.pm2_env.status, pid: app.pid,
            telemetry: app.pm2_env.env?.LEGACY_COMMAND_USAGE_ENABLED === 'true',
            capture: app.pm2_env.env?.REFRACTOR_CAPTURE_ENABLED === 'true' }));
        return;
    }
    if (action === 'activate') {
        if (fs.existsSync(stateFile)) throw new Error('Existing activation state; do not overwrite rollback evidence');
        for (const relative of modified) {
            if (hash(fs.readFileSync(path.join(production, relative))) !== hash(base(relative))) throw new Error('Production source differs from legacy tag');
        }
        for (const relative of added) if (fs.existsSync(path.join(production, relative))) throw new Error('New production module already exists');
        const ownerJid = await botIdentity();
        const previousFlags = Object.fromEntries(keys.map(key => [key, app.pm2_env.env?.[key] ?? '']));
        const nodeArgs = Array.isArray(app.pm2_env.node_args) ? app.pm2_env.node_args : [];
        const state = { activatedUtc: new Date().toISOString(), id: app.pm_id, previousFlags, nodeArgs,
            files: Object.fromEntries([...modified, ...added].map(relative => [relative, hash(fs.readFileSync(path.join(root, relative)))])) };
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        for (const relative of [...modified, ...added]) fs.copyFileSync(path.join(root, relative), path.join(production, relative));
        const flags = { LEGACY_COMMAND_USAGE_ENABLED: 'true', LEGACY_COMMAND_USAGE_DB: path.join(production, 'data/command-usage.db'),
            REFRACTOR_CAPTURE_ENABLED: 'true', REFRACTOR_CAPTURE_DIR: captureDirectory,
            REFRACTOR_CAPTURE_LIMIT: '200', REFRACTOR_CAPTURE_DURATION: '1800000',
            REFRACTOR_CAPTURE_BOT_JID: ownerJid, REFRACTOR_CAPTURE_DEDUPE: 'true' };
        try { await rpcRestart(app.pm_id, flags, [...nodeArgs, '--require', preload]); }
        catch (error) {
            for (const relative of modified) fs.writeFileSync(path.join(production, relative), base(relative));
            for (const relative of added) fs.unlinkSync(path.join(production, relative));
            await rpcRestart(app.pm_id, previousFlags, nodeArgs);
            throw error;
        }
        console.log('Phase 0 observation activated; production restarted. Credentials omitted.');
    } else {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        if (state.id !== app.pm_id) throw new Error('Rollback process ID changed');
        if (action === 'resume-capture') {
            const ownerJid = await botIdentity();
            let aliases = [ownerJid];
            const aliasFile = '/tmp/botsky-phase0-bot-aliases.json';
            if (fs.existsSync(aliasFile)) {
                const identityEvidence = JSON.parse(fs.readFileSync(aliasFile, 'utf8'));
                if (identityEvidence.aliases?.[0] === ownerJid) aliases = identityEvidence.aliases;
            }
            await rpcRestart(app.pm_id, { REFRACTOR_CAPTURE_ENABLED: 'true',
                REFRACTOR_CAPTURE_BOT_JID: ownerJid, REFRACTOR_CAPTURE_BOT_ALIASES: JSON.stringify(aliases), REFRACTOR_CAPTURE_DIR: captureDirectory,
                REFRACTOR_CAPTURE_LIMIT: '200', REFRACTOR_CAPTURE_DURATION: '1800000', REFRACTOR_CAPTURE_DEDUPE: 'true' },
                [...state.nodeArgs, '--require', preload]);
            console.log('Capture resumed for 30 minutes; no message sends requested.');
        } else if (action === 'rollback') {
            for (const [relative, expected] of Object.entries(state.files)) {
                if (hash(fs.readFileSync(path.join(production, relative))) !== expected) throw new Error('Production changed after activation; refuse overwrite');
            }
            for (const relative of modified) fs.writeFileSync(path.join(production, relative), base(relative));
            for (const relative of added) fs.unlinkSync(path.join(production, relative));
            await rpcRestart(app.pm_id, { REFRACTOR_CAPTURE_BOT_ALIASES: '', ...state.previousFlags }, state.nodeArgs);
            console.log('Phase 0 observation rolled back to legacy source and original Node arguments.');
        } else {
            await rpcRestart(app.pm_id, { REFRACTOR_CAPTURE_ENABLED: 'false', REFRACTOR_CAPTURE_BOT_JID: '', REFRACTOR_CAPTURE_BOT_ALIASES: '' }, state.nodeArgs);
            console.log('Capture disabled; original Node arguments restored. Telemetry remains active.');
        }
    }
}
main().catch(() => { console.error('Phase 0 runtime action failed; inspect source guards and private rollback state.'); process.exitCode = 1; })
    .finally(() => pm2.disconnect());
