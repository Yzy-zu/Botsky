'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../src/services/db');
const { parseReminderTime, formatTimeDiff } = require('../src/commands/recordatorios');
const { isRegisteredCommand } = require('../src/core/commandRegistry');

test('Recordatorios: admite duraciones CLI y minutos canónicos del modelo sin inventar fechas', () => {
    const res15m = parseReminderTime('15m');
    assert.ok(res15m);
    assert.ok(res15m.dueAt > Date.now());
    assert.strictEqual(res15m.timeDesc, '15m');

    const res2h = parseReminderTime(null, 120);
    assert.ok(res2h);
    assert.ok(res2h.dueAt > Date.now());
    assert.strictEqual(res2h.timeDesc, '2h');

    const resSecs = parseReminderTime('45s');
    assert.ok(resSecs);
    assert.ok(resSecs.dueAt > Date.now());
    assert.strictEqual(resSecs.timeDesc, '45s');
    assert.equal(parseReminderTime('en 2 horas'), null);
    assert.equal(parseReminderTime('45 segundos'), null);
});

test('Recordatorios: parseReminderTime prioriza minutesHint de Gemini', () => {
    const resHint = parseReminderTime(null, 30);
    assert.ok(resHint);
    assert.ok(resHint.dueAt > Date.now());
    assert.strictEqual(resHint.timeDesc, '30m');
});

test('Recordatorios: parseReminderTime devuelve null para expresiones inválidas', () => {
    assert.strictEqual(parseReminderTime('texto sin tiempo'), null);
    assert.strictEqual(parseReminderTime(''), null);
    assert.strictEqual(parseReminderTime(null), null);
});

test('Recordatorios: formatTimeDiff formatea lapsos de tiempo correctamente', () => {
    assert.strictEqual(formatTimeDiff(60 * 1000), '1m');
    assert.strictEqual(formatTimeDiff(3600 * 1000), '1h');
    assert.strictEqual(formatTimeDiff(7200 * 1000), '2h');
    assert.strictEqual(formatTimeDiff(15 * 1000), '15s');
});

test('Recordatorios: ciclo completo en base de datos SQLite (crear, consultar, entregar, cancelar)', async () => {
    const targetJid = 'test_group@g.us';
    const senderJid = '123456789@s.whatsapp.net';
    const senderName = 'Tester';
    const text = 'Sacar la pizza del horno';
    const dueAt = Date.now() + 60000; // 1 minuto en el futuro

    // 1. Crear recordatorio
    const newRem = await db.addReminder(targetJid, senderJid, senderName, text, dueAt);
    assert.ok(newRem.id);
    assert.strictEqual(newRem.status, 'pending');
    assert.strictEqual(newRem.reminderText, text);

    // 2. Consultar pendientes del usuario
    const pendingList = await db.getUserPendingReminders(targetJid, senderJid);
    assert.ok(pendingList.some(r => r.id === newRem.id && r.status === 'pending'));

    // 3. Crear recordatorio vencido y verificar getDueReminders
    const pastDue = Date.now() - 5000;
    const pastRem = await db.addReminder(targetJid, senderJid, senderName, 'Recordatorio pasado', pastDue);
    const dueList = await db.getDueReminders(Date.now());
    assert.ok(dueList.some(r => r.id === pastRem.id));

    // 4. Marcar como entregado
    const marked = await db.markReminderDelivered(pastRem.id);
    assert.strictEqual(marked, true);

    const dueListAfter = await db.getDueReminders(Date.now());
    assert.ok(!dueListAfter.some(r => r.id === pastRem.id));

    // 5. Cancelar recordatorio
    const cancelled = await db.cancelReminder(newRem.id, senderJid, false);
    assert.strictEqual(cancelled, true);

    const pendingAfter = await db.getUserPendingReminders(targetJid, senderJid);
    assert.ok(!pendingAfter.some(r => r.id === newRem.id));
});

test('Recordatorios: commandRegistry reconoce los aliases de recordatorio', () => {
    assert.strictEqual(isRegisteredCommand('recordar'), true);
    assert.strictEqual(isRegisteredCommand('recuerdame'), true);
    assert.strictEqual(isRegisteredCommand('recordatorio'), true);
    assert.strictEqual(isRegisteredCommand('recordatorios'), true);
    assert.strictEqual(isRegisteredCommand('alarma'), true);
    assert.strictEqual(isRegisteredCommand('remind'), true);
});
