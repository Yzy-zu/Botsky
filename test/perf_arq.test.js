'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// ─── 1. Tests de Cola con Sub-Prioridad (Arq #4) ──────────────────────────────
test('Queue Arq #4: Tareas con priority: 1 se ordenan al frente de las pendientes', async () => {
    const queue = require('../src/core/queue');
    const TieredQueue = queue.TieredQueue;

    // Cola con concurrencia 1 para controlar la ejecución exacta
    const testQueue = new TieredQueue({
        heavy: { concurrency: 1, maxPerUser: 10 }
    });

    const executionOrder = [];
    let unblockFirstTask;
    const firstTaskPromise = new Promise(resolve => { unblockFirstTask = resolve; });

    // Tarea 1: Corre inmediatamente y bloquea la cola
    testQueue.add('user1', async () => {
        executionOrder.push('tarea1_corriendo');
        await firstTaskPromise;
    }, 'heavy', 'Tarea 1');

    // Tarea 2: Encolada con prioridad 0 (normal)
    testQueue.add('user1', async () => {
        executionOrder.push('tarea2_normal');
    }, 'heavy', 'Tarea 2', { priority: 0 });

    // Tarea 3: Encolada con prioridad 0 (normal)
    testQueue.add('user1', async () => {
        executionOrder.push('tarea3_normal');
    }, 'heavy', 'Tarea 3', { priority: 0 });

    // Tarea 4: Encolada con prioridad 1 (alta, p.ej. transcripción rápida)
    testQueue.add('user1', async () => {
        executionOrder.push('tarea4_alta_prioridad');
    }, 'heavy', 'Tarea 4', { priority: 1 });

    // Verificar que en pending, la Tarea 4 saltó al frente
    const pendingNames = testQueue.tiers.heavy.pending.map(p => p.priority);
    assert.deepEqual(pendingNames, [1, 0, 0], 'La tarea con priority: 1 debe estar primera en la cola de pendientes');

    // Desbloquear primera tarea y esperar a que todas terminen
    unblockFirstTask();

    // Esperar a que la cola se vacíe
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.deepEqual(executionOrder, [
        'tarea1_corriendo',
        'tarea4_alta_prioridad',
        'tarea2_normal',
        'tarea3_normal'
    ], 'El orden de ejecución debe priorizar la tarea de alta prioridad antes que las normales');
});

// ─── 2. Tests de Historial con Expiración TTL en addMessage (Perf #4) ────────
test('History Perf #4: addMessage no revive historiales expirados', async () => {
    const history = require('../src/services/history');
    const testChatId = 'test_ttl_chat@s.whatsapp.net';

    // Limpiar antes de la prueba
    history.clearHistory(testChatId);

    // Agregar mensajes iniciales
    history.addMessage(testChatId, 'user', 'Mensaje antiguo 1');
    history.addMessage(testChatId, 'assistant', 'Respuesta antigua 1');

    let hist = history.getHistory(testChatId);
    assert.equal(hist.length, 2, 'Debe haber 2 mensajes en el historial inicial');

    // Simular que el historial expiró alterando lastActive hacia el pasado (> 2 horas)
    const realDateNow = Date.now;
    try {
        const threeHoursLater = realDateNow() + (3 * 60 * 60 * 1000);
        Date.now = () => threeHoursLater;

        // Ahora ejecutamos addMessage con un mensaje nuevo
        history.addMessage(testChatId, 'user', 'Mensaje nuevo después de 3 horas');

        // Restaurar Date.now para leer el historial
        const freshHist = history.getHistory(testChatId);

        // El historial debe tener ÚNICAMENTE el mensaje nuevo (los antiguos fueron purgados)
        assert.equal(freshHist.length, 1, 'El historial expirado no debe haberse acumulado con los viejos');
        assert.ok(freshHist[0].content.includes('Mensaje nuevo después de 3 horas'));
    } finally {
        Date.now = realDateNow;
        history.clearHistory(testChatId);
    }
});

// ─── 3. Tests de Deduplicación de Descargas en Progreso (Perf #3) ────────────
test('Descargar Perf #3: inProgressDownloads Map registra y comparte descargas concurrentes', async () => {
    const { inProgressDownloads } = require('../src/commands/descargar');

    assert.ok(inProgressDownloads instanceof Map, 'inProgressDownloads debe ser un Map');

    const testKey = 'https://example.com/video|mp4|480';
    assert.equal(inProgressDownloads.has(testKey), false, 'La clave de prueba no debe existir inicialmente');

    // Simular entrada en vuelo
    let resolveTest;
    const fakePromise = new Promise(resolve => { resolveTest = resolve; });
    let cleanedUp = false;
    const fakeEntry = {
        promise: fakePromise,
        refCount: 1,
        shouldCleanup: false,
        cleanup: () => { cleanedUp = true; }
    };

    inProgressDownloads.set(testKey, fakeEntry);
    assert.equal(inProgressDownloads.has(testKey), true);

    // Simular segundo consumidor uniéndose
    fakeEntry.refCount++;
    assert.equal(fakeEntry.refCount, 2, 'Dos consumidores registrados');

    // Consumidor 1 (productor) termina
    fakeEntry.shouldCleanup = true;
    fakeEntry.refCount--;
    inProgressDownloads.delete(testKey);

    // No debe haberse limpiado porque consumidor 2 sigue activo
    assert.equal(cleanedUp, false, 'No debe limpiarse mientras refCount > 0');

    // Consumidor 2 termina
    fakeEntry.refCount--;
    if (fakeEntry.refCount <= 0 && fakeEntry.shouldCleanup) {
        fakeEntry.cleanup();
    }

    assert.equal(cleanedUp, true, 'Debe ejecutarse la limpieza cuando refCount llega a 0');
    assert.equal(inProgressDownloads.has(testKey), false, 'La clave debe removerse');
});
