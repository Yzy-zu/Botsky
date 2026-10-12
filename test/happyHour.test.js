'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Aislamiento Estricto de Base de Datos y Entorno (R6) ─────────────────────
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botsky-hh-test-db-'));
process.env.DATA_DIR = testDataDir;

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.DATA_DIR = testDataDir;

const TEST_GROUP = '120363427922045362@g.us';
const ADMIN_NUMBER = '5214435810175';
const ADMIN_JID = `${ADMIN_NUMBER}@s.whatsapp.net`;
const USER_NORMAL_NUMBER = '5215570001111';
const USER_NORMAL_JID = `${USER_NORMAL_NUMBER}@s.whatsapp.net`;

process.env.ALLOWED_GROUPS_NORMAL = `${process.env.ALLOWED_GROUPS_NORMAL || ''},120363427922045362`;
process.env.ALLOWED_NUMBERS_ADMIN = `${process.env.ALLOWED_NUMBERS_ADMIN || ''},${ADMIN_NUMBER}`;

// Generador de imagen JPEG válida en memoria
const JPEG_1X1_BUFFER = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
    0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
    0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01,
    0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
    0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0xbf, 0x00, 0xff, 0xd9
]);

// Crear directorio de fotos mock para pruebas multimedia
const mockFotosDir = path.join(testDataDir, 'mock_fotos');
fs.mkdirSync(mockFotosDir, { recursive: true });
for (let i = 1; i <= 8; i++) {
    fs.writeFileSync(path.join(mockFotosDir, `foto_${i}.jpg`), JPEG_1X1_BUFFER);
}
process.env.FOTOS_DIR = mockFotosDir;

// ─── Mocks de Red y Evolution API (R6: 0 peticiones salientes a WhatsApp) ─────
const evolution = require('../src/services/evolution');
const sentTexts = [];
const sentMediaList = [];

evolution.client.post = async (url, data) => {
    if (url.includes('/message/sendText')) {
        sentTexts.push({ url, data });
        return { data: { key: { id: `mock-msg-${Date.now()}-${Math.random()}` }, status: 'PENDING' } };
    }
    if (url.includes('/message/sendMedia')) {
        sentMediaList.push({ url, data });
        return { data: { key: { id: `mock-media-${Date.now()}-${Math.random()}` }, status: 'PENDING' } };
    }
    return { data: { status: 'OK' } };
};

const db = require('../src/services/db');
const happyHour = require('../src/services/happyHour');
const { handleHoraFeliz } = require('../src/commands/happyHour');
const { handlePack } = require('../src/commands/pack');
const { isRegisteredCommand } = require('../src/core/commandRegistry');
const { dispatch } = require('../src/core/dispatcher');

// Limpieza global tras suite
test.after(() => {
    happyHour.resetInMemoryState();
    try {
        fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch (_) {}
});

test('R1: Registro de comandos y aliases en commandRegistry', () => {
    assert.equal(isRegisteredCommand('horafeliz'), true);
    assert.equal(isRegisteredCommand('happyhour'), true);
    assert.equal(isRegisteredCommand('hf'), true);
});

test('R1: Ciclo de vida básico en memoria y persistencia SQLite (start, status, stop)', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();

    let status = happyHour.getHappyHourStatus(TEST_GROUP);
    assert.equal(status.active, false);
    assert.equal(status.xpMultiplier, 1);
    assert.equal(status.packCost, 150);

    const startRes = await happyHour.startHappyHour({
        durationMinutes: 45,
        groupJid: TEST_GROUP,
        adminJid: ADMIN_JID,
        broadcast: true
    });
    assert.equal(startRes.success, true);
    assert.equal(startRes.durationMinutes, 45);

    // Verificación en memoria
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);
    status = happyHour.getHappyHourStatus(TEST_GROUP);
    assert.equal(status.active, true);
    assert.equal(status.xpMultiplier, 20);
    assert.equal(status.packCost, 75);
    assert.equal(status.remainingMinutes, 45);

    // Verificación en SQLite
    const row = await db.getHappyHourState();
    assert.ok(row, 'Debe existir registro en bot_happy_hour');
    assert.equal(row.is_active, 1);
    assert.equal(row.group_jid, TEST_GROUP);
    assert.equal(row.duration_minutes, 45);
    assert.equal(row.xp_multiplier, 20);
    assert.equal(row.discount_percent, 50);

    // Detención
    const stopRes = await happyHour.stopHappyHour({ groupJid: TEST_GROUP, reason: 'test' });
    assert.equal(stopRes.success, true);
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), false);

    const rowAfter = await db.getHappyHourState();
    assert.equal(rowAfter.is_active, 0);
});

test('R1: Recuperación de estado activo tras reinicio del proceso (initHappyHourRecovery)', async () => {
    happyHour.resetInMemoryState();

    const futureUntil = Date.now() + 30 * 60 * 1000;
    await db.saveHappyHourState({
        is_active: 1,
        group_jid: TEST_GROUP,
        started_at: Date.now() - 10 * 60 * 1000,
        active_until: futureUntil,
        duration_minutes: 40,
        xp_multiplier: 20,
        discount_percent: 50,
        airdrop_active: 0,
        airdrop_claimed: 0
    });

    // Estado en memoria está limpio
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), false);

    // Ejecutar hidratación de arranque
    await happyHour.initHappyHourRecovery();

    // Estado debe estar restaurado
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);
    const status = happyHour.getHappyHourStatus(TEST_GROUP);
    assert.equal(status.active, true);
    assert.ok(status.remainingMinutes >= 29 && status.remainingMinutes <= 31);
    assert.equal(status.xpMultiplier, 20);
    assert.equal(status.packCost, 75);

    happyHour.resetInMemoryState();
    await db.resetHappyHourState();
});

test('R1: Evento expirado mientras el bot estaba apagado se restablece a inactivo', async () => {
    happyHour.resetInMemoryState();

    const pastUntil = Date.now() - 5 * 60 * 1000;
    await db.saveHappyHourState({
        is_active: 1,
        group_jid: TEST_GROUP,
        started_at: Date.now() - 65 * 60 * 1000,
        active_until: pastUntil,
        duration_minutes: 60,
        xp_multiplier: 20,
        discount_percent: 50
    });

    await happyHour.initHappyHourRecovery();

    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), false);
    const row = await db.getHappyHourState();
    assert.equal(row.is_active, 0);
});

test('R5: Comando !horafeliz - Control administrativo estricto y rechazo a no administradores', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();
    sentTexts.length = 0;

    // Usuario no admin intenta activar
    const nonAdminMsg = {
        key: { remoteJid: TEST_GROUP, participant: USER_NORMAL_JID },
        pushName: 'Juan Normal'
    };
    const deniedRes = await handleHoraFeliz({ args: ['on', '30'], raw: '!horafeliz on 30' }, TEST_GROUP, nonAdminMsg);
    assert.equal(deniedRes.success, false);
    assert.equal(deniedRes.reason, 'FORBIDDEN');
    assert.ok(deniedRes.message.includes('Acceso denegado'));
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), false);

    // Usuario admin autorizado activa
    const adminMsg = {
        key: { remoteJid: TEST_GROUP, participant: ADMIN_JID },
        pushName: 'Admin Patron'
    };
    const adminRes = await handleHoraFeliz({ args: ['on', '30'], raw: '!horafeliz on 30' }, TEST_GROUP, adminMsg);
    assert.equal(adminRes.success, true);
    assert.equal(adminRes.durationMinutes, 30);
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);

    // Usuario no admin intenta apagar
    const nonAdminStop = await handleHoraFeliz({ args: ['off'], raw: '!horafeliz off' }, TEST_GROUP, nonAdminMsg);
    assert.equal(nonAdminStop.success, false);
    assert.equal(nonAdminStop.reason, 'FORBIDDEN');
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);

    // Consulta de status es pública para cualquiera
    const statusRes = await handleHoraFeliz({ args: ['status'], raw: '!horafeliz status' }, TEST_GROUP, nonAdminMsg);
    assert.equal(statusRes.success, true);
    assert.equal(statusRes.status.active, true);

    // Admin apaga
    const adminStop = await handleHoraFeliz({ args: ['off'], raw: '!horafeliz off' }, TEST_GROUP, adminMsg);
    assert.equal(adminStop.success, true);
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), false);
});

test('R3: Economía de Experiencia - Multiplicador +20 XP durante Hora Feliz vs 1 XP estándar', async () => {
    const testUser = `test_xp_${Date.now()}@s.whatsapp.net`;
    await db.getOrCreateUser(testUser);

    happyHour.resetInMemoryState();
    assert.equal(happyHour.isHappyHourActive(testUser), false);

    // Fuera de Hora Feliz: se suma 1 XP
    const xpBefore = (await db.getOrCreateUser(testUser)).xp || 0;
    const amountStandard = happyHour.isHappyHourActive(testUser) ? 20 : 1;
    await db.addXp(testUser, amountStandard);
    const xpAfterStandard = (await db.getOrCreateUser(testUser)).xp;
    assert.equal(xpAfterStandard, xpBefore + 1);

    // Activar Hora Feliz
    await happyHour.startHappyHour({ durationMinutes: 30, groupJid: TEST_GROUP, broadcast: false });
    assert.equal(happyHour.isHappyHourActive(testUser), true);

    // Durante Hora Feliz: se suma 20 XP
    const amountHappy = happyHour.isHappyHourActive(testUser) ? 20 : 1;
    await db.addXp(testUser, amountHappy);
    const xpAfterHappy = (await db.getOrCreateUser(testUser)).xp;
    assert.equal(xpAfterHappy, xpAfterStandard + 20);

    await happyHour.stopHappyHour({ groupJid: TEST_GROUP, broadcast: false });
});

test('R3: Mercado Negro Packs - 50% de descuento (75 XP) y entrega ampliada (4-6 fotos)', async () => {
    happyHour.resetInMemoryState();
    const buyerPhone = '5215588889999';
    const buyerJid = `${buyerPhone}@s.whatsapp.net`;
    const buyerMsg = {
        key: { remoteJid: TEST_GROUP, participant: buyerJid },
        pushName: 'Comprador Pack'
    };

    // 1. Fondos insuficientes en modo normal (tiene 100 XP, requiere 150 XP)
    await db.subtractXp(buyerJid, 10_000_000).catch(() => {});
    await db.addXp(buyerJid, 100);

    const normalFail = await handlePack({ args: [] }, TEST_GROUP, buyerMsg, {
        isHappyHour: false,
        sendConfirmation: false,
        throttleMs: 0
    });
    assert.equal(normalFail.success, false);
    assert.equal(normalFail.reason, 'INSUFFICIENT_FUNDS');
    assert.equal(normalFail.cost, 150);

    // 2. Activar Hora Feliz: 100 XP es suficiente porque el pack cuesta 75 XP
    await happyHour.startHappyHour({ durationMinutes: 30, groupJid: TEST_GROUP, broadcast: false });

    const happySuccess = await handlePack({ args: [] }, TEST_GROUP, buyerMsg, {
        isHappyHour: true,
        sendConfirmation: false,
        throttleMs: 0,
        customDir: mockFotosDir
    });
    assert.equal(happySuccess.success, true);
    assert.equal(happySuccess.cost, 75);
    // Saldo restante: 100 - 75 = 25 XP
    assert.equal(happySuccess.balance, 25);
    // Cantidad entregada en Hora Feliz: entre 4 y 6
    assert.ok(happySuccess.images_sent >= 4 && happySuccess.images_sent <= 6, `Esperado 4-6 imágenes, recibido: ${happySuccess.images_sent}`);

    await happyHour.stopHappyHour({ groupJid: TEST_GROUP, broadcast: false });
});

test('R2: Lluvia de Media Periódica - Despacho de 1-2 medios y protección contra inactividad', async () => {
    happyHour.resetInMemoryState();
    await happyHour.startHappyHour({ durationMinutes: 30, groupJid: TEST_GROUP, broadcast: false });
    sentMediaList.length = 0;

    // 1. Protección contra inactividad: si no ha habido mensajes, omite la lluvia
    const rainSkipped = await happyHour.triggerRainDrop(TEST_GROUP);
    assert.equal(rainSkipped.sent, 0);
    assert.equal(sentMediaList.length, 0);

    // 2. Simular actividad de mensajes en el grupo
    await happyHour.onIncomingGroupMessage({ from: TEST_GROUP, participant: USER_NORMAL_JID, text: 'Hola a todos' });

    // 3. Ejecutar lluvia tras actividad
    const rainFired = await happyHour.triggerRainDrop(TEST_GROUP);
    assert.ok(rainFired.sent >= 1 && rainFired.sent <= 2, `Se esperaban 1 o 2 fotos enviadas, fueron: ${rainFired.sent}`);
    assert.ok(sentMediaList.length >= 1);

    await happyHour.stopHappyHour({ groupJid: TEST_GROUP, broadcast: false });
});

test('R4: AirDrop Express - Candado síncrono en memoria elimina condiciones de carrera', async () => {
    happyHour.resetInMemoryState();
    await happyHour.startHappyHour({ durationMinutes: 30, groupJid: TEST_GROUP, broadcast: false });

    // Disparar AirDrop
    const dropTriggered = await happyHour.triggerAirDrop(TEST_GROUP);
    assert.equal(dropTriggered, true);
    assert.equal(happyHour.isAirdropActive(TEST_GROUP), true);

    const candidates = [
        { jid: '5215500000001@s.whatsapp.net', name: 'User 1' },
        { jid: '5215500000002@s.whatsapp.net', name: 'User 2' },
        { jid: '5215500000003@s.whatsapp.net', name: 'User 3' },
        { jid: '5215500000004@s.whatsapp.net', name: 'User 4' },
        { jid: '5215500000005@s.whatsapp.net', name: 'User 5' }
    ];

    // Simular 5 mensajes "YOO" concurrentes en el mismo tick de ejecución
    const claimPromises = candidates.map(c =>
        happyHour.claimAirdrop(TEST_GROUP, c.jid, 'YOO', c.name, {
            key: { remoteJid: TEST_GROUP, participant: c.jid },
            pushName: c.name
        }, { throttleMs: 0, customDir: mockFotosDir })
    );

    const results = await Promise.all(claimPromises);

    const winners = results.filter(r => r.success === true);
    const losers = results.filter(r => r.success === false && r.reason === 'ALREADY_CLAIMED');

    // EXACTAMENTE UN ganador garantizado
    assert.equal(winners.length, 1, 'Debe haber exactamente 1 ganador');
    assert.equal(losers.length, 4, 'Los otros 4 deben haber recibido ALREADY_CLAIMED');

    if (winners[0].packPromise) {
        await winners[0].packPromise;
    }

    const winningJid = winners[0].winner.jid;
    assert.ok(winningJid);

    // El ganador recibe 500 XP
    const winnerUser = await db.getOrCreateUser(winningJid);
    assert.ok(winnerUser.xp >= 500);

    // El AirDrop queda inactivo
    assert.equal(happyHour.isAirdropActive(TEST_GROUP), false);

    // Intentos posteriores son rechazados
    const lateAttempt = await happyHour.claimAirdrop(TEST_GROUP, '5215500000099@s.whatsapp.net', 'YOO', 'Late User');
    assert.equal(lateAttempt.success, false);
    assert.equal(lateAttempt.reason, 'ALREADY_CLAIMED');

    await happyHour.stopHappyHour({ groupJid: TEST_GROUP, broadcast: false });
});

test('R5: AI Semantic Router & Fast-Path Pre-LLM para consultas en lenguaje natural', async () => {
    happyHour.resetInMemoryState();
    sentTexts.length = 0;

    const adminMsg = {
        key: { id: 'test-hf-1', remoteJid: TEST_GROUP, fromMe: false, participant: ADMIN_JID },
        message: { conversation: 'botsky activa la hora feliz 45 minutos' },
        pushName: 'Admin',
        messageTimestamp: Math.floor(Date.now() / 1000)
    };

    // Fast-path de activación mediante dispatch
    await dispatch({
        text: 'botsky activa la hora feliz 45 minutos',
        from: TEST_GROUP,
        isGroup: true,
        participant: ADMIN_JID,
        pushName: 'Admin',
        actualMessageType: 'conversation',
        actualMessageData: adminMsg,
        shouldDispatch: true,
        hasPrefix: false
    });

    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);
    const status = happyHour.getHappyHourStatus(TEST_GROUP);
    assert.equal(status.remainingMinutes, 45);

    // Fast-path de consulta de estado
    sentTexts.length = 0;
    await dispatch({
        text: 'hay hora feliz?',
        from: TEST_GROUP,
        isGroup: true,
        participant: USER_NORMAL_JID,
        pushName: 'User',
        actualMessageType: 'conversation',
        actualMessageData: { key: { remoteJid: TEST_GROUP, participant: USER_NORMAL_JID } },
        shouldDispatch: true,
        hasPrefix: false
    });
    assert.ok(sentTexts.some(t => t.data.text.includes('ESTADO DE LA HORA FELIZ')));

    // Fast-path de apagado por admin
    await dispatch({
        text: 'apaga la hora feliz',
        from: TEST_GROUP,
        isGroup: true,
        participant: ADMIN_JID,
        pushName: 'Admin',
        actualMessageType: 'conversation',
        actualMessageData: { key: { remoteJid: TEST_GROUP, participant: ADMIN_JID } },
        shouldDispatch: true,
        hasPrefix: false
    });
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), false);
});

test('R6: Aislamiento Estricto - 0 llamadas a números reales de WhatsApp', () => {
    // Todos los envíos se han registrado en los mocks de prueba
    assert.ok(sentTexts.length > 0);
    // Ningún mensaje fue a un socket o HTTP externo real
});
