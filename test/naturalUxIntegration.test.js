'use strict';

// Código real con dependencias simuladas: no .env, red, workers ni BD del bot.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '../src');
const logger = { info() {}, warn() {}, error() {}, cmd() {} };
const contentIntent = {};

function load(file, deps, globals = {}) {
    deps = { './aiFailure': require('../src/services/aiFailure'), './semanticRouting': require('../src/services/semanticRouting'), '../services/semanticRouting': require('../src/services/semanticRouting'), '../services/operationFeedback': require('../src/services/operationFeedback'), ...deps };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
        module, exports: module.exports, process: { env: {} }, Date, Intl, Map, Set, Buffer,
        require(id) {
            if (!(id in deps)) throw new Error('Dependencia sin mock: ' + id);
            return deps[id];
        }, ...globals
    }, { filename: file });
    return module.exports;
}

function mapArgs() {
    const source = fs.readFileSync(path.join(root, 'core/dispatcher.js'), 'utf8');
    const start = source.indexOf('async function applyAiArgsToParsed(');
    const end = source.indexOf('\n}\n', start) + 3;
    const context = { getSearchSession: () => null, sendText: async () => {}, logger };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end) + '\nthis.mapArgs = applyAiArgsToParsed;', context);
    return context.mapArgs;
}

function pollHarness() {
    const votes = [], messages = [];
    const poll = { id: 7, options: ['Minecraft', 'Película'] };
    const command = load('commands/encuesta.js', {
        '../services/evolution': { sendText: async (_, text) => messages.push(text) },
        '../services/db': {
            getActivePoll: async () => poll,
            votePoll: async (...args) => { votes.push(args); return {}; }
        },
        '../core/auth': { getSenderJid: () => 'voter@s.whatsapp.net', isAuthorizedAdmin: () => false }
    });
    return { command, votes, messages };
}

test('Encuesta: Gemini conserva opción numérica hasta el voto real', async () => {
    const h = pollHarness();
    const parsed = { command: 'encuesta', args: [], flags: {}, raw: 'Botsky voto por 2' };
    await mapArgs()(parsed, { accion: 'votar', opcion: 2 }, 'key', 'grupo@g.us');
    await h.command.handleEncuesta(parsed, 'grupo@g.us', {});
    assert.equal(h.votes.length, 1);
    assert.equal(h.votes[0][2], 1);
    assert.match(h.messages[0], /Película/);
});

test('Encuesta: acepta nombre con espacios y acentos sin perder datos estructurados', async () => {
    const h = pollHarness();
    await h.command.handleEncuesta({ aiArgs: { accion: 'votar', opcion: 'pelicula' }, args: [] }, 'grupo@g.us');
    assert.equal(h.votes[0][2], 1);
    assert.equal(h.command.resolveVoteOption('Pelis', ['Pelis', 'Pelis']), -1);
    assert.equal(h.command.resolveVoteOption('2abc', ['A', 'B']), -1);
});

test('Encuesta: opción inválida pide aclaración sin registrar voto', async () => {
    const h = pollHarness();
    await h.command.handleEncuesta({ aiArgs: { accion: 'votar', opcion: 99 } }, 'grupo@g.us');
    assert.equal(h.votes.length, 0);
    assert.match(h.messages[0], /¿Por cuál votas/);
});

test('Conversión: mapper conserva ceros para que el comando valide valores inválidos', async () => {
    const parsed = { command: 'convertir', args: [], flags: {} };
    await mapArgs()(parsed, { velocidad: 0, bitrate: 0 }, 'key', 'test');
    assert.equal(parsed.flags.speed, 0);
    assert.equal(parsed.flags.bitrate, 0);
});

function normalizerHarness({ drive = false, contact = false } = {}) {
    const attachmentContext = load('services/attachmentContext.js', { '../utils/mediaDeliveryRequest': {}, '../utils/contentIntent': contentIntent });
    return load('core/message_normalizer.js', {
        '../services/logger': logger,
        '../commands/documentos': { hasActiveSession: () => null },
        '../commands/buscar': { hasActiveSearchSession: () => drive, getSessionKey: from => from },
        '../commands/mensaje': { hasPendingContactChoice: () => contact },
        '../commands/ruleta': { hasActiveRouletteLobby: () => false },
        '../commands/blackjack': { hasActiveBlackjackGame: () => false, hasActiveBlackjackTableLobby: () => false, hasActiveBlackjackTablePlaying: () => false },
        '../services/scheduler': { registerTask() {} },
        '../services/attachmentContext': attachmentContext,
        '../utils/mediaDeliveryRequest': {}, '../utils/contentIntent': contentIntent
    });
}

const incoming = text => ({ key: { remoteJid: 'test@s.whatsapp.net' }, message: { conversation: text } });

test('Normalizador: tareas y archivos conservan intención para Gemini', () => {
    const normalizer = normalizerHarness();
    for (const text of ['anota la tarea de seguridad para el viernes', 'guarda este archivo en Drive', 'anota que nos dejaron investigar puertos']) {
        const result = normalizer.normalizeIncomingMessage(incoming(text));
        assert.equal(result.text, text);
        assert.equal(result.shouldDispatch, true);
    }
    assert.equal(normalizer.normalizeIncomingMessage(incoming('guarda esta nota: comprar café')).text, 'guarda esta nota: comprar café');
});

test('Normalizador: elección de contacto tiene prioridad sobre lista de Drive', () => {
    const norm = normalizerHarness({ drive: true, contact: true }).normalizeIncomingMessage(incoming('2'));
    assert.equal(norm.text, '2');
    assert.equal(norm.shouldDispatch, true);
});

test('Normalizador: conserva caption citado al desempaquetar multimedia', () => {
    const data = incoming('guarda esto');
    data.message = { extendedTextMessage: { text: 'guarda esto', contextInfo: { quotedMessage: { imageMessage: { caption: 'Comprar café' } } } } };
    const normalized = normalizerHarness().normalizeIncomingMessage(data);
    const { resolveMessageText } = require('../src/utils/messageText');
    assert.equal(resolveMessageText('', normalized.actualMessageData), 'Comprar café');
});

function dailyHarness({ claim = null, failure = false, roll = 0.1 } = {}) {
    const messages = [], writes = [];
    const db = {
        getDailyClaim: async () => { if (failure) throw Error('storage down'); return claim; },
        addXp: async (_, xp) => writes.push(['xp', xp]),
        recordDailyClaim: async (_, now, streak) => writes.push(['claim', now, streak]),
        adjustUserAffinity: async () => {},
        getOrCreateUser: async () => ({ xp: 500 })
    };
    const deps = {
        '../services/evolution': { sendText: async (_, text) => messages.push(text) }, './evolution': {},
        '../services/db': db, './db': db,
        '../services/logger': logger, './logger': logger,
        '../utils/messageText': require('../src/utils/messageText'),
        '../utils/reminderInput': require('../src/utils/reminderInput'),
        '../core/auth': { getSenderJid: from => from }
    };
    const math = Object.create(Math); math.random = () => roll;
    const command = load('commands/daily.js', deps, { Math: math });
    deps['../commands/daily'] = command;
    return { command, tool: load('services/toolRegistry.js', deps), messages, writes };
}

test('Daily: tool devuelve cooldown real sin inventar premio ni enviar duplicado', async () => {
    const h = dailyHarness({ claim: { last_claim: Date.now(), streak: 3 } });
    const result = await h.tool.executeTool('juegos_y_economia', { juego: 'daily' }, { from: 'test' });
    assert.equal(result.success, false);
    assert.equal(result.status, 'cooldown');
    assert.ok(result.remaining_ms > 0);
    assert.match(result.mensaje, /siguiente/);
    assert.equal(h.writes.length, 0);
    assert.equal(h.messages.length, 0);
});

test('Daily: éxito informa XP reales, saldo y racha; premio cero sigue siendo giro válido', async () => {
    for (const [roll, gain] of [[0.1, 300], [0.99, 0]]) {
        const h = dailyHarness({ roll });
        const result = await h.tool.executeTool('juegos_y_economia', { juego: 'daily' }, { from: 'test' });
        assert.equal(result.success, true);
        assert.equal(result.status, 'claimed');
        assert.equal(result.xp_ganados, gain);
        assert.equal(result.saldo, 500);
        assert.equal(h.writes.filter(row => row[0] === 'claim').length, 1);
        assert.equal(h.messages.length, 0);
    }
});

test('Daily: error real no se convierte en éxito por el wrapper', async () => {
    const h = dailyHarness({ failure: true });
    const result = await h.tool.executeTool('juegos_y_economia', { juego: 'daily' }, { from: 'test' });
    assert.equal(result.success, false);
    assert.equal(result.status, 'error');
    assert.equal(h.writes.length, 0);
});

test('Daily: comando conserva su mensaje directo y retorna el mismo estado', async () => {
    const h = dailyHarness({ claim: { last_claim: Date.now(), streak: 1 } });
    const result = await h.command.handleDaily({}, 'test', {});
    assert.equal(result.success, false);
    assert.equal(h.messages.length, 1);
    assert.equal(result.mensaje, h.messages[0]);
});

test('Agente: una aclaración detiene ejecución hasta nueva respuesta del usuario', async () => {
    let calls = 0, writes = 0;
    const engine = load('services/agentEngine.js', {
        './logger': logger,
        './conversationStyle': require('../src/services/conversationStyle'),
        './aiConfig': { getAiConfig: () => ({}) },
        './ai': {
            getConfiguredApiKeys: () => ['fake-test-key'], formatHistoryForPrompt: () => '',
            callGemini: async () => {
                calls++;
                if (calls > 1) throw Error('No debe reintentar inventando una hora');
                return { role: 'model', parts: [{ functionCall: { name: 'recordatorios_alarmas', args: { mensaje: 'comprar café' } } }] };
            }
        },
        './toolRegistry': {
            getToolDeclarations: () => [],
            executeTool: async () => { writes++; return { success: false, needs_clarification: true, question: '¿Cuándo te aviso?' }; }
        }
    });
    const result = await engine.runUniversalAgent({ userMessage: 'Recuérdame comprar café', from: 'test', messageData: {} });
    assert.equal(result.text, '¿Cuándo te aviso?');
    assert.equal(calls, 1);
    assert.equal(writes, 1);
});

test('Estado: registry selecciona estado local y mantiene info de videos aparte', async () => {
    const commands = fs.readFileSync(path.join(root, 'core/commandRegistry.js'), 'utf8');
    const ids = [...commands.matchAll(/require\('([^']+)'\)/g)].map(match => match[1]);
    const deps = Object.fromEntries(ids.map(id => [id, {}]));
    const called = [];
    deps['../commands/info'] = {
        handleBotStatus: async () => called.push('estado'), handleInfo: async () => called.push('video')
    };
    const registry = load('core/commandRegistry.js', deps);
    for (const name of ['estado', 'estadobot', 'status', 'info']) {
        const handler = await registry.getCommandHandler(name, { parsed: {}, from: 'test', messageData: {} });
        await handler.handler();
    }
    assert.deepEqual(called, ['estado', 'estado', 'estado', 'video']);
});

test('Router: acepta estado local, alias y voto estructurado sin llamadas reales', () => {
    const ai = load('services/ai.js', {
        https: { Agent: class {} }, axios: {},
        './conversationStyle': require('../src/services/conversationStyle'),
        './generationSettings': require('../src/services/generationSettings'),
        '../utils/mediaDeliveryRequest': {}, '../utils/contentIntent': contentIntent,
        '../utils/voiceRequest': {},
        './logger': logger, './scheduler': { registerTask() {} }, './aiConfig': { getAiConfig: () => ({}) }
    });
    assert.equal(ai.validateAiDecision({ action: 'estado' }).action, 'estado');
    assert.equal(ai.validateAiDecision({ action: 'estadobot' }).action, 'estado');
    assert.equal(ai.validateAiDecision({ action: 'info', args: { url: 'https://example.invalid/video' } }).action, 'info');
    assert.equal(ai.validateAiDecision({ action: 'encuesta', args: { accion: 'votar', opcion: 2 } }).args.opcion, 2);
});
