'use strict';

// VM mocks keep contacts, WhatsApp, Gemini and authorization off the live VPS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {loadModule}=require('./aiOfflineHarness.test');

const contacts = [
    { jid: '5215511111111@s.whatsapp.net', user_name: 'Fernando' },
    { jid: '5215522222222@s.whatsapp.net', user_name: 'Fernanda' }
];
const from = '5215599999999@s.whatsapp.net';

function harness({ authorized = true, failRecipient = false, failConfirmation = false, generated = 'Oye, me llame mañana.', deferSend = false } = {}) {
    const messages = [], prompts = [];
    let now = 1000, release;
    class Clock extends Date { static now() { return now; } }
    const module = { exports: {} };
    const deps = {
        '../services/evolution': {
            async sendText(jid, text) {
                if (failRecipient && jid !== from) throw new Error('Transport down');
                if (failConfirmation && jid === from) throw new Error('Chat unavailable');
                if (deferSend && contacts.some(contact => contact.jid === jid)) await new Promise(resolve => { release = resolve; });
                messages.push({ jid, text });
            },
            async getGroupInfo() { return { participants: [] }; }
        },
        '../core/auth':loadModule('core/auth.js',{}, {env:{ALLOWED_NUMBERS_ADMIN:authorized?'5215599999999,5215500000001':''}}),
        '../services/db': { db: { all: (_, params, done) => done(null, contacts) } },
        '../services/logger': { info() {}, warn() {}, error() {} },
        '../services/ai': {
            async callGemini(input) { prompts.push(input); return generated; },
            async callGroq() { return null; }
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/commands/mensaje.js'), 'utf8'), {
        module, exports: module.exports, Date: Clock, Map, console,
        require(name) { if (!(name in deps)) throw new Error(`Unexpected import ${name}`); return deps[name]; }
    });
    const api = module.exports;
    const delivery = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/outboundDelivery.js'), 'utf8'), { module: delivery, exports: delivery.exports, require: id => ({ './evolution': deps['../services/evolution'], './logger': deps['../services/logger'], '../core/auth': deps['../core/auth'], '../commands/mensaje': api }[id]) });
    deps['../services/outboundDelivery'] = delivery.exports;
    function loadTool() {
        const toolModule = { exports: {} };
        const toolDeps = {
            '../core/auth':deps['../core/auth'], './commandUsageRuntime':{trackTool:(_name,_args,_ctx,run)=>run()},
            './logger': deps['../services/logger'], './db': deps['../services/db'], './evolution': deps['../services/evolution'],
            '../utils/messageText': { resolveMessageText() { throw new Error('Unexpected quoted text resolution'); } },
            '../utils/reminderInput': { prepareReminder() { throw new Error('Unexpected reminder preparation'); } },
            '../commands/mensaje': api
        };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/toolRegistry.js'), 'utf8'), {
            module: toolModule, exports: toolModule.exports, Date: Clock, Map, console,
            require(name) { if (!(name in toolDeps)) throw new Error(`Unexpected import ${name}`); return toolDeps[name]; }
        });
        return toolModule.exports;
    }
    return { api, loadTool, messages, prompts, advance: amount => { now += amount; }, release: () => release?.() };
}

function request(h, overrides = {}) {
    return h.api.sendContactMessage({ contacto: 'Fer', mensaje: 'me llame mañana', anonimo: true, from, messageData: { pushName: 'Ana' }, ...overrides });
}

test('Recado ambiguo pide opciones y no manda a ningún contacto', async () => {
    const h = harness();
    const result = await request(h);
    assert.equal(result.success, false);
    assert.equal(result.status, 'needs_clarification');
    assert.equal(result.opciones.length, 2);
    assert.match(result.pregunta, /Fernando/);
    assert.match(result.pregunta, /Fernanda/);
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].jid, from);
    const target = await h.api.findGroupContact('Fer');
    assert.equal(target.ambiguous, true);
    assert.equal(target.jid, undefined);
});

test('Elección numérica conserva recado y anonimato sin pedir repetirlo', async () => {
    const h = harness();
    await request(h);
    const result = await h.api.handlePendingContactChoice({ from, args: { selection: 2 } });
    assert.equal(result.consumed, true);
    assert.equal(result.success, true);
    assert.equal(result.jid, contacts[1].jid);
    const delivered = h.messages.find(message => message.jid === contacts[1].jid);
    assert.match(delivered.text, /me llame mañana/);
    assert.ok(!delivered.text.includes('Ana'));
    assert.match(h.prompts[0].systemInstruction, /SEÑAL CONFIRMADA/);
    assert.equal((await h.api.handlePendingContactChoice({ from, args: { selection: 2 } })).consumed, false);
});

test('Nombre completo selecciona el contacto correcto y API tool no duplica confirmación', async () => {
    const h = harness();
    await request(h, { sendConfirmation: false });
    assert.equal(h.messages.length, 0);
    const result = await h.api.handlePendingContactChoice({ from, args: { selection: 2 } });
    assert.equal(result.destinatario, 'Fernanda');
    assert.equal(h.messages.filter(message => message.jid === contacts[1].jid).length, 1);
    const direct = await request(h, { contacto: 'Fernando', sendConfirmation: false });
    assert.equal(direct.success, true);
    assert.equal(h.messages.filter(message => message.jid === from).length, 1);
});

test('Número fuera de rango no pierde recado y comandos ajenos siguen su ruta', async () => {
    const h = harness();
    await request(h);
    assert.equal((await h.api.handlePendingContactChoice({ from, text: 'daily' })).consumed, false);
    const invalid = await h.api.handlePendingContactChoice({ from, args: { selection: 4 } });
    assert.equal(invalid.status, 'needs_clarification');
    assert.equal(h.messages.filter(message => message.jid !== from).length, 0);
    assert.equal((await h.api.handlePendingContactChoice({ from, args: { selection: 1 } })).success, true);
});

test('Sesiones de recado se aíslan por chat y remitente, incluido JID alternativo', async () => {
    const h = harness();
    const messageData = { key: { participant: 'lid-a@lid', participantAlt: '5215500000001@s.whatsapp.net' } };
    await request(h, { from: 'group@g.us', messageData, sendConfirmation: false });
    assert.equal((await h.api.handlePendingContactChoice({ from: 'other@g.us', messageData, args: { selection: 1 } })).consumed, false);
    assert.equal((await h.api.handlePendingContactChoice({ from: 'group@g.us', messageData: { key: { participant: 'other@s.whatsapp.net' } }, args: { selection: 1 } })).consumed, false);
    const result = await h.api.handlePendingContactChoice({ from: 'group@g.us', messageData: { key: { participant: '5215500000001@s.whatsapp.net' } }, args: { selection: 1 } });
    assert.equal(result.success, true);
});

test('Sesión vencida no envía el recado; cancelar también elimina selección', async () => {
    const h = harness();
    await request(h);
    h.advance(h.api.CONTACT_CHOICE_TTL_MS + 1);
    assert.equal((await h.api.handlePendingContactChoice({ from, args: { selection: 1 } })).consumed, false);
    await request(h);
    const cancelled = await h.api.handlePendingContactChoice({ from, args: { cancel: true } });
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await h.api.handlePendingContactChoice({ from, args: { selection: 1 } })).consumed, false);
    assert.equal(h.messages.filter(message => message.jid !== from).length, 0);
});

test('Fallo de entrega devuelve error y conserva la selección para reintentar', async () => {
    const h = harness({ failRecipient: true });
    await request(h);
    const result = await h.api.handlePendingContactChoice({ from, args: { selection: 2 } });
    assert.equal(result.success, false);
    assert.equal(result.status, 'send_failed');
    const retry = await h.api.handlePendingContactChoice({ from, args: { selection: 2 } });
    assert.equal(retry.consumed, false);
    assert.equal(h.messages.some(message => /ya le escribí/.test(message.text)), false);
});

test('Confirmación fallida no declara que falló un recado ya entregado', async () => {
    const h = harness({ failConfirmation: true });
    const result = await request(h, { contacto: 'Fernando' });
    assert.equal(result.success, true);
    assert.equal(result.enviado_al_chat, false);
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].jid, contacts[0].jid);
});

test('Dos respuestas simultáneas no envían el mismo recado dos veces', async () => {
    const h = harness({ deferSend: true });
    await request(h);
    const first = h.api.handlePendingContactChoice({ from, args: { selection: 1 } });
    await new Promise(resolve => setImmediate(resolve));
    const second = await h.api.handlePendingContactChoice({ from, args: { selection: 1 } });
    assert.equal(second.status, 'busy');
    h.release();
    assert.equal((await first).success, true);
    assert.equal(h.messages.filter(message => message.jid === contacts[0].jid).length, 1);
});

test('No hay autorización ni coincidencia parcial: jamás se manda un recado', async () => {
    const denied = harness({ authorized: false });
    assert.equal((await request(denied)).status, 'denied');
    assert.equal(denied.prompts.length, 0);
    const h = harness();
    const result = await request(h, { contacto: 'Fernanz' });
    assert.equal(result.status, 'not_found');
    assert.equal(h.messages.filter(message => message.jid !== from).length, 0);
});

test('Comando acepta campos nativos de Gemini y anonimato sin prefijo', async () => {
    const h = harness();
    const result = await h.api.handleMensaje({ aiArgs: { contacto: 'Fer', mensaje: 'me llame', anonimo: true } }, from, { pushName: 'Ana' });
    assert.equal(result.status, 'needs_clarification');
    assert.ok(!h.messages[0].text.includes('/@'));
});

test('Selección natural y prioridad del normalizador usan la misma sesión y caducidad', async () => {
    const h = harness();
    await request(h);
    assert.equal(h.api.hasPendingContactChoice(from, {}), true);
    assert.equal((await h.api.handlePendingContactChoice({ from, text: '' })).consumed, false);
    assert.equal((await h.api.handlePendingContactChoice({ from, args: { selection: 2 } })).jid, contacts[1].jid);
    assert.equal(h.api.hasPendingContactChoice(from, {}), false);
    await request(h);
    h.advance(h.api.CONTACT_CHOICE_TTL_MS + 1);
    assert.equal(h.api.hasPendingContactChoice(from, {}), false);
});

test('Aclaración de contactos publica contrato compartido sin perder pregunta española', async () => {
    const h = harness();
    const result = await request(h, { sendConfirmation: false });
    assert.equal(result.needs_clarification, true);
    assert.equal(result.question, result.pregunta);
    assert.deepEqual([...result.missing_fields], ['contacto']);
    for (const [overrides, expected] of [
        [{ contacto: '', mensaje: '' }, ['contacto', 'mensaje']],
        [{ contacto: '', mensaje: 'me llame' }, ['contacto']],
        [{ contacto: 'Fernando', mensaje: '' }, ['mensaje']]
    ]) {
        const missing = await request(h, { ...overrides, sendConfirmation: false });
        assert.equal(missing.needs_clarification, true);
        assert.equal(missing.question, missing.pregunta);
        assert.deepEqual([...missing.missing_fields], expected);
    }
});

test('Tool de recados conserva contrato de aclaración y completa la entrega al elegir', async () => {
    const h = harness();
    const tool = h.loadTool();
    const result = await tool.executeTool('enviar_mensaje_contacto', {
        contacto: 'Fer', mensaje: 'me llame', anonimo: true
    }, { from, messageData: { pushName: 'Ana' }, isAdmin: true });
    assert.equal(result.success, false);
    assert.equal(result.needs_clarification, true);
    assert.equal(result.question, result.pregunta);
    assert.deepEqual([...result.missing_fields], ['contacto']);
    assert.equal(result.opciones.length, 2);
    assert.equal(h.messages.length, 1);
    const sent = await h.api.handlePendingContactChoice({ from, args: { selection: 2 } });
    assert.equal(sent.success, true);
    assert.equal(sent.jid, contacts[1].jid);
    assert.ok(!sent.mensaje_enviado.includes('Ana'));
});
