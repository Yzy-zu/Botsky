'use strict';

// Ejercita el código de producción con transportes y almacenamiento simulados.
// No importa .env ni inicia workers ni abre la base del bot.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const scheduleData = require('../src/services/school_schedule_data');
const from = 'test-user@s.whatsapp.net';

function harness({ extracted = {}, authorized = true, schedule = [] } = {}) {
    const tasks = [], messages = [], geminiCalls = [];
    const settings = { target_group_jid: 'test-group@g.us', timezone: 'America/Mexico_City' };
    const db = {
        getSchoolSettings: async () => settings,
        getSchoolSchedule: async () => schedule,
        createSchoolTask: async task => { tasks.push(task); return { id: 42, ...task }; }
    };
    const deps = {
        fs: { existsSync: () => false },
        path,
        './db': db,
        '../services/db': db,
        '../utils/messageText': require('../src/utils/messageText'),
        '../utils/reminderInput': require('../src/utils/reminderInput'),
        './evolution': { sendText: async (_, text) => messages.push(text) },
        '../services/evolution': { sendText: async (_, text) => messages.push(text) },
        './logger': { info() {}, warn() {}, error() {} },
        './scheduler': { registerIntervalSeconds() {} },
        '../core/auth': {
            isAuthorizedTaskUploader: () => authorized,
            isAuthorizedAdmin: () => authorized,
            getSenderJid: () => from
        },
        './school_schedule_data': scheduleData,
        './ai': { callGemini: async input => { geminiCalls.push(input); return JSON.stringify(extracted); } }
    };
    function load(relative) {
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
            module, exports: module.exports, process: { env: { TZ: 'America/Mexico_City' } },
            Date, Intl, Map, Set, Buffer, console,
            require: name => {
                if (!(name in deps)) throw new Error('Unexpected import: ' + name);
                return deps[name];
            }
        }, { filename: relative });
        return module.exports;
    }
    const school = load('services/school.js');
    deps['../services/school'] = deps['./school'] = school;
    return { school, command: load('commands/tareas.js'), tool: load('services/toolRegistry.js'), tasks, messages, geminiCalls };
}

test('Tareas: frase natural llega a Gemini y se guarda sin barras ni prefijo', async () => {
    const h = harness({ extracted: { subject: 'Seguridad Informática', task: 'Investigar puertos TCP y UDP', explicit_due: '2026-10-16T23:59:00-06:00', details: 'Entregar en la libreta' } });
    const raw = 'Botsky guarda que nos dejaron investigar puertos TCP y UDP para el viernes en la libreta';
    await h.command.handleTareas({ aiArgs: { accion: 'crear' }, raw }, from, {});
    assert.equal(h.geminiCalls[0].userMessage, raw);
    assert.equal(h.tasks.length, 1);
    assert.equal(h.tasks[0].title, 'Investigar puertos TCP y UDP');
    assert.equal(h.tasks[0].details, 'Entregar en la libreta');
    assert.ok(h.tasks[0].dueAt);
    assert.equal(h.tasks[0].targetGroupJid, 'test-group@g.us');
    assert.ok(!h.messages.join('').includes('Usa:'));
});

test('Tareas: argumentos de una frase larga no se interpretan como columnas obligatorias', async () => {
    const h = harness({ extracted: { subject: 'Seguridad Informática', task: 'Investigar puertos', explicit_due: '2026-10-16T23:59:00-06:00' } });
    const raw = 'tarea crear nos dejaron investigar puertos para el viernes';
    await h.command.handleTareas({ args: ['crear', 'nos', 'dejaron', 'investigar', 'puertos', 'para', 'el', 'viernes'], raw }, from, {});
    assert.equal(h.geminiCalls.length, 1);
    assert.equal(h.tasks[0].title, 'Investigar puertos');
    assert.equal(h.tasks[0].subject, 'Seguridad Informática');
});

test('Tareas: campos de Gemini sin fecha usan próxima clase conocida', async () => {
    const h = harness();
    await h.command.handleTareas({ aiArgs: { accion: 'crear', materia: 'seguridad', titulo: 'Investigar puertos' } }, from, {});
    assert.equal(h.tasks.length, 1);
    assert.ok(h.tasks[0].dueAt);
    assert.match(h.tasks[0].dueText, /próxima clase/);
    assert.equal(h.geminiCalls.length, 0);
});

test('Tareas: materia o fecha desconocidas no obligan a inventar datos', async () => {
    const h = harness();
    await h.command.handleTareas({ aiArgs: { accion: 'crear', titulo: 'Preparar una exposición' } }, from, {});
    assert.equal(h.tasks.length, 1);
    assert.equal(h.tasks[0].subject, 'General');
    assert.equal(h.tasks[0].dueAt, null);
    assert.equal(h.tasks[0].dueText, 'Sin fecha de entrega');
});

test('Tareas: fecha no interpretable se conserva pendiente, sin sustituir por próxima clase', async () => {
    const h = harness();
    await h.command.handleTareas({ aiArgs: { accion: 'crear', materia: 'seguridad', titulo: 'Investigar puertos', fecha: 'cuando indique la profesora' } }, from, {});
    assert.equal(h.tasks.length, 0);
    assert.match(h.messages.at(-1), /fecha de entrega/);
});

test('Tareas: instrucciones estructuradas anteriores siguen funcionando', async () => {
    const h = harness();
    await h.command.handleTareas({ args: ['crear', 'Redes', 'Configurar router', '2026-10-19T23:59:00-06:00'] }, from, {});
    assert.equal(h.tasks[0].title, 'Configurar router');
    assert.equal(h.tasks[0].subject, 'Redes');
    assert.ok(h.tasks[0].dueAt);
});

test('Tareas: petición vacía pide solo qué hacer y no guarda basura', async () => {
    const h = harness();
    await h.command.handleTareas({ args: ['crear'] }, from, {});
    assert.equal(h.tasks.length, 0);
    assert.match(h.messages[0], /Qué hay que hacer/);
});

test('Herramienta IA: comparte grupo, autorización y fechas del comando sin enviar confirmación duplicada', async () => {
    const h = harness();
    const result = await h.tool.executeTool('tareas_escolares', { accion: 'crear', titulo: 'Leer el capítulo 3' }, { from, messageData: {}, userMessage: 'Guarda que hay que leer el capítulo 3' });
    assert.equal(result.success, true);
    assert.equal(result.tarea_id, 42);
    assert.equal(h.tasks[0].targetGroupJid, 'test-group@g.us');
    assert.equal(h.tasks[0].dueAt, null);
    assert.equal(h.messages.length, 0);
});

test('Herramienta IA: no guarda tareas de un remitente sin autorización', async () => {
    const h = harness({ authorized: false });
    const result = await h.tool.executeTool('tareas_escolares', { accion: 'crear', titulo: 'Leer' }, { from, messageData: {} });
    assert.equal(result.success, false);
    assert.equal(h.tasks.length, 0);
});
