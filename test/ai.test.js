'use strict';

const test = require('node:test');
const assert = require('node:assert');
require('dotenv').config();

const { chatWithBotsky, routeWithAI } = require('../src/services/ai');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('AI: chatWithBotsky responde con personalidad', async () => {
    const res = await chatWithBotsky('hola botsky', 'Tester', false, []);
    assert.strictEqual(typeof res, 'string');
    assert.ok(res.length > 0);
    await sleep(1500);
});

test('AI: chatWithBotsky responde con historial', async () => {
    const history = [{ role: 'user', content: 'hola botsky' }, { role: 'assistant', content: 'hola compa' }];
    const res = await chatWithBotsky('cómo estás', 'Tester', false, history);
    assert.strictEqual(typeof res, 'string');
    assert.ok(res.length > 0);
    await sleep(1500);
});

test('AI: routeWithAI devuelve JSON válido para comandos', async () => {
    const res = await routeWithAI('descarga el video de michael jackson thriller', 'Tester', false, []);
    assert.ok(res, 'Debe devolver un objeto JSON');
    assert.strictEqual(typeof res.action, 'string');
    assert.strictEqual(res.action, 'descargar');
    await sleep(1500);
});

test('AI: routeWithAI extrae parámetros complejos (formato, corte, velocidad)', async () => {
    const res = await routeWithAI(
        'descarga esta rola https://youtu.be/test1234 en mp3 de 0:30 a 1:00 a 1.5x',
        'Tester',
        false,
        []
    );
    assert.ok(res, 'Debe devolver un objeto');
    assert.strictEqual(res.action, 'descargar');
    assert.strictEqual(res.args?.formato, 'mp3');
    assert.ok(res.args?.ss, 'Debe extraer tiempo de inicio');
    assert.ok(res.args?.to, 'Debe extraer tiempo de fin');
    await sleep(1500);
});

test('AI: routeWithAI clasifica saludos y chatWithBotsky genera la respuesta', async (t) => {
    const requests = [];
    t.mock.method(require('axios'), 'post', async (url, payload) => {
        requests.push(payload);
        const isRouting = payload.generationConfig?.responseMimeType === 'application/json';
        const text = isRouting
            ? JSON.stringify({ action: 'chat', args: {}, addressed_to_bot: true, use_tools: false, message: 'Borrador del clasificador que debe descartarse' })
            : 'Qué onda, aquí ando.';
        return { data: { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } }] } };
    });
    const res = await routeWithAI('qué onda botsky cómo andas', 'Tester', false, []);
    assert.ok(res, 'Debe devolver un objeto');
    assert.strictEqual(res.action, 'chat');
    assert.strictEqual(res.message, '', 'El router descarta su borrador y deja la redacción a la conversación');
    assert.strictEqual(res.use_tools, false, 'Un saludo no requiere herramientas');
    assert.deepStrictEqual(res.args, {});
    assert.strictEqual(requests.length, 1, 'Clasificar el saludo no genera una segunda respuesta');
    const reply = await chatWithBotsky('qué onda botsky cómo andas', 'Tester', false, []);
    assert.strictEqual(reply, 'Qué onda, aquí ando.', 'La respuesta proviene de la etapa de conversación');
    assert.strictEqual(requests.length, 2);
    assert.strictEqual(requests[0].generationConfig.responseMimeType, 'application/json');
    assert.strictEqual(requests[1].generationConfig.responseMimeType, undefined);
});

test('AI: routeWithAI procesa contexto multimedia (audioMessage -> efecto)', async () => {
    const mediaContext = {
        type: 'audioMessage',
        mimetype: 'audio/ogg; codecs=opus',
        fileName: ''
    };
    const res = await routeWithAI('ponle voz de ardilla', 'Tester', false, [], mediaContext);
    assert.ok(res, 'Debe devolver un objeto');
    assert.strictEqual(res.action, 'efecto');
    assert.strictEqual(res.args?.tipo, 'ardilla');
    await sleep(1500);
});
