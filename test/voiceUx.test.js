'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { promisify } = require('node:util');
const execute = promisify(require('node:child_process').execFile);
const requests = {};
const { createVoiceScriptService } = require('../src/services/voiceScript');
const { createAudioDuration } = require('../src/services/audioDuration');
const style = require('../src/services/conversationStyle');
const generation = require('../src/services/generationSettings');
const logger = { info() {}, warn() {}, error() {} };
const root = path.join(__dirname, '../src');

function load(file, deps, env = {}) {
    deps = { './aiFailure': require('../src/services/aiFailure'), './semanticRouting': require('../src/services/semanticRouting'), '../services/semanticRouting': require('../src/services/semanticRouting'), '../services/operationFeedback': require('../src/services/operationFeedback'), ...deps };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
        module, exports: module.exports, process: { env }, Date, Intl, Map, Set, Buffer,
        require(id) { if (!(id in deps)) throw Error('Import sin mock: ' + id); return deps[id]; }
    }, { filename: file });
    return module.exports;
}

function scriptHarness({ answer = { mode: 'compose', text: 'Qué onda, mañana no hay clase. Nos vemos el viernes.', voice: 'hombre', durationSeconds: null },
    failGemini = false, failGroq = false, finishReason = 'STOP' } = {}) {
    const calls = [];
    const raw = typeof answer === 'string' ? answer : JSON.stringify(answer);
    const ai = load('services/ai.js', {
        https: { Agent: class {} }, './logger': logger, './scheduler': { registerTask() {} },
        './aiConfig': { getAiConfig: () => ({}) }, './conversationStyle': style,
        './generationSettings': generation, '../utils/mediaDeliveryRequest': {}, '../utils/contentIntent': {}, '../utils/voiceRequest': requests,
        axios: { post: async (url, payload) => {
            calls.push({ url, payload });
            if ((url.includes('googleapis') && failGemini) || (url.includes('groq') && failGroq)) {
                throw Object.assign(Error('fallo simulado'), { response: { status: 400 } });
            }
            return url.includes('googleapis')
                ? { data: { candidates: [{ finishReason, content: { parts: [{ text: raw }] } }] } }
                : { data: { choices: [{ finish_reason: finishReason === 'MAX_TOKENS' ? 'length' : 'stop', message: { content: raw } }] } };
        } }
    }, { GEMINI_API_KEY: 'fake-key', GROQ_API_KEY: 'fake-key' });
    const service = createVoiceScriptService({ callGemini: ai.callGemini, callGroq: ai.callGroq });
    return { ai, calls, service };
}

test('El proveedor TTS recibe las groserías completas después de limpiar el formato', async () => {
    const spoken = [];
    const tts = load('services/tts.js', {
        child_process: { spawn() { throw Error('No se permite síntesis real en esta prueba'); } }, fs, path, './logger': logger,
        './elevenlabs': { generateElevenLabsVoiceNote: async text => { spoken.push(text); return { filePath: '/tmp/fake-audio', cleanup() {} }; }, resolveElevenLabsVoiceId() {} }
    }, { ELEVENLABS_API_KEY: 'fake-key' });
    await tts.generateVoiceNote('*Qué pinche pedo, cabrón.* No mames.', { voz: 'daniel' });
    assert.deepEqual(spoken, ['Qué pinche pedo, cabrón. No mames.']);
});

test('Metadata de terminación queda fuera del Content que los agentes reenvían a Gemini', async () => {
    const h = scriptHarness();
    const content = await h.ai.callGemini({ userMessage: 'test', returnContent: true });
    assert.ok(content.parts.length);
    assert.equal(Object.hasOwn(content, 'finishReason'), false);
    const response = await h.ai.callGemini({ userMessage: 'test', returnContent: true, returnMetadata: true });
    assert.equal(response.finishReason, 'STOP');
    assert.ok(response.content.parts.length);
    assert.equal(Object.hasOwn(response.content, 'finishReason'), false);
});

test('Guion usa petición, cita e historial, y no sintetiza la orden literal', async () => {
    const h = scriptHarness();
    const request = 'manda un audio donde digas lo de mañana con tono mexicano';
    const result = await h.service.prepareVoiceScript({ request, quotedText: 'El profe canceló la clase mañana.', history: [{ role: 'assistant', content: 'Volvemos el viernes.' }] });
    assert.equal(result.success, true); assert.equal(result.mode, 'compose');
    assert.ok(!result.text.includes('manda un audio'));
    const payload = h.calls[0].payload;
    const data = JSON.parse(payload.contents[0].parts[0].text);
    assert.equal(data.peticion, request); assert.match(data.cita, /canceló/);
    assert.equal(data.historial[0].content, 'Volvemos el viernes.');
    assert.equal(payload.generationConfig.temperature, 0.7);
    assert.match(payload.systemInstruction.parts[0].text, /NO obligan a repetir/);
});

test('Guion para 30 segundos recibe objetivo oral de palabras, no cuota de chat', async () => {
    const h = scriptHarness();
    const result = await h.service.prepareVoiceScript({ request: 'graba un audio de 30 segundos explicando lo que pasó', durationSeconds: 30 });
    assert.equal(result.durationSeconds, 30);
    assert.match(h.calls[0].payload.systemInstruction.parts[0].text, /aproximadamente 72 palabras/);
    assert.match(h.calls[0].payload.systemInstruction.parts[0].text, /se medirá el audio real/);
});

test('Lectura explícita y comando directo preservan las groserías sin gastar llamadas de composición', async () => {
    const h = scriptHarness();
    const result = await h.service.prepareVoiceScript({ request: 'voz', mode: 'verbatim', literalText: 'Qué pinche pedo, cabrón.' });
    assert.equal(result.text, 'Qué pinche pedo, cabrón.');
    assert.equal(result.mode, 'verbatim'); assert.equal(h.calls.length, 0);
    assert.match(style.buildConversationStyle({}), /No las censures con asteriscos/);
});

test('Pedir un tono vulgar permite palabras fuertes en el guion generado', async () => {
    const h = scriptHarness({ answer: { mode: 'compose', text: 'No mames, qué pinche desmadre, cabrón.', voice: 'hombre' } });
    const result = await h.service.prepareVoiceScript({ request: 'manda un audio bien vulgar hablando del desmadre de hoy' });
    assert.equal(result.text, 'No mames, qué pinche desmadre, cabrón.');
    assert.match(h.calls[0].payload.systemInstruction.parts[0].text, /sin censura tipográfica/);
});

test('Sin tema, pregunta en vez de generar una grabación vacía o recitar el encargo', async () => {
    const h = scriptHarness({ answer: { needs_clarification: true, question: '¿Qué quieres que comunique?' } });
    const result = await h.service.prepareVoiceScript({ request: 'haz un audio' });
    assert.equal(result.success, false); assert.equal(result.needs_clarification, true);
    assert.equal(result.question, '¿Qué quieres que comunique?');
});

test('Borradores inválidos o que repiten el encargo no se envían al sintetizador', async () => {
    for (const answer of ['null', '[]', 'sin JSON', { text: '' }, { text: 'haz un audio' }]) {
        const h = scriptHarness({ answer });
        const result = await h.service.prepareVoiceScript({ request: 'haz un audio' });
        assert.equal(result.success, false);
    }
});

test('Duración inválida pide aclaración antes de usar proveedores', async () => {
    for (const durationSeconds of [0, -10, 601, true, 'no sé']) {
        const h = scriptHarness();
        const result = await h.service.prepareVoiceScript({ request: 'graba un audio de saludo', durationSeconds });
        assert.equal(result.needs_clarification, true);
        assert.equal(h.calls.length, 0);
    }
});

test('Si falla Gemini, el respaldo recibe el mismo contexto de guion', async () => {
    const h = scriptHarness({ failGemini: true });
    const result = await h.service.prepareVoiceScript({ request: 'manda un audio diciendo que ya voy', quotedText: '¿Ya vienes?' });
    assert.equal(result.success, true); assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].payload.messages[0].content, h.calls[0].payload.systemInstruction.parts[0].text);
    assert.equal(h.calls[1].payload.messages[1].content, h.calls[0].payload.contents[0].parts[0].text);
});

test('Proveedor caído o respuesta truncada no se sustituyen por lectura literal del encargo', async () => {
    for (const settings of [{ failGemini: true, failGroq: true }, { finishReason: 'MAX_TOKENS' }]) {
        const h = scriptHarness(settings);
        const result = await h.service.prepareVoiceScript({ request: 'graba un audio contando lo de ayer' });
        assert.equal(result.success, false); assert.equal(result.text, undefined);
    }
});

test('Adjunto para guion llega al modelo visual y no se analiza a ciegas con respaldo', async () => {
    const h = scriptHarness({ failGemini: true });
    const result = await h.service.prepareVoiceScript({ request: 'explica esta imagen en un audio', mediaContext: { type: 'imageMessage', mimetype: 'image/png', base64: 'fake' } });
    assert.equal(result.success, false); assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].payload.contents[0].parts[0].inlineData.mimeType, 'image/png');
});

test('Revisión de longitud conserva el encargo y datos originales', async () => {
    const h = scriptHarness();
    await h.service.prepareVoiceScript({ request: 'audio de 30 segundos diciendo lo de mañana', quotedText: 'Sin clase mañana',
        revision: { previousText: 'Mañana no hay clase.', measuredSeconds: 10, wordTarget: 80 } });
    const data = JSON.parse(h.calls[0].payload.contents[0].parts[0].text);
    assert.equal(data.revision.segundos_medidos, 10);
    assert.equal(data.revision.palabras_objetivo, 80);
    assert.equal(data.cita, 'Sin clase mañana');
});

function commandHarness({ scripts = [{ success: true, mode: 'compose', text: 'Qué onda, mañana no hay clase.', voice: 'hombre', durationSeconds: null }],
    durations = [30], failSend = false, failTts = false } = {}) {
    const prepared = [], generated = [], sent = [], notices = [], cleaned = [], fits = [];
    const command = load('commands/voz.js', {
        '../services/outboundDelivery': { deliverSemantic: async ({execute,from}) => execute({jid:from,is_group:false,user_name:'este chat'}) },
        '../utils/mediaDeliveryRequest': {}, '../services/logger': logger,
        '../services/evolution': { sendRecording: async () => {}, sendText: async (_, text) => notices.push(text), sendVoiceNote: async (...args) => { if (failSend) throw Error('fallo envío'); sent.push(args); } },
        '../services/tts': { generateVoiceNote: async (text, options) => {
            if (failTts) throw Error('fallo proveedor');
            const number = generated.push({ text, options });
            return { filePath: '/tmp/fake-' + number, cleanup: async () => cleaned.push(number), provider: 'fake' };
        } },
        '../services/voiceScript': { prepareVoiceScript: async params => { prepared.push(params); return scripts[Math.min(prepared.length - 1, scripts.length - 1)]; }, wordCount: text => text.split(/\s+/).length },
        '../services/audioDuration': { fitAudioDuration: async (result, target) => { fits.push({ result, target }); return { ...result, durationSeconds: durations[Math.min(fits.length - 1, durations.length - 1)] }; } },
        '../services/history': { getHistory: () => [{ role: 'assistant', content: 'Mañana no hay clase.' }] }, '../utils/voiceRequest': requests,
        '../services/contentReader': { prepareContent: async () => ({ success: true, mediaContext: { type: 'imageMessage', mimetype: 'image/png', base64: 'image' } }) }
    });
    const run = (parsed = {}, messageData = {}) => command.handleVoz(parsed, 'student@s.whatsapp.net', messageData);
    return { run, prepared, generated, sent, notices, cleaned, fits };
}

test('Comando entrega sólo guion compuesto y conserva la cita junto con el historial', async () => {
    const h = commandHarness();
    const request = 'graba un audio de 30 segundos diciendo bla bla de mañana';
    const result = await h.run({ raw: request, args: ['bla bla'], aiArgs: { instruccion: request } }, { pushName: 'Ana', message: { extendedTextMessage: { contextInfo: { quotedMessage: { conversation: '¿Hay clase?' } } } } });
    assert.equal(h.prepared[0].request, request);
    assert.equal(h.prepared[0].quotedText, '¿Hay clase?');
    assert.equal(h.prepared[0].history[0].content, 'Mañana no hay clase.');
    assert.equal(h.generated[0].text, 'Qué onda, mañana no hay clase.');
    assert.equal(h.sent[0][2].transcript, h.generated[0].text);
    assert.equal(result.success, true); assert.equal(result.enviado_al_chat, true);
    assert.deepEqual(h.cleaned, [1]);
});

test('Duración compuesta se mide y reescribe una sola vez cuando no cabe a ritmo natural', async () => {
    const h = commandHarness({ scripts: [
        { success: true, mode: 'compose', text: 'Mañana no hay clase.', voice: 'hombre', durationSeconds: 30 },
        { success: true, mode: 'compose', text: 'Qué onda, mañana no hay clase; volvemos el viernes y podemos repasar mientras tanto.', voice: 'hombre', durationSeconds: 30 }
    ], durations: [12, 30] });
    const result = await h.run({ raw: 'graba un audio de 30 segundos diciendo lo de mañana', aiArgs: {} });
    assert.equal(h.prepared.length, 2); assert.equal(h.generated.length, 2);
    assert.equal(h.prepared[1].revision.measuredSeconds, 12);
    assert.equal(h.sent[0][1], '/tmp/fake-2');
    assert.equal(result.durationSeconds, 30); assert.equal(h.notices.length, 0);
    assert.deepEqual(h.cleaned, [1, 2]);
});

test('Lectura literal no rellena ni cambia palabras para cumplir segundos', async () => {
    const h = commandHarness({ scripts: [{ success: true, mode: 'verbatim', text: 'Qué pinche pedo.', voice: 'hombre', durationSeconds: 30 }], durations: [3] });
    await h.run({ raw: 'graba un audio de 30 segundos, di exactamente qué pinche pedo', aiArgs: { texto_literal: 'Qué pinche pedo.' } });
    assert.equal(h.prepared.length, 1); assert.equal(h.generated[0].text, 'Qué pinche pedo.');
    assert.match(h.notices[0], /literal dura 3 s/);
    assert.equal(h.sent.length, 1);
});

test('Si el segundo borrador empeora, conserva el audio más cercano al objetivo', async () => {
    const h = commandHarness({ scripts: [{ success: true, mode: 'compose', text: 'Mañana no hay clase.', voice: 'hombre', durationSeconds: 30 }], durations: [20, 60] });
    const result = await h.run({ raw: 'haz un audio de 30 segundos', aiArgs: {} });
    assert.equal(result.durationSeconds, 20); assert.equal(h.sent[0][1], '/tmp/fake-1');
    assert.deepEqual(h.cleaned, [2, 1]);
    assert.match(h.notices[0], /unos 20 s/);
});

test('Error de guion o aclaración no generan audio y no informan éxito', async () => {
    const h = commandHarness({ scripts: [{ success: false, needs_clarification: true, question: '¿Sobre qué tema?' }] });
    const result = await h.run({ raw: 'haz un audio', aiArgs: {} });
    assert.equal(result.success, false); assert.equal(result.needs_clarification, true);
    assert.equal(h.generated.length, 0); assert.equal(h.sent.length, 0);
    assert.deepEqual(h.notices, ['¿Sobre qué tema?']);
});

test('Síntesis o entrega fallida devuelven fallo y limpian el audio generado', async () => {
    for (const failure of [{ failTts: true }, { failSend: true }]) {
        const h = commandHarness(failure);
        const result = await h.run({ raw: 'haz un audio diciendo que ya voy', aiArgs: {} });
        assert.equal(result.success, false); assert.equal(h.sent.length, 0);
        assert.match(h.notices[0], /No pude preparar o enviar/);
        if (failure.failSend) assert.deepEqual(h.cleaned, [1]);
    }
});

test('Comando directo de voz mantiene lectura simple y voz elegida', async () => {
    const h = commandHarness();
    await h.run({ command: 'voz', hasPrefix: true, raw: 'voz goku Qué onda, cabrón', args: ['goku', 'Qué onda, cabrón'], flags: {} });
    assert.equal(h.prepared[0].mode, 'verbatim');
    assert.equal(h.prepared[0].literalText, 'Qué onda, cabrón');
    assert.equal(h.prepared[0].voice, 'goku');
});

test('Frase exacta entre comillas se extrae sin controles de voz ni duración en el texto hablado', async () => {
    const h = commandHarness();
    await h.run({ raw: 'graba un audio de 30 segundos con voz de Goku donde digas exactamente “Qué pinche pedo, cabrón.”', aiArgs: {modo:'verbatim',texto_literal:'Qué pinche pedo, cabrón.',voz:'goku',durationSeconds:30} });
    assert.equal(h.prepared[0].mode, 'verbatim');
    assert.equal(h.prepared[0].literalText, 'Qué pinche pedo, cabrón.');
    assert.equal(h.prepared[0].voice, 'goku');
});

test('Cita de imagen se prepara para voz y no se confunde con video para convertir', async () => {
    const h = commandHarness();
    await h.run({ raw: 'haz un audio explicando esta imagen', aiArgs: {} }, { key: { id: 'current' }, quotedStanzaId: 'image-original', messageType: 'imageMessage', message: { imageMessage: { mimetype: 'image/png' } } });
    assert.equal(h.prepared[0].mediaContext.mimetype, 'image/png');
    assert.equal(h.sent.length, 1);
});

test('Herramienta de voz transmite petición e historial reales y devuelve el resultado confirmado', async () => {
    const received = [];
    const actual = { success: false, error: 'Proveedor caído', enviado_al_chat: true };
    const registry = load('services/toolRegistry.js', {
        './logger': logger, './db': {}, './evolution': {},
        '../utils/messageText': require('../src/utils/messageText'), '../utils/reminderInput': require('../src/utils/reminderInput'),
        '../commands/voz': { handleVoz: async (...args) => { received.push(args); return actual; } }
    });
    const history = [{ role: 'assistant', content: 'Mañana no hay clase' }];
    const result = await registry.executeTool('sintetizar_voz', { texto: 'borrador', durationSeconds: 30 }, { from: 'student@s.whatsapp.net', userMessage: 'manda un audio sobre eso', history });
    assert.equal(result.success, false); assert.equal(result.error, 'Proveedor caído');
    assert.equal(received[0][0].raw, 'manda un audio sobre eso');
    assert.equal(received[0][0].voiceContext.history, history);
    assert.equal(received[0][0].aiArgs.durationSeconds, 30);
});

test('Ajuste usa tempo acotado y preserva todo el audio, sin recortar ni añadir silencio', async () => {
    const commands = [], removed = [], cleaned = [];
    let probes = 0;
    const timing = createAudioDuration({ execute: async (command, args) => {
        commands.push({ command, args });
        return command === 'ffprobe' ? { stdout: String(++probes === 1 ? 33 : 30.02) } : { stdout: '' };
    }, remove: async file => removed.push(file) });
    const result = await timing.fitAudioDuration({ filePath: '/tmp/mock.mp3', cleanup: async () => cleaned.push(true) }, 30);
    assert.equal(result.durationSeconds, 30.02); assert.equal(result.timingAdjusted, true);
    const ffmpeg = commands.find(command => command.command === 'ffmpeg');
    assert.ok(ffmpeg.args.includes('atempo=1.100000'));
    assert.ok(!ffmpeg.args.includes('-t')); assert.ok(!ffmpeg.args.join(' ').includes('apad'));
    await result.cleanup(); assert.equal(removed.length, 1); assert.equal(cleaned.length, 1);
});

test('Ajuste no acelera excesivamente una grabación incompatible con la duración', async () => {
    const commands = [];
    const timing = createAudioDuration({ execute: async command => { commands.push(command); return { stdout: '60' }; } });
    const result = await timing.fitAudioDuration({ filePath: '/tmp/mock.mp3' }, 30);
    assert.equal(result.timingAdjusted, false); assert.equal(result.durationSeconds, 60);
    assert.deepEqual(commands, ['ffprobe']);
});

test('FFmpeg y ffprobe reales ajustan un tono sintético y limpian temporales sin API de voz', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'botsky-audio-test-'));
    const input = path.join(directory, 'tone.mp3');
    try {
        await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-y', input]);
        const timing = createAudioDuration();
        const original = await timing.measureAudioDuration(input);
        const target = original / 1.14;
        const result = await timing.fitAudioDuration({ filePath: input, cleanup: () => fs.promises.rm(input, { force: true }) }, target);
        assert.equal(result.timingAdjusted, true);
        assert.ok(Math.abs(result.durationSeconds - target) < 0.15);
        await result.cleanup();
        assert.equal(fs.existsSync(input), false); assert.equal(fs.existsSync(result.filePath), false);
    } finally { await fs.promises.rm(directory, { force: true, recursive: true }); }
});
