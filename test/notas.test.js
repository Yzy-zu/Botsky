'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../src/services/db');
const evolution = require('../src/services/evolution');
const { handleNotas, formatNoteDate } = require('../src/commands/notas');
const { isRegisteredCommand } = require('../src/core/commandRegistry');

test('Notas: formatNoteDate formatea fechas correctamente', () => {
    const formatted = formatNoteDate(new Date('2026-09-21T18:30:00Z').getTime());
    assert.ok(typeof formatted === 'string');
    assert.ok(formatted.length > 0);
});

test('Notas: ciclo de base de datos SQLite (guardar, listar, buscar, borrar)', async () => {
    const testChat = `test_notes_chat_${Date.now()}@g.us`;
    const userJid = '5215512345678@s.whatsapp.net';
    const userName = 'Lisandro';

    // 1. Guardar notas
    const n1 = await db.addNote(testChat, userJid, userName, 'Comprar chelas y hielo para el sábado');
    const n2 = await db.addNote(testChat, userJid, userName, 'Contraseña de la wifi: 12345678');
    assert.ok(n1.id);
    assert.ok(n2.id);

    // 2. Listar notas del chat
    const list = await db.getNotes(testChat, 10);
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].id, n1.id);
    assert.strictEqual(list[1].id, n2.id);

    // 3. Buscar notas por palabra clave
    const searchRes = await db.searchNotes(testChat, 'chelas');
    assert.strictEqual(searchRes.length, 1);
    assert.ok(searchRes[0].content.includes('chelas'));

    const searchNone = await db.searchNotes(testChat, 'palabra_inexistente_xyz');
    assert.strictEqual(searchNone.length, 0);

    // 4. Borrar nota
    const deleted = await db.deleteNote(testChat, n1.id);
    assert.ok(deleted);
    assert.strictEqual(deleted.id, n1.id);

    // Verificar que solo queda 1
    const listAfter = await db.getNotes(testChat, 10);
    assert.strictEqual(listAfter.length, 1);
    assert.strictEqual(listAfter[0].id, n2.id);

    // Borrar restante
    await db.deleteNote(testChat, n2.id);
});

test('Notas: handleNotas maneja guardar, listar, buscar y borrar en chat', async () => {
    const testChat = `test_handler_chat_${Date.now()}@g.us`;
    const userJid = '5215598765432@s.whatsapp.net';
    const userName = 'Pedro';

    const sentMessages = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push(data.text);
        }
        return { data: { status: 'SUCCESS' } };
    };

    try {
        // 1. Guardar vía comando
        await handleNotas(
            { args: ['guardar', 'Revisar', 'la', 'bomba', 'de', 'agua'] },
            testChat,
            { key: { participant: userJid }, pushName: userName }
        );
        assert.ok(sentMessages.length > 0);
        assert.ok( /guardé la nota \*#\d+\*/i.test(sentMessages[0]));
        assert.ok(sentMessages[0].includes('Revisar la bomba de agua'));

        // 2. Listar notas
        sentMessages.length = 0;
        await handleNotas(
            { args: ['listar'] },
            testChat,
            { key: { participant: userJid }, pushName: userName }
        );
        assert.ok(sentMessages.length > 0);
        assert.ok(sentMessages[0].includes('Notas del chat'));
        assert.ok(sentMessages[0].includes('Revisar la bomba de agua'));

        // 3. Buscar notas
        sentMessages.length = 0;
        await handleNotas(
            { args: ['buscar', 'bomba'] },
            testChat,
            { key: { participant: userJid }, pushName: userName }
        );
        assert.ok(sentMessages.length > 0);
        assert.ok(sentMessages[0].includes('Esto encontré'));
        assert.ok(sentMessages[0].includes('bomba'));

        // 4. Borrar nota
        // Extraer id de la nota
        const notes = await db.getNotes(testChat, 1);
        const noteId = notes[0].id;

        sentMessages.length = 0;
        await handleNotas(
            { args: ['borrar', String(noteId)] },
            testChat,
            { key: { participant: userJid }, pushName: userName }
        );
        assert.ok(sentMessages.length > 0);
        assert.ok(sentMessages[0].includes(`borré la nota *#${noteId}*`));
        assert.deepEqual(await db.getNotes(testChat), []);
    } finally {
        evolution.client.post = origPost;
    }
});

test('Notas: commandRegistry reconoce los aliases de notas', () => {
    assert.strictEqual(isRegisteredCommand('notas'), true);
    assert.strictEqual(isRegisteredCommand('nota'), true);
    assert.strictEqual(isRegisteredCommand('apunte'), true);
    assert.strictEqual(isRegisteredCommand('apuntes'), true);
    assert.strictEqual(isRegisteredCommand('tablon'), true);
});
