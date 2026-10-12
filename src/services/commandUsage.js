'use strict';

// Closed vocabulary: never persist raw input, arguments, or user identifiers.
const groups = [
    ['help', 'ayuda', ['ayuda', 'help']],
    ['system-info', 'info', ['info']],
    ['system-info', 'estado', ['estado', 'estadobot', 'status']],
    ['media-download', 'descargar', ['descargar', 'descarga', 'baja', 'bajar', 'bajalo', 'bajate', 'descargalo', 'tumbate', 'dl', 'tiktok', 'tt', 'tk', 'video', 'videos', 'youtube', 'yt', 'buscavideo', 'buscavideos', 'buscarvideo', 'buscarvideos']],
    ['media-download', 'musica', ['musica', 'cancion', 'canciones', 'music', 'song', 'rola', 'rolas']],
    ['reminders', 'recordar', ['recordar', 'recordatorio', 'recuerdame', 'recordatorios', 'alarma', 'remind']],
    ['messaging', 'enviarmedia', ['enviarmedia', 'reenviar']],
    ['transcripcion', 'transcribir', ['transcribir', 'transcribe', 'tr']],
    ['sticker', 'efecto', ['efecto']],
    ['voice', 'voz', ['voz', 'audio', 'tts', 'habla', 'hablar', 'notadevoz']],
    ['convertir', 'convertir', ['convertir', 'cv']],
    ['sticker', 'sticker', ['sticker', 's', 'stickers', 'calca', 'calcas', 'pegatina', 'pegatinas']],
    ['drive', 'buscar', ['buscar']],
    ['drive', 'descargardrive', ['descargardrive']],
    ['drive', 'drive', ['drive']],
    ['convertir', 'doc', ['doc', 'pdf']],
    ['convertir', 'comprimir', ['comprimir']],
    ['convertir', 'recortarpdf', ['recortar', 'recortarpdf', 'cortar', 'cortarpdf', 'extraerpdf']],
    ['convertir', 'unirpdf', ['unir', 'unirpdf', 'unirpdfs']],
    ['convertir', 'pdf2img', ['pdf2img', 'extraer']],
    ['ocr', 'leer', ['leer', 'ocr']],
    ['qr', 'qr', ['qr']],
    ...['kick', 'ban', 'promote', 'demote', 'mute', 'unmute', 'warn', 'unwarn'].map(command => ['moderation', command, [command]]),
    ['economy', 'rank', ['rank', 'nivel']],
    ['economy', 'top', ['top']],
    ['economy', 'darxp', ['darxp', 'addxp', 'añademe', 'anademe', 'damexp', 'sumarxp', 'xpadmin']],
    ['minecraft', 'maicra', ['maicra', 'mc', 'minecraft', 'mine', 'server']],
    ['community', 'lore', ['lore', 'lores', 'canon', 'cronica']],
    ['admin-system', 'canal', ['canal']],
    ['admin-system', 'apagate', ['apagate']],
    ['admin-system', 'terminal', ['terminal', 'bash', 'cmd', 'sh', 'agente', 'vps', 'linux', 'recursos', 'sistema']],
    ['notes', 'notas', ['notas', 'nota', 'apunte', 'apuntes', 'tablon']],
    ['polls', 'encuesta', ['encuesta', 'encuestas', 'poll', 'votacion']],
    ['tasks', 'tareas', ['tarea', 'tareas', 'deberes']],
    ['games', 'ruleta', ['ruleta', 'ruletarusa', 'roulette']],
    ['games', 'nuclear', ['nuclear', 'nuke', 'bomba', 'kamikaze']],
    ['economy', 'daily', ['daily', 'diario', 'ruletadiaria', 'recompensa']],
    ['community', 'afinidad', ['afinidad', 'karma', 'relacion', 'rencor', 'amistad']],
    ['community', 'doxeo', ['doxeo', 'doxear', 'doxxeo', 'localizar']],
    ['games', 'blackjack', ['blackjack', '21', 'bj']],
    ['messaging', 'difusion', ['difusion', 'difundir', 'broadcast']],
    ['messaging', 'mensaje', ['mensaje', 'recado', 'dile', 'mandale', 'escribele']],
    ['community', 'cooperacha', ['cooperacha', 'coop', 'coperacha', 'vaquita', 'reto', 'destapar', 'cooperar', 'aportar']],
    ['adult-media', 'pack', ['pack', 'packs', 'mercadonegro', 'comprarpack']],
    ['adult-media', 'catalog', ['comprar', 'compra']],
    ['community', 'horafeliz', ['horafeliz', 'happyhour', 'hf']],
    ['conversation', 'chat', ['chat']],
    ['drive', 'upload-reaction', ['upload-reaction']],
    ['community', 'airdrop-claim', ['airdrop-claim']]
];
const aliases = Object.create(null);
for (const [feature, command, names] of groups) {
    const identity = Object.freeze({ feature, command });
    for (const name of names) aliases[name] = identity;
}
Object.freeze(aliases);

function resolveCommand(alias, options = {}) {
    if (typeof alias !== 'string') return null;
    const key = alias.toLowerCase();
    const identity = aliases[key];
    if (!identity) return null;
    if ((key === 'comprar' || key === 'compra') && ['pack', 'packs'].includes(options.item)) {
        return aliases.pack;
    }
    if (identity.feature === 'media-download' && options.adult === true) {
        return Object.freeze({ feature: 'adult-media', command: identity.command });
    }
    return identity;
}

// Only use after the caller has determined that the operation actually started.
function classifySuccess(result) {
    if (result && typeof result.success === 'boolean') return result.success;
    return 'unknown';
}

function createCommandUsage({ enabled = false, sink, wallClock = Date.now,
    monotonicClock = () => Number(process.hrtime.bigint()) / 1e6 } = {}) {
    const counts = { initiated: 0, recorded: 0, unknown: 0, ignored: 0, sinkErrors: 0, dropped: 0 };
    function identity(meta) {
        if (!meta || !['private', 'group'].includes(meta.chat_type)) return null;
        return resolveCommand(meta.command, { item: meta.item, adult: meta.adult });
    }
    function submit(row) {
        // Detached deliberately: stalled/rejected sinks cannot alter business results.
        try {
            const result = typeof sink === 'function' ? sink(row) : sink?.enqueue(row);
            Promise.resolve(result).then(accepted => {
                if (accepted === false) counts.dropped++;
                else if (sink) counts.recorded++;
                else counts.dropped++;
            }, () => { counts.sinkErrors++; });
        } catch (_) { counts.sinkErrors++; }
    }
    function finish(meta, resolved, result, classifier, start, thrown = false) {
        let outcome;
        try { outcome = thrown ? false : typeof classifier === 'function' ? classifier(result) : 'unknown'; }
        catch (_) { outcome = 'unknown'; }
        if (outcome === 'ignored') { counts.ignored++; return; }
        if (outcome !== true && outcome !== false) { counts.unknown++; outcome = null; }
        let latency;
        try { latency = Math.max(0, monotonicClock() - start.mono); }
        catch (_) { counts.unknown++; return; }
        if (!Number.isFinite(start.ts) || !Number.isFinite(latency)) { counts.unknown++; return; }
        submit({ feature: resolved.feature, command: resolved.command, chat_type: start.chatType,
            ts: start.ts, ok: outcome === null ? null : outcome ? 1 : 0, latency_ms: latency });
    }
    function begin(meta) {
        const resolved = identity(meta);
        if (!resolved) { counts.ignored++; return null; }
        counts.initiated++;
        try { return { resolved, chatType: meta.chat_type, ts: wallClock(), mono: monotonicClock() }; }
        catch (_) { counts.unknown++; return null; }
    }
    async function track(meta, operation, classifier) {
        if (!enabled) return operation();
        const start = begin(meta);
        try {
            const result = await operation();
            if (start) finish(meta, start.resolved, result, classifier, start);
            return result;
        } catch (error) {
            if (start) finish(meta, start.resolved, undefined, classifier, start, true);
            throw error;
        }
    }
    // For already-observed, initiated operations. Prefer track for exact elapsed time.
    function observe(meta, result, classifier) {
        if (!enabled) return;
        const start = begin(meta);
        if (start) finish(meta, start.resolved, result, classifier, start);
    }
    return { track, observe, get stats() { return { ...counts }; } };
}

function createSqliteCommandUsageSink({ enabled = false, filename, maxBuffer = 256,
    sqliteFactory = () => require('sqlite3') } = {}) {
    if (!Number.isInteger(maxBuffer) || maxBuffer < 1) throw new TypeError('Invalid telemetry buffer limit');
    let db = null;
    let startPromise = null;
    let drain = null;
    let closePromise = null;
    let ready = false;
    let accepting = true;
    let active = 0;
    const buffer = [];
    const counts = { written: 0, dropped: 0, errors: 0 };
    const run = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, error => error ? reject(error) : resolve());
    });
    function start() {
        if (!enabled || !accepting) return Promise.resolve(false);
        if (startPromise) return startPromise;
        startPromise = (async () => {
            if (typeof filename !== 'string' || !filename) throw new TypeError('Telemetry sidecar filename required');
            const sqlite = sqliteFactory();
            await new Promise((resolve, reject) => {
                db = new sqlite.Database(filename, error => error ? reject(error) : resolve());
            });
            await run('PRAGMA busy_timeout = 1000');
            await run(`CREATE TABLE IF NOT EXISTS command_usage (
                feature TEXT NOT NULL, command TEXT NOT NULL,
                chat_type TEXT NOT NULL CHECK(chat_type IN ('private','group')),
                ts INTEGER NOT NULL, ok INTEGER CHECK(ok IN (0,1) OR ok IS NULL),
                latency_ms REAL NOT NULL CHECK(latency_ms >= 0))`);
            ready = true;
            return true;
        })();
        // A detached caller must not create an unhandled rejection.
        startPromise.catch(() => { counts.errors++; });
        return startPromise;
    }
    function safeRow(row) {
        if (!row || !['private', 'group'].includes(row.chat_type) || ![0, 1, null].includes(row.ok)
            || !Number.isFinite(row.ts) || !Number.isFinite(row.latency_ms) || row.latency_ms < 0) return null;
        const allowed = groups.some(([feature, command]) => feature === row.feature && command === row.command)
            || (row.feature === 'adult-media' && ['descargar', 'musica'].includes(row.command));
        if (!allowed) return null;
        return [row.feature, row.command, row.chat_type, row.ts, row.ok, row.latency_ms];
    }
    function enqueue(row) {
        if (!enabled) return false;
        const values = safeRow(row);
        if (!ready || !accepting || !values || buffer.length + active >= maxBuffer) {
            counts.dropped++; return false;
        }
        buffer.push(values);
        queueMicrotask(() => { void flush(); });
        return true;
    }
    function flush() {
        if (drain) return drain;
        if (!ready) return Promise.resolve();
        drain = (async () => {
            while (buffer.length) {
                const values = buffer.shift();
                active = 1;
                try {
                    await run('INSERT INTO command_usage (feature,command,chat_type,ts,ok,latency_ms) VALUES (?,?,?,?,?,?)', values);
                    counts.written++;
                } catch (_) { counts.errors++; counts.dropped++; }
                finally { active = 0; }
            }
        })().finally(() => { drain = null; });
        return drain;
    }
    function close() {
        if (closePromise) return closePromise;
        accepting = false;
        closePromise = (async () => {
            if (startPromise) await startPromise.catch(() => {});
            await flush();
            ready = false;
            if (db) {
                await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
                db = null;
            }
        })();
        closePromise.catch(() => { counts.errors++; });
        return closePromise;
    }
    return { start, enqueue, flush, close, get stats() {
        return { ...counts, pending: buffer.length + active, ready };
    } };
}

module.exports = { resolveCommand, classifySuccess, createCommandUsage, createSqliteCommandUsageSink };
