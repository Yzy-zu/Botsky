'use strict';

// Exercise the production dispatcher with fake routing and transports. No .env,
// database, model calls, download process or WhatsApp connection is loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../src');

function harness(outcome, { allowCommand = false, activeSession = null } = {}) {
    const sent = [], calls = [], history = [], logs = [], commands = [];
    const logger = Object.fromEntries(['info', 'warn', 'error', 'cmd'].map(method => [method, (...args) => logs.push(args.join(' '))]));
    const source = fs.readFileSync(path.join(root, 'core/dispatcher.js'), 'utf8');
    const dependencies = Object.fromEntries([...source.matchAll(/require\('([^']+)'\)/g)].map(match => [match[1], {}]));
    const failIfUsed = name => async () => { calls.push(name); throw Error('Unexpected external operation: ' + name); };
    Object.assign(dependencies, {
        '../core/parser': require('../src/core/parser'),
        '../services/scheduler': { registerTask() {} },
        '../core/queue': { add: allowCommand ? async (_, handler) => handler() : failIfUsed('queue') },
        '../services/logger': logger,
        '../services/evolution': {
            sendText: async (to, text) => sent.push({ to, text }),
            sendTyping: allowCommand ? async () => {} : failIfUsed('typing'), sendRecording: failIfUsed('recording'),
            downloadMedia: failIfUsed('download')
        },
        '../commands/descargar': {
            getSearchSession: () => activeSession,
            getDownloadSessionKey: from => from,
            matchSelection: require('../src/commands/descargar').matchSelection,
            extractAdultUrl: require('../src/commands/descargar').extractAdultUrl
        },
        '../services/ai': {
            routeWithAIOutcome: async () => { calls.push('route'); return outcome; },
            routeWithAI: failIfUsed('legacy-route'), chatWithBotsky: failIfUsed('chat')
        },
        '../services/agentEngine': { runUniversalAgent: failIfUsed('agent') },
        '../services/history': { getHistory: () => [], addMessage: (...args) => history.push(args) },
        './commandRegistry': {
            isRegisteredCommand: command => allowCommand && command === 'descargar',
            getCommandHandler: allowCommand ? async (command, context) => ({
                handler: async () => commands.push({ command, context }), queueTier: 'heavy'
            }) : failIfUsed('command')
        },
        './auth': {
            isAuthorizedAdmin: () => true, getSenderJid: (from, data) => data?.key?.participant || from,
            cleanJidNumber: jid => jid.split('@')[0], normalizePhoneNumber: value => value
        },
        '../services/proactive': { recordGroupActivity() {} },
        '../services/db': { getUserAffinityContext: async () => '' },
        '../commands/mensaje': { getPendingContactContext: () => [] },
        '../services/attachmentContext': {
            getAttachmentState: () => ({ attachments: [], activeId: null, pendingRequest: null }),
            clearPendingRequest() {}
        },
        '../services/semanticRouting': require('../src/services/semanticRouting'),
        '../services/contentReader': { prepareContent: failIfUsed('reader') },
        '../commands/buscar': { getSearchContext: () => [] }
    });
    // Feedback is pure; use the real implementation instead of mirroring it.
    for (const id of Object.keys(dependencies)) {
        if (id.endsWith('/operationFeedback')) dependencies[id] = require('../src/services/operationFeedback');
    }
    const module = { exports: {} };
    vm.runInNewContext(source, {
        module, exports: module.exports, process: { env: { BOT_NUMBER: '1234567890' } },
        Date, Intl, Map, Set, Buffer, setTimeout, clearTimeout,
        require(id) {
            if (!(id in dependencies)) throw Error('Import without mock: ' + id);
            return dependencies[id];
        }
    }, { filename: 'core/dispatcher.js' });
    return {
        sent, calls, history, logs, commands,
        async dispatch({ group = false, mentioned = false, media = false, text = 'Botsky busca videos sobre ciencia' } = {}) {
            const from = group ? 'class@g.us' : 'student@s.whatsapp.net';
            const contextInfo = mentioned ? { mentionedJid: ['1234567890@s.whatsapp.net'] } : {};
            const messageType = media ? 'imageMessage' : 'extendedTextMessage';
            const messageData = {
                key: { id: 'fake-msg', remoteJid: from, ...(group ? { participant: 'student@s.whatsapp.net' } : {}) },
                pushName: 'Ana', message: { [messageType]: { text, caption: text, mimetype: 'image/jpeg', contextInfo } }
            };
            return module.exports.dispatch({ from, text, messageType, messageData });
        }
    };
}

const failures = [
    { kind: 'blocked', provider: 'gemini', finishReason: 'SAFETY', retryable: false },
    { kind: 'configuration', provider: 'groq', httpStatus: 401, retryable: false },
    { kind: 'invalid_request', provider: 'groq', httpStatus: 400, retryable: false },
    { kind: 'rate_limit', provider: 'gemini', httpStatus: 429, retryable: true },
    { kind: 'empty_response', provider: 'gemini', retryable: true }
];

for (const failure of failures) {
    test(`Routing ${failure.kind}: feedback is sent without executing a guessed command or composing chat`, async () => {
        const h = harness({ ok: false, failure, attempts: [failure] });
        await h.dispatch();
        assert.deepEqual(h.calls, ['route']);
        assert.equal(h.sent.length, 1);
        assert.ok(typeof h.sent[0].text === 'string' && h.sent[0].text.trim().length > 0);
        assert.doesNotMatch(h.sent[0].text, /\/@ayuda|escribe bien|no encontré ni madres|Se me cruzaron los cables/i);
    });
}

test('Routing failure with an image never downloads or reads the attachment', async () => {
    const failure = { kind: 'empty_response', provider: 'gemini', retryable: true };
    const h = harness({ ok: false, failure, attempts: [failure] });
    await h.dispatch({ media: true, text: 'Manda esta imagen al grupo' });
    assert.deepEqual(h.calls, ['route']);
    assert.equal(h.sent.length, 1);
});

test('Unaddressed passive group messages do not route or send unsolicited feedback', async () => {
    const failure = { kind: 'rate_limit', provider: 'gemini', retryable: true };
    const h = harness({ ok: false, failure, attempts: [failure] });
    await h.dispatch({ group: true, text: 'El profe manda el archivo después' });
    assert.deepEqual(h.calls, []);
    assert.equal(h.sent.length, 0);
});

test('Routing failure on an explicit WhatsApp mention sends feedback locally', async () => {
    const failure = { kind: 'invalid_request', provider: 'groq', httpStatus: 400, retryable: false };
    const h = harness({ ok: false, failure, attempts: [failure] });
    await h.dispatch({ group: true, mentioned: true });
    assert.deepEqual(h.calls, ['route']);
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].to, 'class@g.us');
});

test('Different routing failures expose different actionable feedback', async () => {
    const feedback = [];
    for (const failure of failures) {
        const h = harness({ ok: false, failure, attempts: [failure] });
        await h.dispatch();
        feedback.push(h.sent[0]?.text);
    }
    // Configuration and malformed provider requests share the same user action:
    // the integration needs repair; spelling the request differently cannot help.
    assert.equal(new Set(feedback).size, 4);
});

test('Valid routing executes exactly the planned search once with its structured query', async () => {
    const query = 'tutorial de matemáticas';
    const h = harness({ ok: true, decision: {
        action: 'descargar', args: { query }, addressed_to_bot: true,
        uses_attachment: false, needs_clarification: false, sentiment: 'neutral'
    }, attempts: [] }, { allowCommand: true });
    await h.dispatch({ text: 'Botsky encuentra algo para aprender mates' });
    assert.deepEqual(h.calls, ['route']);
    assert.equal(h.commands.length, 1);
    assert.equal(h.commands[0].command, 'descargar');
    assert.deepEqual(Array.from(h.commands[0].context.parsed.args), [query]);
    assert.equal(h.commands[0].context.parsed.aiArgs.query, query);
    assert.equal(h.sent.length, 0);
});

test('R1 Fast-Path Pre-LLM para Adultos: intercepta peticiones para adultos antes de llamar al LLM', async () => {
    const h = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true });
    await h.dispatch({ text: 'busca porno de latinas' });
    assert.deepEqual(h.calls, [], 'No debe llamar al router de IA (fast-path)');
    assert.equal(h.commands.length, 1);
    assert.equal(h.commands[0].command, 'descargar');
    assert.strictEqual(h.commands[0].context.parsed.flags.adult, true);
    assert.strictEqual(h.commands[0].context.parsed.flags.nopor, true);
    assert.deepEqual(Array.from(h.commands[0].context.parsed.args), ['porno de latinas']);
});

test('R1 Fast-Path Pre-LLM para Sitios para Adultos: intercepta URL directa antes del LLM', async () => {
    const h = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true });
    await h.dispatch({ text: 'https://www.xvideos.com/video12345/test' });
    assert.deepEqual(h.calls, [], 'No debe llamar al router de IA con URL de XVideos');
    assert.equal(h.commands.length, 1);
    assert.equal(h.commands[0].command, 'descargar');
    assert.strictEqual(h.commands[0].context.parsed.flags.adult, true);
    assert.strictEqual(h.commands[0].context.parsed.flags.nopor, true);
    assert.deepEqual(Array.from(h.commands[0].context.parsed.args), ['https://www.xvideos.com/video12345/test']);
});

test('R2 Fallback de Rescate ante Bloqueos de Seguridad (blocked): rescata a descargar con términos de descarga o adultos', async () => {
    const failure = { kind: 'blocked', provider: 'gemini', finishReason: 'SAFETY', retryable: false };
    const h = harness({ ok: false, failure, attempts: [failure] }, { allowCommand: true });
    await h.dispatch({ text: 'descarga el video de chicas' });
    assert.deepEqual(h.calls, ['route'], 'Debe haber intentado consultar a la IA primero');
    assert.equal(h.commands.length, 1, 'Debe rescatar ejecutando el comando descargar');
    assert.equal(h.commands[0].command, 'descargar');
    assert.equal(h.sent.length, 0, 'No debe abortar ni enviar mensaje de error');
});

test('R1 Fast-Path: URL adulta sin protocolo se normaliza con https:// antes del LLM', async () => {
    const h = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true });
    await h.dispatch({ text: 'www.xvideos.com/video9999/test' });
    assert.deepEqual(h.calls, [], 'No debe llamar al router de IA');
    assert.equal(h.commands.length, 1);
    assert.equal(h.commands[0].command, 'descargar');
    assert.strictEqual(h.commands[0].context.parsed.flags.adult, true);
    assert.deepEqual(Array.from(h.commands[0].context.parsed.args), ['https://www.xvideos.com/video9999/test']);
});

test('R1 Fast-Path: mención de bot en grupo y formato natural se extraen correctamente', async () => {
    const h = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true });
    await h.dispatch({ text: '@5214437367565 busca porno de latinas en mp3' });
    assert.deepEqual(h.calls, [], 'No debe llamar al router de IA');
    assert.equal(h.commands.length, 1);
    assert.equal(h.commands[0].command, 'descargar');
    assert.strictEqual(h.commands[0].context.parsed.flags.adult, true);
    assert.strictEqual(h.commands[0].context.parsed.flags.f, 'mp3');
    assert.deepEqual(Array.from(h.commands[0].context.parsed.args), ['porno de latinas']);
});

test('R1 Fast-Path: selección de lista activa para adultos se procesa sin consultar al LLM', async () => {
    const activeSession = {
        results: [{ title: 'Video 1', url: 'https://xvideos.com/v1' }, { title: 'Video 2', url: 'https://xvideos.com/v2' }],
        isAdult: true
    };
    const h = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true, activeSession });
    await h.dispatch({ text: 'el 1' });
    assert.deepEqual(h.calls, [], 'No debe enviar títulos para adultos al LLM');
    assert.equal(h.commands.length, 1);
    assert.equal(h.commands[0].command, 'descargar');
    assert.strictEqual(h.commands[0].context.parsed.flags.adult, true);
    assert.deepEqual(Array.from(h.commands[0].context.parsed.args), ['el 1']);
});

test('R2 Fallback de Rescate: si LLM bloquea una selección con sesión activa, rescata a descargar', async () => {
    const activeSession = {
        results: [{ title: 'Canción 1', url: 'https://youtube.com/v1' }],
        isAdult: false
    };
    const failure = { kind: 'blocked', provider: 'gemini', finishReason: 'SAFETY', retryable: false };
    const h = harness({ ok: false, failure, attempts: [failure] }, { allowCommand: true, activeSession });
    await h.dispatch({ text: 'el 1' });
    assert.deepEqual(h.calls, ['route'], 'Intentó consultar al LLM');
    assert.equal(h.commands.length, 1, 'Debe rescatar a descargar');
    assert.equal(h.commands[0].command, 'descargar');
    assert.deepEqual(Array.from(h.commands[0].context.parsed.args), ['el 1']);
});

test('R1 Fast-Path en grupo: selección de lista activa requiere direccionamiento del bot', async () => {
    const activeSession = {
        results: [{ title: 'Video 1', url: 'https://xvideos.com/v1' }, { title: 'Video 2', url: 'https://xvideos.com/v2' }],
        isAdult: true
    };
    const h = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true, activeSession });
    await h.dispatch({ group: true, text: 'el 1' });
    assert.deepEqual(h.calls, [], 'La selección no dirigida se descarta antes del router');
    assert.equal(h.commands.length, 0, 'No debe ejecutar una selección de sesión sin direccionamiento');
});

test('R2 Fallback en grupo: una selección no dirigida con sesión activa no consulta ni ejecuta', async () => {
    const activeSession = {
        results: [{ title: 'Canción 1', url: 'https://youtube.com/v1' }],
        isAdult: false
    };
    const failure = { kind: 'blocked', provider: 'gemini', finishReason: 'SAFETY', retryable: false };
    const h = harness({ ok: false, failure, attempts: [failure] }, { allowCommand: true, activeSession });
    await h.dispatch({ group: true, text: 'el 1' });
    assert.deepEqual(h.calls, [], 'La selección no dirigida se descarta antes del LLM');
    assert.equal(h.commands.length, 0, 'No debe ejecutar la selección de sesión');
});

test('R1 Fast-Path: términos de video con porno/xxx ("video porno", "videos xxx") se interceptan antes del LLM', async () => {
    const h1 = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true });
    await h1.dispatch({ text: 'video porno' });
    assert.deepEqual(h1.calls, [], 'video porno no debe llamar al LLM');
    assert.equal(h1.commands.length, 1);
    assert.strictEqual(h1.commands[0].context.parsed.flags.adult, true);

    const h2 = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true });
    await h2.dispatch({ text: 'videos xxx de latinas' });
    assert.deepEqual(h2.calls, [], 'videos xxx no debe llamar al LLM');
    assert.equal(h2.commands.length, 1);
    assert.strictEqual(h2.commands[0].context.parsed.flags.adult, true);
});

test('R1 Fast-Path en grupo con mención de bot: "@bot porno de latinas" sin verbo se intercepta antes del LLM', async () => {
    const h = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true });
    await h.dispatch({ group: true, mentioned: true, text: '@1234567890 porno de latinas' });
    assert.deepEqual(h.calls, [], 'No debe llamar al router de IA');
    assert.equal(h.commands.length, 1);
    assert.equal(h.commands[0].command, 'descargar');
    assert.strictEqual(h.commands[0].context.parsed.flags.adult, true);
    assert.deepEqual(Array.from(h.commands[0].context.parsed.args), ['porno de latinas']);
});

test('R1 Fast-Path: verbos imperativos esdrújulos con tilde ("búscame porno de latinas", "descárgame porno de morenas") se interceptan antes del LLM', async () => {
    const h1 = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true });
    await h1.dispatch({ text: 'búscame porno de latinas' });
    assert.deepEqual(h1.calls, [], 'búscame porno no debe llamar al LLM');
    assert.equal(h1.commands.length, 1);
    assert.strictEqual(h1.commands[0].context.parsed.flags.adult, true);

    const h2 = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true });
    await h2.dispatch({ text: 'descárgame porno de morenas' });
    assert.deepEqual(h2.calls, [], 'descárgame porno no debe llamar al LLM');
    assert.equal(h2.commands.length, 1);
    assert.strictEqual(h2.commands[0].context.parsed.flags.adult, true);

    const h3 = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true });
    await h3.dispatch({ text: 'túmbate porno de rubias' });
    assert.deepEqual(h3.calls, [], 'túmbate porno no debe llamar al LLM');
    assert.equal(h3.commands.length, 1);
    assert.strictEqual(h3.commands[0].context.parsed.flags.adult, true);
});

test('R1 Fast-Path: URL adulta con puntuación final o espejo numérico se intercepta y normaliza', async () => {
    const h1 = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true });
    await h1.dispatch({ text: 'mira www.xvideos.com/video123.' });
    assert.deepEqual(h1.calls, [], 'No debe llamar al LLM');
    assert.equal(h1.commands.length, 1);
    assert.strictEqual(h1.commands[0].context.parsed.flags.adult, true);
    assert.deepEqual(Array.from(h1.commands[0].context.parsed.args), ['https://www.xvideos.com/video123']);

    const h2 = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true });
    await h2.dispatch({ text: 'https://www.xvideos2.com/video999' });
    assert.deepEqual(h2.calls, [], 'No debe llamar al LLM con espejo xvideos2');
    assert.equal(h2.commands.length, 1);
    assert.strictEqual(h2.commands[0].context.parsed.flags.adult, true);
    assert.deepEqual(Array.from(h2.commands[0].context.parsed.args), ['https://www.xvideos2.com/video999']);
});

test('R1 Fast-Path: consultas con artículos ("un porno de latinas", "oye compa busca porno") se interceptan antes del LLM', async () => {
    const h1 = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true });
    await h1.dispatch({ text: 'un porno de latinas' });
    assert.deepEqual(h1.calls, [], 'un porno no debe llamar al LLM');
    assert.equal(h1.commands.length, 1);
    assert.strictEqual(h1.commands[0].context.parsed.flags.adult, true);

    const h2 = harness({ ok: false, failure: { kind: 'blocked' } }, { allowCommand: true });
    await h2.dispatch({ text: 'oye compa busca porno de milfs' });
    assert.deepEqual(h2.calls, [], 'oye compa busca porno no debe llamar al LLM');
    assert.equal(h2.commands.length, 1);
    assert.strictEqual(h2.commands[0].context.parsed.flags.adult, true);
});
