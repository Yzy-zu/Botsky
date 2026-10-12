'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/services/db');
const history = require('../src/services/history');

test('SQLite: WAL mode y pragmas de rendimiento activos', (t, done) => {
    db.db.get('PRAGMA journal_mode;', (err, row) => {
        assert.ifError(err);
        assert.strictEqual(row.journal_mode.toLowerCase(), 'wal', 'Debe estar en modo WAL');
        done();
    });
});

test('SQLite: chat_history guarda y recupera mensajes cronológicamente', async () => {
    const testChat = 'test_persistence_chat_' + Date.now();

    await db.saveChatMessage(testChat, 'user', 'Primer mensaje', 'Usuario 1', 1000);
    await db.saveChatMessage(testChat, 'assistant', 'Respuesta 1', 'Botsky', 2000);
    await db.saveChatMessage(testChat, 'user', 'Segundo mensaje', 'Usuario 1', 3000);

    const messages = await db.getRecentChatMessages(testChat, 10);
    assert.strictEqual(messages.length, 3);
    assert.strictEqual(messages[0].content, 'Primer mensaje');
    assert.strictEqual(messages[1].content, 'Respuesta 1');
    assert.strictEqual(messages[2].content, 'Segundo mensaje');

    // Limpiar
    await db.clearChatHistory(testChat);
    const afterClear = await db.getRecentChatMessages(testChat, 10);
    assert.strictEqual(afterClear.length, 0);
});

test('History: addMessage persiste a SQLite y clearHistory limpia ambos', async () => {
    const testChat = 'test_hist_sync_' + Date.now();

    history.addMessage(testChat, 'user', 'Mensaje de prueba para sync', 'Tester');

    // Comprobar memoria inmediata
    const memHist = history.getHistory(testChat);
    assert.strictEqual(memHist.length, 1);
    assert.ok(memHist[0].content.includes('Mensaje de prueba para sync'));

    // Esperar 100ms para escritura en SQLite
    await new Promise(r => setTimeout(r, 100));

    const dbRows = await db.getRecentChatMessages(testChat, 5);
    assert.strictEqual(dbRows.length, 1);
    assert.strictEqual(dbRows[0].content, 'Mensaje de prueba para sync');

    // Limpiar
    history.clearHistory(testChat);
    assert.strictEqual(history.getHistory(testChat).length, 0);

    await new Promise(r => setTimeout(r, 100));
    const dbRowsAfter = await db.getRecentChatMessages(testChat, 5);
    assert.strictEqual(dbRowsAfter.length, 0);
});
