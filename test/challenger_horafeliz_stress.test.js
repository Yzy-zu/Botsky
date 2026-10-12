'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Aislamiento Estricto de Base de Datos y Entorno (R6) ─────────────────────
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botsky-challenger-stress-db-'));
process.env.DATA_DIR = testDataDir;

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.DATA_DIR = testDataDir;

const TEST_GROUP = '120363427922045362@g.us';
const OTHER_GROUP = '120363999999999999@g.us';
const ADMIN_NUMBER = '5214435810175';
const ADMIN_JID = `${ADMIN_NUMBER}@s.whatsapp.net`;

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

const mockFotosDir = path.join(testDataDir, 'mock_fotos');
fs.mkdirSync(mockFotosDir, { recursive: true });
for (let i = 1; i <= 10; i++) {
    fs.writeFileSync(path.join(mockFotosDir, `foto_${i}.jpg`), JPEG_1X1_BUFFER);
}
process.env.FOTOS_DIR = mockFotosDir;

// Mocks de Red y Evolution API (R6)
const evolution = require('../src/services/evolution');
const sentTexts = [];
const sentMediaList = [];

evolution.client.post = async (url, data) => {
    if (url.includes('/message/sendText')) {
        sentTexts.push({ url, data, time: Date.now() });
        return { data: { key: { id: `mock-msg-${Date.now()}-${Math.random()}` }, status: 'PENDING' } };
    }
    if (url.includes('/message/sendMedia')) {
        sentMediaList.push({ url, data, time: Date.now() });
        return { data: { key: { id: `mock-media-${Date.now()}-${Math.random()}` }, status: 'PENDING' } };
    }
    return { data: { status: 'OK' } };
};

const db = require('../src/services/db');
const happyHour = require('../src/services/happyHour');
const { handlePack } = require('../src/commands/pack');

test.after(() => {
    happyHour.resetInMemoryState();
    try {
        fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch (_) {}
});

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 1: AIRDROP CONCURRENCY STRESS TESTING
// ══════════════════════════════════════════════════════════════════════════════

test('CHALLENGE 1.1: 15 concurrent participants calling claimAirdrop simultaneously in exact same event loop tick', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();
    sentTexts.length = 0;
    sentMediaList.length = 0;

    await happyHour.startHappyHour({ durationMinutes: 60, groupJid: TEST_GROUP, broadcast: false });
    await happyHour.triggerAirDrop(TEST_GROUP);
    assert.equal(happyHour.isAirdropActive(TEST_GROUP), true);

    const PARTICIPANT_COUNT = 15;
    const participants = [];
    for (let i = 1; i <= PARTICIPANT_COUNT; i++) {
        const phone = `52155000000${String(i).padStart(2, '0')}`;
        const jid = `${phone}@s.whatsapp.net`;
        participants.push({
            jid,
            name: `Contender ${i}`,
            phone
        });
        // Registrar en BD con 0 XP inicial
        await db.getOrCreateUser(jid);
    }

    // Disparar las 15 llamadas simultáneamente en Promise.all
    const claimPromises = participants.map((p) =>
        happyHour.claimAirdrop(
            TEST_GROUP,
            p.jid,
            'YOO',
            p.name,
            { key: { remoteJid: TEST_GROUP, participant: p.jid }, participant: p.jid, pushName: p.name },
            { throttleMs: 0, customDir: mockFotosDir }
        )
    );

    const results = await Promise.all(claimPromises);

    const winners = results.filter((r) => r.success === true);
    const losers = results.filter((r) => r.success === false && r.reason === 'ALREADY_CLAIMED');

    // VERIFICACIÓN 1: Exactamente 1 ganador y 14 perdedores
    assert.equal(winners.length, 1, `Debe haber EXACTAMENTE 1 ganador, pero hubo ${winners.length}`);
    assert.equal(losers.length, PARTICIPANT_COUNT - 1, `Debe haber EXACTAMENTE ${PARTICIPANT_COUNT - 1} perdedores con ALREADY_CLAIMED`);

    const winnerObj = winners[0];
    const winningJid = winnerObj.winner.jid;
    assert.ok(winningJid);

    // Esperar pack gratuito del ganador
    if (winnerObj.packPromise) {
        await winnerObj.packPromise;
    }

    // VERIFICACIÓN 2: El ganador tiene +500 XP y todos los perdedores tienen 0 XP
    const winnerUser = await db.getOrCreateUser(winningJid);
    assert.equal(winnerUser.xp, 500, `El ganador debe tener exactamente 500 XP, tiene ${winnerUser.xp}`);

    for (const p of participants) {
        if (p.jid !== winningJid) {
            const loserUser = await db.getOrCreateUser(p.jid);
            assert.equal(loserUser.xp, 0, `El perdedor ${p.jid} debe tener 0 XP, tiene ${loserUser.xp}`);
        }
    }

    // VERIFICACIÓN 3: El ganador recibió fotos en View Once (4-6 fotos) y los perdedores 0
    const mediaToWinner = sentMediaList.filter((m) => m.data?.number === winnerObj.winner.jid || m.data?.options?.viewOnce === true);
    assert.ok(mediaToWinner.length >= 4 && mediaToWinner.length <= 6, `El ganador debió recibir 4-6 imágenes, recibió ${mediaToWinner.length}`);

    // VERIFICACIÓN 4: Estado persistido en SQLite refleja el ganador exacto
    const dbRow = await db.getHappyHourState();
    assert.equal(dbRow.airdrop_active, 0);
    assert.equal(dbRow.airdrop_claimed, 1);
    assert.equal(dbRow.airdrop_winner_jid, winningJid);

    // VERIFICACIÓN 5: Intento posterior (#16) falla con ALREADY_CLAIMED
    const lateClaim = await happyHour.claimAirdrop(TEST_GROUP, '5215599999999@s.whatsapp.net', 'YOO', 'Late Contender');
    assert.equal(lateClaim.success, false);
    assert.equal(lateClaim.reason, 'ALREADY_CLAIMED');

    await happyHour.stopHappyHour({ groupJid: TEST_GROUP, broadcast: false });
});

test('CHALLENGE 1.2: 50 concurrent participants calling claimAirdrop with extreme load', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();

    await happyHour.startHappyHour({ durationMinutes: 60, groupJid: TEST_GROUP, broadcast: false });
    await happyHour.triggerAirDrop(TEST_GROUP);
    assert.equal(happyHour.isAirdropActive(TEST_GROUP), true);

    const COUNT = 50;
    const promises = [];
    for (let i = 1; i <= COUNT; i++) {
        const jid = `52155100000${String(i).padStart(3, '0')}@s.whatsapp.net`;
        promises.push(
            happyHour.claimAirdrop(
                TEST_GROUP,
                jid,
                'YOO',
                `Contender ${i}`,
                { key: { remoteJid: TEST_GROUP, participant: jid }, participant: jid },
                { throttleMs: 0, customDir: mockFotosDir }
            )
        );
    }

    const results = await Promise.all(promises);
    const winners = results.filter((r) => r.success === true);
    const losers = results.filter((r) => r.success === false && r.reason === 'ALREADY_CLAIMED');

    assert.equal(winners.length, 1, 'Bajo 50 peticiones simultáneas debe haber EXACTAMENTE 1 ganador');
    assert.equal(losers.length, COUNT - 1, `Debe haber EXACTAMENTE ${COUNT - 1} ALREADY_CLAIMED`);

    if (winners[0].packPromise) {
        await winners[0].packPromise;
    }

    const dbRow = await db.getHappyHourState();
    assert.equal(dbRow.airdrop_claimed, 1);
    assert.equal(dbRow.airdrop_winner_jid, winners[0].winner.jid);

    await happyHour.stopHappyHour({ groupJid: TEST_GROUP, broadcast: false });
});

test('CHALLENGE 1.3: Asynchronous microtask/macrotask interleaving concurrency (queueMicrotask, setImmediate, setTimeout)', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();

    await happyHour.startHappyHour({ durationMinutes: 60, groupJid: TEST_GROUP, broadcast: false });
    await happyHour.triggerAirDrop(TEST_GROUP);

    const contenders = [
        { jid: '5215520000001@s.whatsapp.net', type: 'immediate' },
        { jid: '5215520000002@s.whatsapp.net', type: 'microtask' },
        { jid: '5215520000003@s.whatsapp.net', type: 'timeout0' },
        { jid: '5215520000004@s.whatsapp.net', type: 'direct' },
        { jid: '5215520000005@s.whatsapp.net', type: 'immediate' },
        { jid: '5215520000006@s.whatsapp.net', type: 'microtask' },
        { jid: '5215520000007@s.whatsapp.net', type: 'timeout0' },
        { jid: '5215520000008@s.whatsapp.net', type: 'direct' },
        { jid: '5215520000009@s.whatsapp.net', type: 'immediate' },
        { jid: '5215520000010@s.whatsapp.net', type: 'microtask' },
        { jid: '5215520000011@s.whatsapp.net', type: 'timeout0' },
        { jid: '5215520000012@s.whatsapp.net', type: 'direct' }
    ];

    const results = [];
    const dispatchPromises = contenders.map((c) => {
        return new Promise((resolve) => {
            const runner = async () => {
                const res = await happyHour.claimAirdrop(
                    TEST_GROUP,
                    c.jid,
                    'YOO',
                    c.jid,
                    { key: { remoteJid: TEST_GROUP, participant: c.jid }, participant: c.jid },
                    { throttleMs: 0, customDir: mockFotosDir }
                );
                results.push(res);
                if (res.packPromise) {
                    await res.packPromise;
                }
                resolve();
            };

            if (c.type === 'direct') {
                runner();
            } else if (c.type === 'microtask') {
                queueMicrotask(runner);
            } else if (c.type === 'immediate') {
                setImmediate(runner);
            } else if (c.type === 'timeout0') {
                setTimeout(runner, 0);
            }
        });
    });

    await Promise.all(dispatchPromises);

    const winners = results.filter((r) => r.success === true);
    const losers = results.filter((r) => r.success === false && r.reason === 'ALREADY_CLAIMED');

    assert.equal(winners.length, 1, 'Incluso con dispersión de timers y microtareas debe haber EXACTAMENTE 1 ganador');
    assert.equal(losers.length, contenders.length - 1);

    await happyHour.stopHappyHour({ groupJid: TEST_GROUP, broadcast: false });
});

test('CHALLENGE 1.4: Webhook fast-path pipeline simulation with 20 simultaneous "YOO" messages', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();

    await happyHour.startHappyHour({ durationMinutes: 60, groupJid: TEST_GROUP, broadcast: false });
    await happyHour.triggerAirDrop(TEST_GROUP);

    // Simular el fast-path exacto de server.js
    const simulateIncomingWebhook = async (norm) => {
        if (norm.isGroup) {
            happyHour.onIncomingGroupMessage(norm).catch(() => {});

            if (happyHour.isAirdropActive(norm.from)) {
                const cleanText = (norm.text || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                if (cleanText === 'yoo' || cleanText === '!yoo') {
                    return await happyHour.claimAirdrop(
                        norm.from,
                        norm.participant,
                        cleanText,
                        norm.pushName,
                        norm.actualMessageData,
                        { throttleMs: 0, customDir: mockFotosDir }
                    );
                }
            }
        }
        return { success: false, reason: 'IGNORED' };
    };

    const webhookMessages = [];
    const textVariants = ['YOO', 'yoo', 'Yoo', '  YOO  ', '!yoo', '!YOO', 'yOo'];
    for (let i = 1; i <= 20; i++) {
        const jid = `52155300000${String(i).padStart(2, '0')}@s.whatsapp.net`;
        webhookMessages.push({
            isGroup: true,
            from: TEST_GROUP,
            participant: jid,
            pushName: `WebhookUser ${i}`,
            text: textVariants[i % textVariants.length],
            actualMessageData: { key: { remoteJid: TEST_GROUP, participant: jid }, participant: jid }
        });
    }

    const outcomes = await Promise.all(webhookMessages.map((m) => simulateIncomingWebhook(m)));
    const winners = outcomes.filter((o) => o.success === true);
    const losers = outcomes.filter((o) => o.success === false && (o.reason === 'ALREADY_CLAIMED' || o.reason === 'IGNORED'));

    assert.equal(winners.length, 1, 'Exactamente 1 webhook debe reclamar el airdrop');
    assert.equal(losers.length, 19, 'Todos los demás 19 webhooks deben no reclamar el premio');

    if (winners[0].packPromise) {
        await winners[0].packPromise;
    }

    const winnerXp = (await db.getOrCreateUser(winners[0].winner.jid)).xp;
    assert.equal(winnerXp, 500);

    await happyHour.stopHappyHour({ groupJid: TEST_GROUP, broadcast: false });
});

test('CHALLENGE 1.5: AirDrop group isolation - claims from non-active group are rejected', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();

    // Iniciar Hora Feliz exclusivamente en TEST_GROUP
    await happyHour.startHappyHour({ durationMinutes: 60, groupJid: TEST_GROUP, broadcast: false });
    await happyHour.triggerAirDrop(TEST_GROUP);

    // Intento de reclamo desde OTHER_GROUP
    const foreignClaim = await happyHour.claimAirdrop(
        OTHER_GROUP,
        '5215540000001@s.whatsapp.net',
        'YOO',
        'Intruder',
        { key: { remoteJid: OTHER_GROUP, participant: '5215540000001@s.whatsapp.net' } }
    );

    assert.equal(foreignClaim.success, false);
    assert.equal(foreignClaim.reason, 'NOT_ACTIVE');

    // El airdrop en TEST_GROUP sigue intacto y activo
    assert.equal(happyHour.isAirdropActive(TEST_GROUP), true);

    await happyHour.stopHappyHour({ groupJid: TEST_GROUP, broadcast: false });
});

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 2: REBOOT PERSISTENCE & CRASH RECOVERY
// ══════════════════════════════════════════════════════════════════════════════

test('CHALLENGE 2.1: Crash recovery of active unexpired session restores state and full economic benefits', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();

    // 1. Iniciar sesión legítima de 60 minutos
    await happyHour.startHappyHour({ durationMinutes: 60, groupJid: TEST_GROUP, broadcast: false });
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);

    // 2. SIMULAR CRASH DEL SERVIDOR:
    // Destruir por completo la memoria RAM, variables y timers
    happyHour.resetInMemoryState();

    // Verificar que en RAM todo está muerto
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), false);
    let deadStatus = happyHour.getHappyHourStatus(TEST_GROUP);
    assert.equal(deadStatus.active, false);
    assert.equal(deadStatus.xpMultiplier, 1);
    assert.equal(deadStatus.packCost, 150);

    // 3. RECUPERACIÓN TRAS REINICIO
    await happyHour.initHappyHourRecovery();

    // 4. Verificar que el estado resucitó desde SQLite con parámetros correctos
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);
    const recoveredStatus = happyHour.getHappyHourStatus(TEST_GROUP);
    assert.equal(recoveredStatus.active, true);
    assert.ok(recoveredStatus.remainingMinutes >= 58 && recoveredStatus.remainingMinutes <= 60);
    assert.equal(recoveredStatus.xpMultiplier, 20);
    assert.equal(recoveredStatus.packCost, 75);
    assert.equal(recoveredStatus.groupJid, TEST_GROUP);

    // 5. Verificar que el impacto económico se mantiene tras el reinicio
    // Multiplicador de XP: +20 XP
    const testUser = `recovered_user_${Date.now()}@s.whatsapp.net`;
    const userBefore = await db.getOrCreateUser(testUser);
    const xpToAdd = happyHour.isHappyHourActive(testUser, TEST_GROUP) ? 20 : 1;
    assert.equal(xpToAdd, 20);
    await db.addXp(testUser, xpToAdd);
    const userAfter = await db.getOrCreateUser(testUser);
    assert.equal(userAfter.xp, (userBefore.xp || 0) + 20);

    // Descuento en packs: 75 XP
    await db.addXp(testUser, 100); // Tiene 120 XP (alcanza para 75 XP, no para 150 XP)
    const packRes = await handlePack({ args: [] }, TEST_GROUP, {
        key: { remoteJid: TEST_GROUP, participant: testUser },
        pushName: 'Recovered User'
    }, {
        isHappyHour: true,
        sendConfirmation: false,
        throttleMs: 0,
        customDir: mockFotosDir
    });
    assert.equal(packRes.success, true);
    assert.equal(packRes.cost, 75);
    assert.ok(packRes.images_sent >= 4 && packRes.images_sent <= 6);

    await happyHour.stopHappyHour({ groupJid: TEST_GROUP, broadcast: false });
});

test('CHALLENGE 2.2: Crash recovery preserves active unexpired AirDrop and allows valid claim post-reboot', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();

    await happyHour.startHappyHour({ durationMinutes: 45, groupJid: TEST_GROUP, broadcast: false });
    await happyHour.triggerAirDrop(TEST_GROUP);
    assert.equal(happyHour.isAirdropActive(TEST_GROUP), true);

    // Verificar que SQLite tiene airdrop_active = 1
    let row = await db.getHappyHourState();
    assert.equal(row.airdrop_active, 1);
    assert.equal(row.airdrop_claimed, 0);

    // CRASH: Borrar RAM
    happyHour.resetInMemoryState();
    assert.equal(happyHour.isAirdropActive(TEST_GROUP), false);

    // RECOVERY
    await happyHour.initHappyHourRecovery();

    // El airdrop debe estar activo de nuevo
    assert.equal(happyHour.isAirdropActive(TEST_GROUP), true);

    // 10 competidores intentan reclamar post-reboot
    const candidates = [];
    for (let i = 1; i <= 10; i++) {
        candidates.push({ jid: `52155600000${String(i).padStart(2, '0')}@s.whatsapp.net`, name: `PostBootContender ${i}` });
    }

    const postRebootClaims = await Promise.all(
        candidates.map((c) =>
            happyHour.claimAirdrop(
                TEST_GROUP,
                c.jid,
                'YOO',
                c.name,
                { key: { remoteJid: TEST_GROUP, participant: c.jid }, participant: c.jid },
                { throttleMs: 0, customDir: mockFotosDir }
            )
        )
    );

    const winners = postRebootClaims.filter((r) => r.success === true);
    const losers = postRebootClaims.filter((r) => r.success === false && r.reason === 'ALREADY_CLAIMED');

    assert.equal(winners.length, 1, 'Post-reboot exactamente 1 reclamo debe ganar');
    assert.equal(losers.length, 9);

    if (winners[0].packPromise) {
        await winners[0].packPromise;
    }

    // Ganador recibe 500 XP
    const winnerXp = (await db.getOrCreateUser(winners[0].winner.jid)).xp;
    assert.equal(winnerXp, 500);

    // Base de datos actualizada
    row = await db.getHappyHourState();
    assert.equal(row.airdrop_active, 0);
    assert.equal(row.airdrop_claimed, 1);
    assert.equal(row.airdrop_winner_jid, winners[0].winner.jid);

    await happyHour.stopHappyHour({ groupJid: TEST_GROUP, broadcast: false });
});

test('CHALLENGE 2.3: Crash recovery when AirDrop was ALREADY claimed prevents duplicate claiming', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();

    await happyHour.startHappyHour({ durationMinutes: 45, groupJid: TEST_GROUP, broadcast: false });
    await happyHour.triggerAirDrop(TEST_GROUP);

    const winnerJid = '5215570000001@s.whatsapp.net';
    const firstClaim = await happyHour.claimAirdrop(
        TEST_GROUP,
        winnerJid,
        'YOO',
        'Winner Pre-Crash',
        { key: { remoteJid: TEST_GROUP, participant: winnerJid }, participant: winnerJid },
        { throttleMs: 0, customDir: mockFotosDir }
    );
    assert.equal(firstClaim.success, true);
    if (firstClaim.packPromise) await firstClaim.packPromise;

    // CRASH
    happyHour.resetInMemoryState();

    // REBOOT & RECOVERY
    await happyHour.initHappyHourRecovery();

    // El evento sigue activo, pero el airdrop NO debe estar activo
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);
    assert.equal(happyHour.isAirdropActive(TEST_GROUP), false);

    // Intento de reclamo post-crash
    const secondClaim = await happyHour.claimAirdrop(
        TEST_GROUP,
        '5215570000002@s.whatsapp.net',
        'YOO',
        'Greedy User',
        { key: { remoteJid: TEST_GROUP, participant: '5215570000002@s.whatsapp.net' } }
    );
    assert.equal(secondClaim.success, false);
    assert.equal(secondClaim.reason, 'ALREADY_CLAIMED');

    await happyHour.stopHappyHour({ groupJid: TEST_GROUP, broadcast: false });
});

test('CHALLENGE 2.4: Reboot recovery after session expiration resets database and reverts economy to standard', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();

    // Insertar estado expirado en SQLite (expiró hace 10 minutos)
    const expiredUntil = Date.now() - 10 * 60 * 1000;
    await db.saveHappyHourState({
        is_active: 1,
        group_jid: TEST_GROUP,
        started_at: Date.now() - 70 * 60 * 1000,
        active_until: expiredUntil,
        duration_minutes: 60,
        xp_multiplier: 20,
        discount_percent: 50,
        airdrop_active: 0,
        airdrop_claimed: 0
    });

    // En memoria limpio
    happyHour.resetInMemoryState();

    // RECOVERY
    await happyHour.initHappyHourRecovery();

    // 1. Estado en memoria debe ser inactivo
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), false);

    // 2. Base de datos SQLite debe haberse reseteado a is_active = 0
    const dbRow = await db.getHappyHourState();
    assert.equal(dbRow.is_active, 0, 'La base de datos debe quedar con is_active = 0 tras detectar expiración');

    // 3. Status público reporta inactivo
    const status = happyHour.getHappyHourStatus(TEST_GROUP);
    assert.equal(status.active, false);
    assert.equal(status.xpMultiplier, 1);
    assert.equal(status.packCost, 150);

    // 4. Economía revertida
    const normalUser = `expired_session_user_${Date.now()}@s.whatsapp.net`;
    await db.addXp(normalUser, 100);
    // Compra de pack con 100 XP debe fallar porque el costo normal es 150 XP
    const packFail = await handlePack({ args: [] }, TEST_GROUP, {
        key: { remoteJid: TEST_GROUP, participant: normalUser },
        pushName: 'Normal User'
    }, {
        sendConfirmation: false,
        throttleMs: 0
    });
    assert.equal(packFail.success, false);
    assert.equal(packFail.reason, 'INSUFFICIENT_FUNDS');
    assert.equal(packFail.cost, 150);
});

test('CHALLENGE 2.5: Multi-crash cycle stress test (Start -> Crash -> Recover -> Drop -> Crash -> Recover -> Claim -> Crash -> Recover -> Expire -> Recover)', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();

    // Paso 1: Iniciar
    await happyHour.startHappyHour({ durationMinutes: 60, groupJid: TEST_GROUP, broadcast: false });
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);

    // Crash 1 & Recover
    happyHour.resetInMemoryState();
    await happyHour.initHappyHourRecovery();
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);

    // Paso 2: Disparar Airdrop
    await happyHour.triggerAirDrop(TEST_GROUP);
    assert.equal(happyHour.isAirdropActive(TEST_GROUP), true);

    // Crash 2 & Recover
    happyHour.resetInMemoryState();
    await happyHour.initHappyHourRecovery();
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);
    assert.equal(happyHour.isAirdropActive(TEST_GROUP), true);

    // Paso 3: Reclamar Airdrop
    const claimRes = await happyHour.claimAirdrop(
        TEST_GROUP,
        '5215580000001@s.whatsapp.net',
        'YOO',
        'Survivor',
        { key: { remoteJid: TEST_GROUP, participant: '5215580000001@s.whatsapp.net' } },
        { throttleMs: 0, customDir: mockFotosDir }
    );
    assert.equal(claimRes.success, true);
    if (claimRes.packPromise) await claimRes.packPromise;

    // Crash 3 & Recover
    happyHour.resetInMemoryState();
    await happyHour.initHappyHourRecovery();
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);
    assert.equal(happyHour.isAirdropActive(TEST_GROUP), false);

    // Paso 4: Simular expiración de tiempo en SQLite y Crash 4
    await db.saveHappyHourState({
        active_until: Date.now() - 1000
    });
    happyHour.resetInMemoryState();
    await happyHour.initHappyHourRecovery();

    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), false);
    const finalRow = await db.getHappyHourState();
    assert.equal(finalRow.is_active, 0);
});
