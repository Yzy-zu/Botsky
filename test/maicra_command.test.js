'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const evolution = require('../src/services/evolution');
const fs = require('node:fs');
const vm = require('node:vm');
const remote = require('./helpers/minecraftOffline').createMinecraftOffline().remote;
const moduleFixture = { exports: {} };
const dependencies = { '../services/evolution': evolution, '../services/minecraftRemote': remote,
    '../services/logger': { info() {}, warn() {}, error() {} }, '../core/auth': require('../src/core/auth') };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/commands/maicra.js'), 'utf8'), {
    module: moduleFixture, exports: moduleFixture.exports, Map, Set, Buffer,
    require(id) { assert.ok(id in dependencies, `Missing Minecraft command dependency ${id}`); return dependencies[id]; }
}, { filename: 'maicra-command-offline.js' });
const { handleMaicra } = moduleFixture.exports;

// Mock temporal de sendText y sendPoll para pruebas
let sentMessages = [];
let sentPolls = [];

const origSendText = evolution.sendText;
const origSendPoll = evolution.sendPoll;

test.beforeEach(() => {
    sentMessages = [];
    sentPolls = [];
    evolution.sendText = async (to, text) => {
        sentMessages.push({ to, text });
        return { messageId: 'mock_msg_123' };
    };
    evolution.sendPoll = async (to, name, options) => {
        sentPolls.push({ to, name, options });
        return { messageId: 'mock_poll_123' };
    };
});

test.afterEach(() => {
    evolution.sendText = origSendText;
    evolution.sendPoll = origSendPoll;
});

test('Maicra Command 1: Sin argumentos envía reporte en vivo unificado (cero encuestas/polls)', async () => {
    await handleMaicra({ args: [] }, '5214435810175@s.whatsapp.net', {});
    assert.strictEqual(sentPolls.length, 0, 'No debe enviar encuestas');
    assert.strictEqual(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('Minecraft Bedrock'));
    assert.ok(msg.includes('Supervivencia'));
    assert.ok(msg.includes('Jugadores'));
    assert.ok(msg.includes('Mundo activo'));
});

test('Maicra Command 2: "mods" consulta y envía el resumen de addons', async () => {
    await handleMaicra({ args: ['mods'] }, '5214435810175@s.whatsapp.net', {});
    assert.ok(sentMessages.length >= 2, 'Debe enviar mensaje de progreso y luego el resumen');
    const finalMsg = sentMessages[sentMessages.length - 1].text;
    assert.ok(finalMsg.includes('Mundo activo:'));
    assert.ok(finalMsg.includes('Supervivencia'));
    assert.ok(finalMsg.includes('Addons activos'));
});

test('Maicra Command 3: "jugadores" consulta jugadores activos en vivo', async () => {
    await handleMaicra({ args: ['jugadores'] }, '5214435810175@s.whatsapp.net', {});
    assert.strictEqual(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('Minecraft Bedrock'));
    assert.ok(msg.includes('Jugadores en línea'));
});

test('Maicra Command 4: "estado" consulta estado del contenedor y recursos', async () => {
    await handleMaicra({ args: ['estado'] }, '5214435810175@s.whatsapp.net', {});
    assert.strictEqual(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('Minecraft Bedrock Online'));
    assert.ok(msg.includes('Uptime:'));
});

test('Maicra Command 5: "mundos" lista los mundos creados y el activo', async () => {
    await handleMaicra({ args: ['mundos'] }, '5214435810175@s.whatsapp.net', {});
    assert.strictEqual(sentMessages.length, 1);
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('Mundos en Minecraft Bedrock'));
    assert.ok(msg.includes('MUNDO ACTIVO'));
});

test('Maicra Command 6: Opción de encuesta WhatsApp "📦 Ver Mods y Addons" conserva plan canónico del modelo', async () => {
    await handleMaicra({ args: ['📦', 'Ver', 'Mods', 'y', 'Addons'], aiArgs: { subcomando: 'mods' }, semanticDecision: { action: 'maicra' } }, '5214435810175@s.whatsapp.net', {});
    const finalMsg = sentMessages[sentMessages.length - 1].text;
    assert.ok(finalMsg.includes('Mundo activo:'));
});

test('Maicra Command 7: Frase natural "qué mods tiene el server" conserva subcomando canónico mods', async () => {
    await handleMaicra({ args: ['qué', 'mods', 'tiene', 'el', 'server'], aiArgs: { subcomando: 'mods' }, semanticDecision: { action: 'maicra' } }, '5214435810175@s.whatsapp.net', {});
    const finalMsg = sentMessages[sentMessages.length - 1].text;
    assert.ok(finalMsg.includes('Mundo activo:'));
});

test('Maicra Command 8: Frase natural "quién está jugando" conserva subcomando canónico jugadores', async () => {
    await handleMaicra({ args: ['quién', 'está', 'jugando'], aiArgs: { subcomando: 'jugadores' }, semanticDecision: { action: 'maicra' } }, '5214435810175@s.whatsapp.net', {});
    const msg = sentMessages[0].text;
    assert.ok(msg.includes('Jugadores en línea'));
});

test('Maicra Command 9: Usuario no admin no puede encender el servidor', async () => {
    await handleMaicra({ args: ['on'] }, '5210000000000@s.whatsapp.net', {});
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].text.includes('Acceso denegado'));
});

test('Maicra Command 10: Usuario no admin no puede ejecutar comandos de consola', async () => {
    await handleMaicra({ args: ['cmd', 'say hola'] }, '5210000000000@s.whatsapp.net', {});
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].text.includes('Acceso denegado'));
});

test('Maicra Command 11: Usuario no admin no puede desactivar mods', async () => {
    await handleMaicra({ args: ['desactivarmod', 'LuckyBlocks'] }, '5210000000000@s.whatsapp.net', {});
    assert.strictEqual(sentMessages.length, 1);
    assert.ok(sentMessages[0].text.includes('Acceso denegado'));
});
