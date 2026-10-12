'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// ─── 1. Tests de Circuit Breaker para Groq ──────────────────────────────────
test('Groq Circuit Breaker: Manejo de cooldown ante errores de cuota', async () => {
    const ai = require('../src/services/ai');

    // Reset inicial
    ai._resetGroqCircuitBreaker();
    assert.equal(ai.isGroqAvailable(), true, 'Groq debe estar disponible inicialmente');

    // Activar cooldown simulando 429
    ai.markGroqCooldown(60000);
    assert.equal(ai.isGroqAvailable(), false, 'Groq debe estar marcado como no disponible tras cooldown');

    // callGroq debe retornar null inmediatamente sin llamar a la red
    const result = await ai.callGroq({
        systemInstruction: 'test',
        userMessage: 'hola'
    });
    assert.equal(result, null, 'callGroq debe devolver null de inmediato durante cooldown');

    // Restaurar estado
    ai._resetGroqCircuitBreaker();
    assert.equal(ai.isGroqAvailable(), true, 'Groq debe volver a estar disponible tras reset');
});

// ─── 2. Tests de Descargas Ligeras de Video (<=10MB, 480p, <=5 min) ───────────
test('Descargar: Calidad por defecto 480p y selectores <=10MB', async () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(path.join(__dirname, '../src/commands/descargar.js'), 'utf-8');

    // Verificar que DEFAULT_QUALITY sea 480
    assert.match(content, /DEFAULT_QUALITY = process\.env\.YTDLP_DEFAULT_QUALITY \?\? '480'/);

    // Verificar selectores de bajo peso <10M y límite 15M
    assert.match(content, /filesize<\?10M/);
    assert.match(content, /--max-filesize', '15M'/);

    // Verificar recorte automático a 5 minutos (300 segundos) para videos
    assert.match(content, /\*00:00:00-00:05:00/);

    // Verificar filtro de duración en búsquedas (300 segundos)
    assert.match(content, /shortVideos = allCandidates\.filter\(r => r\.secs > 0 && r\.secs <= 300\)/);
});

// ─── 3. Tests del Gatekeeper Local y Memoria Pasiva en Grupos ────────────────
test('Gatekeeper: Ingesta en historial y filtrado de ruido trivial en grupos', async () => {
    const { dispatch, _resetCooldowns } = require('../src/core/dispatcher');
    const history = require('../src/services/history');

    _resetCooldowns();
    const groupJid = '120363888888888888@g.us';
    const userJid = '5214435810175@s.whatsapp.net';

    const evolution = require('../src/services/evolution');
    const ai = require('../src/services/ai');
    const origPost = evolution.client.post;
    const origChat = ai.chatWithBotsky;
    const origRoute = ai.routeWithAI;

    evolution.client.post = async () => ({ data: { status: 'SUCCESS' } });
    ai.chatWithBotsky = async () => 'Qué onda compa, aquí andamos';

    const origGroups = process.env.ALLOWED_GROUPS_NORMAL;
    const origAdmin = process.env.ALLOWED_NUMBERS_ADMIN;
    process.env.ALLOWED_GROUPS_NORMAL = '120363888888888888';
    process.env.ALLOWED_NUMBERS_ADMIN = '5214435810175';

    // Limpiar historial de pruebas
    history.clearHistory(groupJid);

    try {
        // Mensaje de risa trivial en grupo
        await dispatch({
            from: groupJid,
            text: 'jajajajaja xd',
            messageType: 'conversation',
            messageData: {
                key: { remoteJid: groupJid, participant: userJid, fromMe: false, id: 'MSG-FILLER-1' },
                pushName: 'Paco'
            }
        });

        // 1. El mensaje DEBE haberse guardado en el historial (Memoria pasiva a costo cero)
        const hist = history.getHistory(groupJid, 5);
        assert.equal(hist.length >= 1, true, 'El mensaje trivial debe quedar registrado en historial');
        assert.equal(hist[hist.length - 1].content.includes('jajajajaja xd'), true);

        // 2. Mensaje dirigido explícitamente a Botsky debe saltarse el gatekeeper y procesarse
        const addressedMsg = 'oye botsky qué onda';
        await dispatch({
            from: groupJid,
            text: addressedMsg,
            messageType: 'conversation',
            messageData: {
                key: { remoteJid: groupJid, participant: userJid, fromMe: false, id: 'MSG-BOTSKY-1' },
                pushName: 'Paco'
            }
        });

        const hist2 = history.getHistory(groupJid, 5);
        assert.equal(hist2.some(m => m.content.includes('botsky qué onda')), true);
    } finally {
        process.env.ALLOWED_GROUPS_NORMAL = origGroups;
        process.env.ALLOWED_NUMBERS_ADMIN = origAdmin;
        evolution.client.post = origPost;
        ai.chatWithBotsky = origChat;
        ai.routeWithAI = origRoute;
    }
});

// ─── 4. Tests de Validación Silenciosa de Enlaces y Configuración IA ──────────
test('Descargar: Enlace de foto de TikTok es ignorado en silencio sin lanzar error', async () => {
    const { handleDescargar } = require('../src/commands/descargar');
    const photoUrl = 'https://www.tiktok.com/@zen__070/photo/7680791101401304328?_r=1&_t=ZS-99xmLcBEG07';
    let threw = false;
    try {
        await handleDescargar({ flags: {}, args: [photoUrl] }, '123@s.whatsapp.net', { key: { id: 'test_photo_msg' } });
    } catch (e) {
        threw = true;
    }
    assert.equal(threw, false, 'No debe arrojar error para enlaces de fotos de TikTok');
});

test('IA: Configuración Groq y timeout rápido de Gemini (3s)', async () => {
    const fs = require('fs');
    const path = require('path');
    const aiContent = fs.readFileSync(path.join(__dirname, '../src/services/ai.js'), 'utf-8');

    // Modelo Groq 70B / 20B
    assert.match(aiContent, /llama-3\.3-70b-versatile/);
    // Timeout Gemini 3s / GEMINI_TIMEOUT_MS
    assert.match(aiContent, /timeout:\s*media\s*\?\s*35000\s*:\s*\(?parseInt\(process\.env\.GEMINI_TIMEOUT_MS/);
    // Manejo 413 en circuit breaker
    assert.match(aiContent, /status === 413/);
});

