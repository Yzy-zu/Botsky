'use strict';

// This optional v1 bridge is removed after migration. It never reads message
// contents or persists identities; its database is separate from business data.
const path = require('node:path');
const fs = require('node:fs');
const { createCommandUsage, createSqliteCommandUsageSink, classifySuccess } = require('./commandUsage');

const tools = Object.freeze({
    minecraft_control: 'maicra', ejecutar_terminal: 'terminal', notas_tablon: 'notas',
    recordatorios_alarmas: 'recordar', tareas_escolares: 'tareas', google_drive: 'drive',
    descargar_multimedia: 'descargar', enviar_archivo_contacto: 'enviarmedia',
    sintetizar_voz: 'voz', juegos_y_economia: 'daily', afinidad_y_lore: 'afinidad',
    control_tv: 'canal', enviar_mensaje_contacto: 'mensaje'
});
let sink;
let observer;
let starting;
let startUtc;
function enabled() { return process.env.LEGACY_COMMAND_USAGE_ENABLED === 'true'; }
function initialize() {
    if (!enabled() || observer) return;
    const filename = process.env.LEGACY_COMMAND_USAGE_DB || path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'command-usage.db');
    sink = createSqliteCommandUsageSink({ enabled: true, filename, maxBuffer: 256 });
    observer = createCommandUsage({ enabled: true, sink });
    starting = (async () => {
        fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
        await sink.start();
        fs.chmodSync(filename, 0o600);
        startUtc = new Date().toISOString();
    })().catch(() => {}); // A telemetry failure must never stop the bot.
}
async function start() {
    if (!enabled()) return;
    try { initialize(); await starting; } catch (_) {}
}
function track(command, chatId, operation, options = {}) {
    if (!enabled()) return operation();
    try {
        initialize();
        if (observer) return observer.track({ command, chat_type: typeof chatId === 'string' && chatId.endsWith('@g.us') ? 'group' : 'private',
            item: options.item, adult: options.adult }, operation, options.classifier || classifySuccess);
    } catch (_) {} // Initialization failure leaves the original operation intact.
    return operation();
}
function trackTool(name, args, context, operation) {
    const command = Object.hasOwn(tools, name) ? tools[name] : null;
    if (!command) return operation();
    // Game/social tool subactions are closed identifiers, never arbitrary input.
    const game = typeof args?.juego === 'string' ? args.juego.toLowerCase().trim() : 'daily';
    const actual = name === 'juegos_y_economia' && ['daily', 'ruleta', 'blackjack', 'nuclear'].includes(game) ? game : command;
    return track(actual, context?.from, operation, { adult: args?.adult === true });
}
async function flush() { if (starting) await starting; if (sink) await sink.flush(); }
function stats() { return { enabled: enabled(), startUtc: startUtc || null, observation: observer?.stats || null, sink: sink?.stats || null }; }
module.exports = { start, track, trackTool, flush, stats };
