'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const ai = require('../src/services/ai');
const { isAllowedPrivateTarget } = require('../src/services/proactive');
const logger = require('../src/services/logger');

test('Observación 1: Caché distingue por usuario (userId) en getCacheKey y routeWithAI', async () => {
    // Verificar que getCacheKey genera claves aisladas por usuario
    // routeWithAI debe aceptar userId y no cruzar resultados entre usuarios
    const msg = 'dame el resumen del servidor en pdf';
    const media = { type: 'documentMessage' };

    // Acceder indirectamente o probar llamadas concurrentes con usuarios distintos
    const key1 = msg.toLowerCase().trim() + `|${media.type}|user:user_pedro`;
    const key2 = msg.toLowerCase().trim() + `|${media.type}|user:user_juan`;
    const groupKey = ai.getCacheKey(msg, media, 'user_pedro', '120363@g.us');
    const privateKey = ai.getCacheKey(msg, media, 'user_pedro', '5215512345678@s.whatsapp.net');

    assert.notEqual(key1, key2, 'Las claves de caché de usuarios diferentes deben ser distintas');
    assert.ok(key1.includes('user:user_pedro'));
    assert.ok(key2.includes('user:user_juan'));
    assert.notEqual(groupKey, privateKey, 'Las rutas no deben cruzarse entre chats distintos');
});

test('Router: rechaza acciones desconocidas y argumentos no escalares', () => {
    assert.equal(ai.validateAiDecision({ action: 'inventar_comando', args: {} }), null);
    assert.equal(ai.validateAiDecision({ action: 'info', args: { query: { nested: true } } }), null);
    assert.equal(ai.validateAiDecision({ action: 'info', args: { cantidad: -1 } }), null);
    assert.equal(ai.validateAiDecision({ action: 'video', args: {} }).action, 'descargar');
});

test('Router: conserva sólo metadatos internos seguros para diagnóstico', () => {
    const decision = ai.validateAiDecision({
        action: 'info',
        confidence: 0.92,
        reason_code: 'explicit_command'
    });
    assert.equal(decision.confidence, 0.92);
    assert.equal(decision.reason_code, 'explicit_command');
    assert.equal(ai.validateAiDecision({ action: 'info', confidence: 4 }).confidence, null);
    assert.equal(ai.validateAiDecision({ action: 'info', reason_code: 'bad code\nsecret' }).reason_code, 'unspecified');
});

test('Router: permite opciones controladas sólo para encuestas', () => {
    const decision = ai.validateAiDecision({
        action: 'encuesta',
        args: { pregunta: '¿Qué hacemos?', opciones: ['Minecraft', 'Película'] }
    });
    assert.deepEqual(decision.args.opciones, ['Minecraft', 'Película']);
    assert.equal(ai.validateAiDecision({ action: 'info', args: { opciones: ['A', 'B'] } }), null);
});

test('Router: reconoce tareas visuales con lenguaje libre y no confunde sticker explícito', () => {
    const image = { type: 'imageMessage', mimetype: 'image/jpeg' };
    assert.equal(ai.isImageTaskRequest('haz el ejercicio de la foto', image), true);
    assert.equal(ai.isImageTaskRequest('¿qué significa esto?', image), true);
    assert.equal(ai.isImageTaskRequest('hazme sticker', image), false);
    assert.equal(ai.isImageTaskRequest('', image), false);
});

test('Proactivo: sólo permite destinatarios presentes en rencores activos', () => {
    const grudges = [{ jid: '5215512345678@s.whatsapp.net' }];
    assert.equal(isAllowedPrivateTarget('5215512345678@s.whatsapp.net', grudges), true);
    assert.equal(isAllowedPrivateTarget('5215512345678:2@s.whatsapp.net', grudges), true);
    assert.equal(isAllowedPrivateTarget('5215512345679@s.whatsapp.net', grudges), false);
    assert.equal(isAllowedPrivateTarget('5215512345678@g.us', grudges), false);
});

test('Observación 2: evaluateProactiveAction cuenta con rate-limit anti-spam', async () => {
    ai._resetProactiveCooldown();

    // Mock temporal de callGemini para simular que la IA decide actuar
    const origCallGemini = ai.callGemini;
    ai.callGemini = async () => JSON.stringify({
        should_act: true,
        channel: 'group',
        message: '¿Qué onda bola de vagos?',
        reason: 'chat muerto'
    });

    try {
        // Primera llamada: debe permitir la acción espontánea
        const first = await ai.evaluateProactiveAction({ idleMinutes: 90 });
        assert.equal(typeof first.should_act, 'boolean');
        assert.equal(first.should_act, true);
        assert.ok(typeof first.message === 'string' && first.message.length > 0);

        // Segunda llamada inmediata: el rate-limit anti-spam DEBE bloquearla
        const second = await ai.evaluateProactiveAction({ idleMinutes: 91 });
        assert.equal(second.should_act, false, 'El rate-limit debe bloquear una segunda acción proactiva consecutiva');
        assert.equal(second.reason, 'rate_limited_cooldown');

        // Con bypassCooldown: true debe permitir saltárselo si se requiere explícitamente
        const bypassed = await ai.evaluateProactiveAction({ idleMinutes: 92, bypassCooldown: true });
        assert.equal(typeof bypassed.should_act, 'boolean');
    } finally {
        ai.callGemini = origCallGemini;
        ai._resetProactiveCooldown();
    }
});

test('Observación 3: Groq fallback sin soporte de visión emite log de métrica [AI-METRICS]', async () => {
    const origWarn = logger.warn;
    let loggedMetrics = [];
    logger.warn = (msg) => {
        if (typeof msg === 'string' && msg.includes('[AI-METRICS]')) {
            loggedMetrics.push(msg);
        }
    };

    const origCallGemini = ai.callGemini;
    const origGroqKey = process.env.GROQ_API_KEY;

    // Forzar fallo de Gemini para activar fallback a Groq
    ai.callGemini = async () => { throw new Error('Simulated Gemini 503'); };
    process.env.GROQ_API_KEY = 'mock_groq_key';

    try {
        const mediaContext = {
            mimetype: 'image/jpeg',
            base64: 'fake_base64_data'
        };

        const reply = await ai.chatWithBotsky('¿qué ves en esta foto?', 'Pedro', false, [], mediaContext);
        assert.ok(reply.includes('Se me trabó un momento la conexión visual'));
        assert.ok(loggedMetrics.length > 0, 'Debe haber emitido al menos un log con etiqueta [AI-METRICS]');
        assert.ok(loggedMetrics.some(m => m.includes('Pedro')), 'El log de métricas debe registrar al usuario');
    } finally {
        logger.warn = origWarn;
        ai.callGemini = origCallGemini;
        process.env.GROQ_API_KEY = origGroqKey;
    }
});

test('Problema A: handleTerminal preserva el verbo y texto completo en lenguaje natural', async () => {
    const agent = require('../src/services/agent');
    const { handleTerminal } = require('../src/commands/terminal');
    const evolution = require('../src/services/evolution');

    let passedPrompt = '';
    const origRunAgent = agent.runAgentWithTerminal;
    const origSendText = evolution.sendText;
    const origAdmin = process.env.ALLOWED_NUMBERS_ADMIN;

    process.env.ALLOWED_NUMBERS_ADMIN = '5214435810175';

    agent.runAgentWithTerminal = async ({ userMessage }) => {
        passedPrompt = userMessage;
        return { text: 'ok' };
    };
    evolution.sendText = async () => {};

    const mockMessageData = {
        key: { participant: '5214435810175@s.whatsapp.net' },
        pushName: 'Admin'
    };

    try {
        // Caso 1: Lenguaje natural general ("reinicia el contenedor de minecraft")
        // parser tradicionalmente dejaba command: 'reinicia', args: ['el', 'contenedor', 'de', 'minecraft']
        const naturalParsed1 = {
            command: 'terminal',
            originalCommand: 'reinicia',
            hasPrefix: false,
            args: ['el', 'contenedor', 'de', 'minecraft'],
            raw: 'reinicia el contenedor de minecraft'
        };
        await handleTerminal(naturalParsed1, '120363432759815247@g.us', mockMessageData);
        assert.equal(passedPrompt, 'reinicia el contenedor de minecraft', 'Debe conservar el verbo "reinicia" completo');

        // Caso 2: Otra orden en lenguaje natural ("apaga el servicio redis de inmediato")
        const naturalParsed2 = {
            command: 'terminal',
            originalCommand: 'apaga',
            hasPrefix: false,
            args: ['el', 'servicio', 'redis', 'de', 'inmediato'],
            raw: 'apaga el servicio redis de inmediato'
        };
        await handleTerminal(naturalParsed2, '120363432759815247@g.us', mockMessageData);
        assert.equal(passedPrompt, 'apaga el servicio redis de inmediato', 'Debe conservar el verbo "apaga" completo');

        // Caso 3: Comando explícito con prefijo (/@terminal docker ps -a)
        const explicitParsed = {
            command: 'terminal',
            originalCommand: 'terminal',
            hasPrefix: true,
            args: ['docker', 'ps', '-a'],
            raw: '/@terminal docker ps -a'
        };
        await handleTerminal(explicitParsed, '120363432759815247@g.us', mockMessageData);
        assert.equal(passedPrompt, 'docker ps -a', 'Comandos con prefijo deben extraer solo los argumentos');
    } finally {
        agent.runAgentWithTerminal = origRunAgent;
        evolution.sendText = origSendText;
        process.env.ALLOWED_NUMBERS_ADMIN = origAdmin;
    }
});

