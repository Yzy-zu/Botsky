'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractQuotedText, resolveMessageText } = require('../src/utils/messageText');
const { parseReminderTime, prepareReminder } = require('../src/utils/reminderInput');

// Solo módulos locales puros y dobles. Cualquier dependencia nueva falla antes de tocar servicios.
function harness() {
    const savedNotes = [], savedReminders = [], replies = [];
    const db = {
        async addNote(...args) { savedNotes.push(args); return { id: 7 }; },
        async addReminder(...args) { savedReminders.push(args); return { id: 8 }; }
    };
    const evolution = { async sendText(to, text) { replies.push(text); } };
    const logger = { info() {}, error() {}, warn() {} };
    function load(relativePath) {
        const file = path.resolve(__dirname, '..', relativePath);
        const module = { exports: {} };
        const requireMock = specifier => {
            if (specifier.endsWith('/db') || specifier === './db') return db;
            if (specifier.endsWith('/evolution') || specifier === './evolution') return evolution;
            if (specifier.endsWith('/logger') || specifier === './logger') return logger;
            if (specifier.endsWith('/scheduler')) return { registerIntervalSeconds() {} };
            if (specifier.endsWith('/messageText')) return { extractQuotedText, resolveMessageText };
            if (specifier.endsWith('/reminderInput')) return require('../src/utils/reminderInput');
            throw new Error(`Dependencia no permitida en prueba aislada: ${specifier}`);
        };
        vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
            module, exports: module.exports, require: requireMock, Date,
            process: { env: { TZ: 'America/Mexico_City' } }
        }, { filename: file });
        return module.exports;
    }
    return { db, savedNotes, savedReminders, replies,
        tools: load('src/services/toolRegistry.js'),
        notes: load('src/commands/notas.js'), reminders: load('src/commands/recordatorios.js') };
}

const quote = { message: { extendedTextMessage: { contextInfo: { quotedMessage: {
    conversation: 'Comprar hielo para la reunión'
} } } } };
const context = { from: 'grupo@g.us', senderJid: 'yo@s.whatsapp.net', userName: 'Compa', messageData: quote };

test('Herramienta: falta/tiempo inválido pide aclaración y no escribe recordatorios', async () => {
    const h = harness();
    for (const invalid of [undefined, 'luego', 'a las 25:00', 'a las 9:75', '-5m', '2020-01-01T09:00:00Z']) {
        const result = await h.tools.executeTool('recordatorios_alarmas', { accion: 'crear', mensaje: 'Comprar hielo', tiempo: invalid }, context);
        assert.equal(result.success, false);
        assert.equal(result.needs_clarification, true);
        assert.match(result.question, /Cuándo/);
    }
    assert.equal(h.savedReminders.length, 0);
});

test('Herramienta: minutos inválidos, vacíos o infinitos no crean recordatorios', async () => {
    const h = harness();
    for (const minutos of [0, -1, NaN, Infinity, 'no', '', null]) {
        const result = await h.tools.executeTool('recordatorios_alarmas', { accion: 'crear', mensaje: 'Comprar hielo', minutos }, context);
        assert.equal(result.needs_clarification, true);
    }
    assert.equal(h.savedReminders.length, 0);
});

test('Herramienta y comando guardan el mismo texto citado sin repetirlo', async () => {
    const h = harness();
    const result = await h.tools.executeTool('notas_tablon', { accion: 'guardar' }, context);
    await h.notes.handleNotas({ args: ['guardar'] }, context.from, quote);
    assert.equal(result.success, true);
    assert.equal(h.savedNotes.length, 2);
    assert.equal(h.savedNotes[0][3], h.savedNotes[1][3]);
    assert.equal(h.savedNotes[0][3], 'Comprar hielo para la reunión');
});

test('Herramienta y comando crean recordatorios usando la cita y el tiempo indicado', async () => {
    const h = harness();
    const result = await h.tools.executeTool('recordatorios_alarmas', { accion: 'crear', minutos: 20 }, context);
    await h.reminders.handleRecordar({ aiArgs: { minutos: 20 } }, context.from, quote);
    assert.equal(result.success, true);
    assert.equal(h.savedReminders.length, 2);
    assert.equal(h.savedReminders[0][3], h.savedReminders[1][3]);
    assert.ok(Math.abs(h.savedReminders[0][4] - h.savedReminders[1][4]) < 1000);
});

test('Citas de imágenes, documentos, videos y mensajes envueltos funcionan', () => {
    for (const type of ['imageMessage', 'videoMessage', 'documentMessage']) {
        const msg = { message: { [type]: { contextInfo: { quotedMessage: { [type]: { caption: '  Contenido citado  ' } } } } } };
        assert.equal(extractQuotedText(msg), 'Contenido citado');
    }
    assert.equal(extractQuotedText({ contextInfo: { quotedMessage: {
        ephemeralMessage: { message: { conversation: 'Nota envuelta' } }
    } } }), 'Nota envuelta');
    assert.equal(extractQuotedText({ message: { conversation: 'Mensaje actual, sin cita' } }), null);
});

test('Referencia esto usa cita; contenido explícito conserva prioridad', () => {
    assert.equal(resolveMessageText('', quote), 'Comprar hielo para la reunión');
    assert.equal(resolveMessageText('ese mensaje', quote), 'ese mensaje');
    assert.equal(resolveMessageText('  Comprar flores  ', quote), 'Comprar flores');
    assert.equal(resolveMessageText('esto', {}), 'esto');
});

test('Sin contenido ni cita pide aclarar; no crea texto genérico', async () => {
    const h = harness();
    const noQuote = { ...context, messageData: {} };
    const note = await h.tools.executeTool('notas_tablon', { accion: 'guardar' }, noQuote);
    const reminder = await h.tools.executeTool('recordatorios_alarmas', { accion: 'crear', minutos: 10 }, noQuote);
    assert.equal(note.needs_clarification, true);
    assert.equal(reminder.needs_clarification, true);
    await h.reminders.handleRecordar({ aiArgs: { minutos: 10 } }, context.from, {});
    assert.match(h.replies.at(-1), /Qué te recuerdo/);
    assert.equal(h.savedNotes.length + h.savedReminders.length, 0);
});

test('Comando manual relativo y cita sin contenido permanecen válidos', async () => {
    const h = harness();
    await h.reminders.handleRecordar({ args: ['15m', 'Comprar', 'pan'] }, context.from, {});
    await h.reminders.handleRecordar({ args: ['30m'] }, context.from, quote);
    assert.equal(h.savedReminders[0][3], 'Comprar pan');
    assert.equal(h.savedReminders[1][3], 'Comprar hielo para la reunión');
});

test('Comando: hora inválida no escribe BD aunque Gemini adjunte minutos', async () => {
    const h = harness();
    await h.reminders.handleRecordar({ aiArgs: { tiempo: '25:00', minutos: 10, mensaje: 'Comprar pan' } }, context.from, {});
    assert.equal(h.savedReminders.length, 0);
    assert.match(h.replies.at(-1), /Cuándo/);
});

test('Fecha ISO conserva fecha completa y gana a minutos inferidos', () => {
    const now = Date.parse('2026-10-09T12:00:00Z');
    const iso = '2026-10-12T18:30:00Z';
    assert.equal(parseReminderTime(iso, 10, now).dueAt, Date.parse(iso));
    for (const invalid of ['2026-02-30T18:30:00Z', '2026-10-12T25:00:00Z', '2026-10-12T18:70:00Z']) {
        assert.equal(parseReminderTime(invalid, 10, now), null);
    }
});

test('Duraciones y minutos de Gemini válidos conservan plazo; no capturan números sueltos', () => {
    const now = Date.parse('2026-10-09T12:00:00Z');
    for (const [text, minutes] of [['15m', 15], ['2h', 120], ['7d', 10080]]) {
        assert.equal(parseReminderTime(text, null, now).dueAt, now + minutes * 60000);
    }
    assert.equal(parseReminderTime(null, 30, now).dueAt, now + 30 * 60000);
    assert.equal(parseReminderTime('en 2 horas', 10, now), null);
    assert.equal(parseReminderTime('terminar 3 pendientes', null, now), null);
    assert.equal(parseReminderTime('el viernes a las 9am', null, now), null);
});

test('Horas inválidas se rechazan; hoy vencido no se mueve a mañana', () => {
    const now = new Date(2026, 9, 9, 12, 0).getTime();
    for (const time of ['a las 24:00', 'mañana a las 0am', '13pm', 'a las 12:60', 'hoy a las 8am']) {
        assert.equal(parseReminderTime(time, null, now), null);
    }
    const next = new Date(now); next.setDate(next.getDate() + 1); next.setHours(8, 0, 0, 0);
    assert.equal(parseReminderTime(next.toISOString(), null, now).dueAt, next.getTime());
});

test('Aclaración incluye solo campos pendientes y no un plazo inventado', () => {
    const noTime = prepareReminder({ mensaje: 'Comprar pan' }, {});
    assert.deepEqual(noTime.missing_fields, ['tiempo']);
    const noBoth = prepareReminder({}, {});
    assert.deepEqual(noBoth.missing_fields, ['mensaje', 'tiempo']);
});
