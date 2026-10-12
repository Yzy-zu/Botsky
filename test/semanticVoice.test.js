'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, deps) {
    deps = { './aiFailure': require('../src/services/aiFailure'), './semanticRouting': require('../src/services/semanticRouting'), '../services/semanticRouting': require('../src/services/semanticRouting'), '../services/operationFeedback': require('../src/services/operationFeedback'), ...deps };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
        module, exports: module.exports, Set, Map, Buffer,
        require(name) { if (!(name in deps)) throw new Error('Unexpected dependency: ' + name); return deps[name]; }
    }, { filename: file });
    return module.exports;
}

function scriptService(answer) {
    const calls = [];
    const { createVoiceScriptService } = load('services/voiceScript.js', {
        './conversationStyle': { buildConversationStyle: () => 'Mexicano, natural.' }
    });
    const service = createVoiceScriptService({
        callGemini: async options => {
            calls.push(options);
            return { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answer) }] } };
        }, callGroq: async () => { throw Error('Unexpected fallback'); }
    });
    return { service, calls };
}

function command(decision = { action: 'voz', uses_attachment: false, args: { modo: 'compose', destino_scope: 'current_chat' } }) {
    const calls = { route: [], delivery: [], scripts: [], tts: [], sent: [], forwarded: [], notices: [], cleanup: 0 };
    const handler = load('commands/voz.js', {
        '../services/logger': { info() {}, warn() {}, error() {} },
        '../services/evolution': { sendRecording: async () => {}, sendText: async (...args) => calls.notices.push(args),
            sendVoiceNote: async (...args) => calls.sent.push(args) },
        '../services/tts': { generateVoiceNote: async (...args) => {
            calls.tts.push(args); return { filePath: '/tmp/mock-audio', cleanup: async () => calls.cleanup++ };
        } },
        '../services/voiceScript': { wordCount: () => 5, prepareVoiceScript: async args => {
            calls.scripts.push(args); return { success: true, mode: args.mode, text: args.mode === 'verbatim' ? args.literalText : 'Qué onda, aquí va el resumen.', voice: args.voice, durationSeconds: null };
        } },
        '../services/audioDuration': { fitAudioDuration: async audio => audio },
        '../services/history': { getHistory: () => [{ role: 'assistant', content: 'La clase empieza mañana.' }] },
        '../services/ai': { routeWithAI: async (...args) => { calls.route.push(args); return decision; } },
        '../services/outboundDelivery': { deliverSemantic: async options => {
            calls.delivery.push(options);
            return options.execute({ jid: options.args.destino_scope === 'main_group' ? 'group@g.us' : options.from, is_group: true });
        } },
        './enviarmedia': { handleEnviarMedia: async (...args) => { calls.forwarded.push(args); return { success: true }; } }
    });
    return { run: (parsed, data = {}) => handler.handleVoz(parsed, 'owner@s.whatsapp.net', data), calls };
}

test('Structured voice, mode, destination and duration survive conflicting words in the request', async () => {
    const h = command();
    const args = { modo: 'compose', voz: 'goku', durationSeconds: 45, destino_scope: 'current_chat',
        instruccion: 'Cuéntales que el audio de 30 segundos con voz de mujer ya está en el grupo.' };
    const result = await h.run({ raw: args.instruccion, aiArgs: args, semanticDecision: { action: 'voz', uses_attachment: false } });
    assert.equal(result.success, true);
    assert.equal(h.calls.route.length, 0);
    assert.equal(h.calls.scripts[0].mode, 'compose');
    assert.equal(h.calls.scripts[0].voice, 'goku');
    assert.equal(h.calls.scripts[0].durationSeconds, 45);
    assert.equal(h.calls.delivery[0].args.destino_scope, 'current_chat');
    assert.equal(h.calls.sent[0][0], 'owner@s.whatsapp.net');
    assert.equal(h.calls.cleanup, 1);
});

test('Natural literal plan preserves profanity and does not extract words or names from the raw request', async () => {
    const h = command();
    await h.run({ raw: 'Échales en voz de mujer, treinta segunditos, lo que te dicté.',
        aiArgs: { modo: 'verbatim', voz: 'dross', texto_literal: 'Qué pinche pedo, cabrón.', destino_scope: 'main_group' } });
    assert.equal(h.calls.scripts[0].literalText, 'Qué pinche pedo, cabrón.');
    assert.equal(h.calls.scripts[0].voice, 'dross');
    assert.equal(h.calls.scripts[0].isGroup, true);
    assert.equal(h.calls.sent[0][0], 'group@g.us');
    assert.equal(h.calls.tts[0][0], 'Qué pinche pedo, cabrón.');
});

test('Unstructured requests invoke the semantic router, even if they start with voz', async () => {
    const h = command();
    await h.run({ raw: 'voz goku explica lo de arriba', args: ['goku', 'explica lo de arriba'], command: 'voz' });
    assert.equal(h.calls.route.length, 1);
    assert.equal(h.calls.scripts[0].mode, 'compose');
    assert.equal(h.calls.scripts[0].voice, 'hombre');
});

test('Explicit terminal grammar keeps direct reading without natural-language classification', async () => {
    const h = command();
    await h.run({ raw: '/voz goku Hola, cabrón.', command: 'voz', hasPrefix: true, args: ['goku', 'Hola, cabrón.'] });
    assert.equal(h.calls.route.length, 0);
    assert.equal(h.calls.scripts[0].mode, 'verbatim');
    assert.equal(h.calls.scripts[0].voice, 'goku');
    assert.equal(h.calls.scripts[0].literalText, 'Hola, cabrón.');
});

test('Forward and clarification decisions never produce new audio', async () => {
    const forward = command({ action: 'enviarmedia', uses_attachment: true, attachment_id: 'original', args: { destino_scope: 'main_group' } });
    await forward.run({ raw: 'Que la banda escuche lo que te pasé.' });
    assert.equal(forward.calls.forwarded.length, 1);
    assert.equal(forward.calls.tts.length, 0);
    const ambiguous = command({ action: 'voz', needs_clarification: true, question: '¿Qué tema les cuento?' });
    const result = await ambiguous.run({ raw: 'Diles aquello en audio.' });
    assert.equal(result.success, false);
    assert.equal(ambiguous.calls.notices[0][1], '¿Qué tema les cuento?');
    assert.equal(ambiguous.calls.delivery.length, 0);
});

test('Literal script is preserved without a model or duration regex', async () => {
    const h = scriptService();
    const result = await h.service.prepareVoiceScript({ request: 'Audio de 30 segundos explicando cosas.',
        mode: 'verbatim', literalText: 'En 7 segundos llego, cabrón.', durationSeconds: 12, voice: 'dross' });
    assert.equal(result.text, 'En 7 segundos llego, cabrón.');
    assert.equal(result.durationSeconds, 12);
    assert.equal(h.calls.length, 0);
});

test('Semantic writer result can infer a duration and literal mode without keyword patterns', async () => {
    const h = scriptService({ mode: 'verbatim', text: 'Qué pinche pedo.', voice: 'goku', durationSeconds: 45 });
    const result = await h.service.prepareVoiceScript({ request: 'Conserva todas mis palabras y hazlo de tres cuartos de minuto.' });
    assert.equal(result.mode, 'verbatim');
    assert.equal(result.durationSeconds, 45);
    assert.equal(h.calls.length, 1);
});

test('Explicit script duration wins over numbers in the request or writer result', async () => {
    const h = scriptService({ mode: 'compose', text: 'En treinta segundos comienza la clase.', voice: 'hombre', durationSeconds: 30 });
    const result = await h.service.prepareVoiceScript({ request: 'Haz un audio diciendo que en 30 segundos comienza.',
        mode: 'compose', durationSeconds: 15 });
    assert.equal(result.durationSeconds, 15);
    assert.match(h.calls[0].systemInstruction, /Duración solicitada: 15 segundos/);
});

test('Missing literal words ask for clarification and malformed script mode is rejected', async () => {
    const missing = scriptService();
    const clarification = await missing.service.prepareVoiceScript({ mode: 'verbatim', request: 'Di lo mismo.' });
    assert.equal(clarification.needs_clarification, true);
    assert.equal(missing.calls.length, 0);
    const malformed = scriptService({ mode: 'unknown', text: 'Hola.' });
    assert.equal((await malformed.service.prepareVoiceScript({ request: 'Prepara un saludo.' })).success, false);
});
