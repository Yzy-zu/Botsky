'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Estos módulos se ejecutan con dependencias simuladas: sin env, red o datos reales.
function load(file, deps, processMock = { env: {}, uptime: () => 3661 }, dateMock = Date) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', file), 'utf8');
    deps = { './aiFailure': require('../src/services/aiFailure'), './semanticRouting': require('../src/services/semanticRouting'), '../services/semanticRouting': require('../src/services/semanticRouting'), '../services/operationFeedback': require('../src/services/operationFeedback'), ...deps };
    const module = { exports: {} };
    const silentLogger = new Proxy({}, { get: () => () => {} });
    const context = {
        module, exports: module.exports, Buffer, Date: dateMock, Math, Map, Set,
        process: processMock,
        require(name) {
            if (name === '../services/logger') return silentLogger;
            if (Object.prototype.hasOwnProperty.call(deps, name)) return deps[name];
            if (['util', 'path'].includes(name)) return require(name);
            throw new Error(`Dependencia sin mock: ${name}`);
        }
    };
    vm.runInNewContext(source, context, { filename: file });
    return module.exports;
}

function conversionHarness({ failSend = false } = {}) {
    const disk = new Map();
    const commands = [];
    const sent = [];
    const progress = [];
    const cleaned = [];
    const mod = load('convertir.js', {
        fs: {
            mkdirSync() {}, existsSync: file => disk.has(file),
            statSync: file => ({ size: disk.get(file)?.length || 0 }),
            writeFileSync: (file, data) => disk.set(file, data),
            readdirSync: dir => [...disk.keys()].filter(file => path.dirname(file) === dir).map(file => path.basename(file))
        },
        os: { cpus: () => [{}, {}] },
        child_process: {
            execFile(command, args, options, callback) {
                commands.push({ command, args });
                if (command === 'yt-dlp') {
                    disk.set(args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp3'), Buffer.from('input'));
                } else if (command === 'ffmpeg') {
                    disk.set(args[args.length - 1], Buffer.from('output'));
                }
                callback(null, '', '');
            }
        },
        '../utils/cleanup': { cleanup: (...files) => { cleaned.push(...files); files.forEach(file => disk.delete(file)); } },
        '../services/evolution': {
            sendText: async () => {},
            sendMedia: async (...args) => { if (failSend) throw new Error('delivery failed'); sent.push(args); },
            downloadMedia: async () => ({ buffer: Buffer.from('input'), extension: 'mp3' })
        },
        '../core/parser': { extractUrl: args => args.find(arg => /^https?:/.test(arg)) || null },
        '../services/progress': { Progress: class {
            async start(...args) { progress.push(['start', ...args]); }
            async fail(...args) { progress.push(['fail', ...args]); }
            async done(...args) { progress.push(['done', ...args]); }
        } }
    });
    return { mod, commands, sent, progress, disk, cleaned };
}

test('URL también convierte a formato pedido y aplica velocidad/bitrate', async () => {
    const h = conversionHarness();
    const result = await h.mod.handleConvertir({ flags: { f: 'ogg', speed: 1.5, bitrate: '128k' }, args: ['https://example.invalid/audio'] }, 'chat');
    assert.equal(result.success, true);
    assert.deepEqual(h.commands.map(cmd => cmd.command), ['yt-dlp', 'ffmpeg']);
    const args = h.commands[1].args;
    assert.equal(args[args.indexOf('-af') + 1], 'atempo=1.5');
    assert.equal(args[args.indexOf('-b:a') + 1], '128000');
    assert.equal(args.includes('-q:a'), false);
    assert.equal(args.at(-1).endsWith('.ogg'), true);
    assert.equal(h.sent.length, 1);
    assert.equal(h.disk.size, 0);
});

test('video ajusta imagen y audio con la misma velocidad', async () => {
    const h = conversionHarness();
    await h.mod.handleConvertir({ flags: { f: 'mp4', v: 4, b: '2M' } }, 'chat', { messageType: 'videoMessage' });
    const args = h.commands[0].args;
    assert.equal(args[args.indexOf('-vf') + 1], 'setpts=(PTS-STARTPTS)/4');
    assert.equal(args[args.indexOf('-af') + 1], 'atempo=2,atempo=2');
    assert.equal(args[args.indexOf('-b:v') + 1], '2000000');
    assert.equal(args.includes('-crf'), false);
});

test('valida velocidad/bitrate y rechaza formatos sin soporte antes de descargar', async () => {
    for (const flags of [{ speed: 0 }, { speed: 'rapido' }, { bitrate: '128kbps basura' }, { bitrate: '1k' }, { f: 'wav', bitrate: '128k' }, { f: 'pdf', speed: 2 }]) {
        const h = conversionHarness();
        await h.mod.handleConvertir({ flags, args: ['https://example.invalid'] }, 'chat');
        assert.equal(h.commands.length, 0);
        assert.equal(h.progress.some(item => item[0] === 'fail'), true);
    }
    const h = conversionHarness();
    assert.equal(h.mod.parseSpeed('0,25x'), 0.25);
    assert.equal(h.mod.audioTempoFilter(0.25), 'atempo=0.5,atempo=0.5');
    assert.equal(h.mod.parseBitrate('128kbps'), 128000);
});

test('no reporta conversión entregada si falla envío y limpia temporales', async () => {
    const h = conversionHarness({ failSend: true });
    const result = await h.mod.handleConvertir({ flags: {} }, 'chat', { messageType: 'audioMessage' });
    assert.equal(result.success, false);
    assert.equal(h.progress.some(item => item[0] === 'done'), false);
    assert.equal(h.disk.size, 0);
});

function driveHarness() {
    const texts = [];
    const downloads = [];
    let failDownload = true;
    let failSend = false;
    let waitDownload = null;
    let now = Date.now();
    class FakeDate extends Date { static now() { return now; } }
    const module = load('buscar.js', {
        fs: { existsSync: () => true, unlinkSync() {} },
        '../utils/session': { getSessionKey: (from, data) => `${from}:${data?.participant || from}` },
        '../services/scheduler': { registerTask() {} },
        '../services/drive': {
            searchFiles: async query => [{ id: query, name: `${query}.pdf`, mimeType: 'application/pdf' }],
            downloadFile: async id => {
                downloads.push(id);
                if (waitDownload) await waitDownload;
                if (failDownload) throw new Error('Drive unavailable');
                return { filePath: '/fake/output.pdf', outputName: 'output.pdf' };
            }
        },
        '../services/evolution': {
            sendText: async (to, text) => texts.push(text),
            sendMedia: async () => { if (failSend) throw new Error('delivery failed'); }
        }
    }, undefined, FakeDate);
    return { module, texts, downloads,
        advanceTime: milliseconds => { now += milliseconds; },
        setFailDownload: value => { failDownload = value; },
        setFailSend: value => { failSend = value; },
        setWait: value => { waitDownload = value; }
    };
}

test('Drive conserva sesión tras error y permite reintentar el número', async () => {
    const h = driveHarness();
    await h.module.handleBuscar({ args: ['factura'] }, 'chat', {});
    const failed = await h.module.handleDownloadDrive({ args: ['1'] }, 'chat', {});
    assert.equal(failed.success, false);
    assert.equal(h.module.hasActiveSearchSession('chat:chat'), true);
    h.setFailDownload(false);
    const result = await h.module.handleDownloadDrive({ args: ['1'] }, 'chat', {});
    assert.equal(result.success, true);
    assert.equal(h.module.hasActiveSearchSession('chat:chat'), false);
    assert.deepEqual(h.downloads, ['factura', 'factura']);
});

test('Drive conserva sesión cuando falla entrega y rechaza selecciones parciales', async () => {
    const h = driveHarness();
    h.setFailDownload(false);
    h.setFailSend(true);
    await h.module.handleBuscar({ args: ['factura'] }, 'chat', {});
    await h.module.handleDownloadDrive({ args: ['1basura'] }, 'chat', {});
    assert.equal(h.downloads.length, 0);
    await h.module.handleDownloadDrive({ args: ['1'] }, 'chat', {});
    assert.equal(h.module.hasActiveSearchSession('chat:chat'), true);
});

test('Drive verifica vencimiento al descargar sin depender del scheduler', async () => {
    const h = driveHarness();
    await h.module.handleBuscar({ args: ['factura'] }, 'chat', {});
    h.advanceTime(900001);
    await h.module.handleDownloadDrive({ args: ['1'] }, 'chat', {});
    assert.equal(h.downloads.length, 0);
    assert.equal(h.module.hasActiveSearchSession('chat:chat'), false);
    assert.match(h.texts.at(-1), /expiró/);
});

test('Drive evita descarga duplicada y conserva búsquedas nuevas durante descarga', async () => {
    const h = driveHarness();
    h.setFailDownload(false);
    let release;
    h.setWait(new Promise(resolve => { release = resolve; }));
    await h.module.handleBuscar({ args: ['vieja'] }, 'chat', {});
    const pending = h.module.handleDownloadDrive({ args: ['1'] }, 'chat', {});
    await h.module.handleDownloadDrive({ args: ['1'] }, 'chat', {});
    assert.equal(h.downloads.length, 1);
    await h.module.handleBuscar({ args: ['nueva'] }, 'chat', {});
    release();
    await pending;
    assert.equal(h.module.hasActiveSearchSession('chat:chat'), true);
});

test('estado del bot usa proceso y cola sin pedir URL ni ejecutar yt-dlp', async () => {
    const texts = [];
    const module = load('info.js', {
        child_process: { execFile() { throw new Error('No ejecutar procesos'); } },
        '../services/evolution': { sendText: async (to, text) => texts.push(text) },
        '../core/parser': { extractUrl: () => null },
        '../core/queue': { stats: { light: { running: 1, pending: 2 }, heavy: { running: 2, pending: 3 } } }
    });
    const result = await module.handleBotStatus({}, 'chat');
    assert.equal(result.uptime_segundos, 3661);
    assert.equal(result.trabajos_activos, 3);
    assert.equal(result.trabajos_en_espera, 5);
    assert.match(texts[0], /1h 1m 1s/);
    assert.doesNotMatch(texts[0], /enlace|video/i);
});
