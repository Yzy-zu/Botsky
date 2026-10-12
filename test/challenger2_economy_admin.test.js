'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3');

// ─── Aislamiento Estricto de Base de Datos y Entorno (R6) ─────────────────────
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botsky-challenger2-test-db-'));
process.env.DATA_DIR = testDataDir;

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.DATA_DIR = testDataDir;

const TEST_GROUP = '120363427922045362@g.us';
const ADMIN_NUMBER = '5214435810175';
const ADMIN_JID = `${ADMIN_NUMBER}@s.whatsapp.net`;
const NON_ADMIN_NUMBER = '5215599999999';
const NON_ADMIN_JID = `${NON_ADMIN_NUMBER}@s.whatsapp.net`;

process.env.ALLOWED_GROUPS_NORMAL = `${process.env.ALLOWED_GROUPS_NORMAL || ''},120363427922045362`;
process.env.ALLOWED_NUMBERS_ADMIN = `${process.env.ALLOWED_NUMBERS_ADMIN || ''},${ADMIN_NUMBER}`;

// Generador de imagen JPEG en memoria
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

// Crear directorio de fotos mock con 12 imágenes para satisfacer pedidos de hasta 6 fotos
const mockFotosDir = path.join(testDataDir, 'mock_fotos');
fs.mkdirSync(mockFotosDir, { recursive: true });
for (let i = 1; i <= 12; i++) {
    fs.writeFileSync(path.join(mockFotosDir, `foto_${i}.jpg`), JPEG_1X1_BUFFER);
}
process.env.FOTOS_DIR = mockFotosDir;

// Mocks de Evolution API
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
const { dispatch } = require('../src/core/dispatcher');

test.after(() => {
    happyHour.resetInMemoryState();
    try {
        fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch (_) {}
});

// ─────────────────────────────────────────────────────────────────────────────
// PRUEBA EMPÍRICA 1: Experiencia por mensaje en server.js (+20 XP vs +1 XP)
// ─────────────────────────────────────────────────────────────────────────────
test('Challenger 2 — Tarea 1.1: server.js otorga exactamente 20 XP durante Hora Feliz y exactamente 1 XP antes/después', async () => {
    const serverPort = 38472;
    const serverHost = '127.0.0.1';
    const serverDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botsky-server-xp-test-'));

    // Iniciar server.js en subproceso con base de datos limpia y puerto aislado
    const serverProc = spawn(process.execPath, [path.join(__dirname, '../src/core/server.js')], {
        env: {
            ...process.env,
            PORT: String(serverPort),
            WEBHOOK_PORT: String(serverPort),
            WEBHOOK_HOST: serverHost,
            DATA_DIR: serverDbDir,
            EVOLUTION_API_URL: 'http://127.0.0.1:59999',
            ALLOWED_GROUPS_NORMAL: TEST_GROUP,
            ALLOWED_NUMBERS_ADMIN: ADMIN_NUMBER
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdoutLog = '';
    let stderrLog = '';
    serverProc.stdout.on('data', d => { stdoutLog += d.toString(); });
    serverProc.stderr.on('data', d => { stderrLog += d.toString(); });

    // Esperar a que el servidor HTTP esté listo
    async function waitForServer(port, retries = 30) {
        for (let i = 0; i < retries; i++) {
            try {
                await new Promise((resolve, reject) => {
                    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
                        if (res.statusCode === 200) resolve();
                        else reject(new Error(`Status ${res.statusCode}`));
                    });
                    req.on('error', reject);
                    req.setTimeout(500, () => req.destroy());
                });
                return;
            } catch {
                await new Promise(r => setTimeout(r, 200));
            }
        }
        throw new Error(`Servidor server.js no respondió a tiempo. Logs:\n${stdoutLog}\n${stderrLog}`);
    }

    // Helper para enviar webhook POST al servidor
    async function sendWebhookMessage(fromChat, participantJid, text, msgId) {
        const payload = JSON.stringify({
            event: 'messages.upsert',
            data: {
                key: {
                    remoteJid: fromChat,
                    fromMe: false,
                    id: msgId,
                    participant: participantJid
                },
                message: {
                    conversation: text
                },
                pushName: 'Tester Empirico'
            }
        });

        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: serverHost,
                port: serverPort,
                path: '/webhook',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            }, (res) => {
                res.resume();
                resolve(res.statusCode);
            });
            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    }

    let testDb = null;

    try {
        await waitForServer(serverPort);

        const dbPath = path.join(serverDbDir, 'bot.db');

        // Esperar a que SQLite esté creado
        for (let i = 0; i < 20; i++) {
            if (fs.existsSync(dbPath)) {
                testDb = new sqlite3.Database(dbPath);
                break;
            }
            await new Promise(r => setTimeout(r, 200));
        }
        assert.ok(testDb, 'La base de datos SQLite del servidor debe existir');

        function getUserXp(jid) {
            return new Promise((resolve, reject) => {
                testDb.get('SELECT xp FROM users WHERE jid = ?', [jid], (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.xp : 0);
                });
            });
        }

        const testParticipant = '5215511223344@s.whatsapp.net';

        // ── PASO 1: ANTES de la Hora Feliz ──
        const xpInitial = await getUserXp(testParticipant);
        assert.equal(xpInitial, 0, 'El usuario arranca con 0 XP');

        // Enviar mensaje 1 normal al grupo
        const status1 = await sendWebhookMessage(TEST_GROUP, testParticipant, 'Primer mensaje normal antes de HF', 'XP_MSG_1');
        assert.equal(status1, 200);
        await new Promise(r => setTimeout(r, 350)); // Permitir ciclo de base de datos

        const xpAfterMsg1 = await getUserXp(testParticipant);
        const deltaBefore = xpAfterMsg1 - xpInitial;
        assert.equal(deltaBefore, 1, `Fuera de Hora Feliz se debe otorgar exactamente 1 XP. Recibido: ${deltaBefore}`);

        // ── PASO 2: ACTIVAR Hora Feliz mediante comando admin ──
        await sendWebhookMessage(TEST_GROUP, ADMIN_JID, '!horafeliz on 30', 'ADMIN_ON_MSG');
        await new Promise(r => setTimeout(r, 400));

        // Enviar mensaje 2 normal al grupo (durante Hora Feliz)
        const status2 = await sendWebhookMessage(TEST_GROUP, testParticipant, 'Segundo mensaje durante Hora Feliz', 'XP_MSG_2');
        assert.equal(status2, 200);
        await new Promise(r => setTimeout(r, 350));

        const xpAfterMsg2 = await getUserXp(testParticipant);
        const deltaDuring = xpAfterMsg2 - xpAfterMsg1;
        assert.equal(deltaDuring, 20, `Durante Hora Feliz se debe otorgar exactamente 20 XP. Recibido: ${deltaDuring}`);

        // Enviar mensaje 3 normal al grupo (sigue durante Hora Feliz)
        const status3 = await sendWebhookMessage(TEST_GROUP, testParticipant, 'Tercer mensaje durante Hora Feliz', 'XP_MSG_3');
        assert.equal(status3, 200);
        await new Promise(r => setTimeout(r, 350));

        const xpAfterMsg3 = await getUserXp(testParticipant);
        const deltaDuring2 = xpAfterMsg3 - xpAfterMsg2;
        assert.equal(deltaDuring2, 20, `Durante Hora Feliz el segundo mensaje también debe sumar exactamente 20 XP. Recibido: ${deltaDuring2}`);

        // ── PASO 3: DESACTIVAR Hora Feliz mediante comando admin ──
        await sendWebhookMessage(TEST_GROUP, ADMIN_JID, '!horafeliz off', 'ADMIN_OFF_MSG');
        await new Promise(r => setTimeout(r, 400));

        // Enviar mensaje 4 normal al grupo (después de Hora Feliz)
        const status4 = await sendWebhookMessage(TEST_GROUP, testParticipant, 'Cuarto mensaje después de desactivar HF', 'XP_MSG_4');
        assert.equal(status4, 200);
        await new Promise(r => setTimeout(r, 350));

        const xpAfterMsg4 = await getUserXp(testParticipant);
        const deltaAfter = xpAfterMsg4 - xpAfterMsg3;
        assert.equal(deltaAfter, 1, `Después de apagar Hora Feliz se debe restaurar a exactamente 1 XP. Recibido: ${deltaAfter}`);

        // Total esperado: 0 + 1 + 20 + 20 + 1 = 42 XP
        assert.equal(xpAfterMsg4, 42, `Saldo total acumulado esperado: 42 XP. Real: ${xpAfterMsg4}`);

    } finally {
        if (testDb) {
            testDb.close();
        }
        serverProc.kill('SIGTERM');
        try {
            fs.rmSync(serverDbDir, { recursive: true, force: true });
        } catch (_) {}
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PRUEBA EMPÍRICA 2: Costo de packs en pack.js (75 XP, 150 XP, 0 XP gratis)
// ─────────────────────────────────────────────────────────────────────────────
test('Challenger 2 — Tarea 1.2: Costo de pack en pack.js descuenta 75 XP en HF, 150 XP normal y 0 XP si es gratis', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();

    const buyerNormalJid = '5215577771111@s.whatsapp.net';
    const buyerNormalMsg = {
        key: { remoteJid: TEST_GROUP, participant: buyerNormalJid },
        pushName: 'Buyer Normal'
    };

    // Caso A: Fuera de Hora Feliz
    // 1. Fondos insuficientes (149 XP) -> Rechazado, 0 XP descontados
    await db.subtractXp(buyerNormalJid, 10_000_000).catch(() => {});
    await db.addXp(buyerNormalJid, 149);

    const failNormal = await handlePack({ args: [] }, TEST_GROUP, buyerNormalMsg, {
        sendConfirmation: false,
        throttleMs: 0
    });
    assert.equal(failNormal.success, false);
    assert.equal(failNormal.reason, 'INSUFFICIENT_FUNDS');
    assert.equal(failNormal.cost, 150);
    const balanceFailNormal = (await db.getOrCreateUser(buyerNormalJid)).xp;
    assert.equal(balanceFailNormal, 149, 'No debe descontar nada cuando los fondos son insuficientes');

    // 2. Fondos exactos (150 XP) -> Exitoso, saldo queda en 0
    await db.addXp(buyerNormalJid, 1); // 149 + 1 = 150 XP
    const successNormal = await handlePack({ args: [] }, TEST_GROUP, buyerNormalMsg, {
        sendConfirmation: false,
        throttleMs: 0,
        customDir: mockFotosDir
    });
    assert.equal(successNormal.success, true);
    assert.equal(successNormal.cost, 150);
    assert.equal(successNormal.balance, 0);
    const balanceAfterNormal = (await db.getOrCreateUser(buyerNormalJid)).xp;
    assert.equal(balanceAfterNormal, 0, 'Debe descontar exactamente 150 XP en modo normal');

    // Caso B: Durante Hora Feliz
    await happyHour.startHappyHour({ durationMinutes: 30, groupJid: TEST_GROUP, broadcast: false });
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);

    const buyerHappyJid = '5215577772222@s.whatsapp.net';
    const buyerHappyMsg = {
        key: { remoteJid: TEST_GROUP, participant: buyerHappyJid },
        pushName: 'Buyer Happy'
    };

    // 1. Fondos insuficientes (74 XP) -> Rechazado con costo 75 XP
    await db.subtractXp(buyerHappyJid, 10_000_000).catch(() => {});
    await db.addXp(buyerHappyJid, 74);

    const failHappy = await handlePack({ args: [] }, TEST_GROUP, buyerHappyMsg, {
        sendConfirmation: false,
        throttleMs: 0
    });
    assert.equal(failHappy.success, false);
    assert.equal(failHappy.reason, 'INSUFFICIENT_FUNDS');
    assert.equal(failHappy.cost, 75);
    const balanceFailHappy = (await db.getOrCreateUser(buyerHappyJid)).xp;
    assert.equal(balanceFailHappy, 74, 'No debe descontar nada si tiene 74 XP');

    // 2. Fondos exactos (75 XP) -> Exitoso, saldo queda en 0
    await db.addXp(buyerHappyJid, 1); // 74 + 1 = 75 XP
    const successHappy = await handlePack({ args: [] }, TEST_GROUP, buyerHappyMsg, {
        sendConfirmation: false,
        throttleMs: 0,
        customDir: mockFotosDir
    });
    assert.equal(successHappy.success, true);
    assert.equal(successHappy.cost, 75);
    assert.equal(successHappy.balance, 0);
    const balanceAfterHappy = (await db.getOrCreateUser(buyerHappyJid)).xp;
    assert.equal(balanceAfterHappy, 0, 'Debe descontar exactamente 75 XP en Hora Feliz');

    // 3. Fondos con excedente (200 XP) -> Exitoso, saldo queda en 125 XP
    await db.addXp(buyerHappyJid, 200);
    const successHappy2 = await handlePack({ args: [] }, TEST_GROUP, buyerHappyMsg, {
        sendConfirmation: false,
        throttleMs: 0,
        customDir: mockFotosDir
    });
    assert.equal(successHappy2.success, true);
    assert.equal(successHappy2.cost, 75);
    assert.equal(successHappy2.balance, 125);
    const balanceAfterHappy2 = (await db.getOrCreateUser(buyerHappyJid)).xp;
    assert.equal(balanceAfterHappy2, 125, '200 - 75 = 125 XP restantes');

    // Caso C: Pack Gratis (AirDrop Express / options.free = true)
    const buyerFreeJid = '5215577773333@s.whatsapp.net';
    const buyerFreeMsg = {
        key: { remoteJid: TEST_GROUP, participant: buyerFreeJid },
        pushName: 'Buyer Free'
    };
    await db.subtractXp(buyerFreeJid, 10_000_000).catch(() => {}); // Saldo en 0 XP

    const freePackRes = await handlePack({ args: [] }, TEST_GROUP, buyerFreeMsg, {
        free: true,
        sendConfirmation: false,
        throttleMs: 0,
        customDir: mockFotosDir
    });
    assert.equal(freePackRes.success, true);
    assert.equal(freePackRes.cost, 0);
    assert.equal(freePackRes.balance, 0);
    const balanceFree = (await db.getOrCreateUser(buyerFreeJid)).xp;
    assert.equal(balanceFree, 0, 'Un pack gratis debe costar 0 XP y proceder con saldo 0');

    // Caso D: Reversión automática a 150 XP al apagar Hora Feliz
    await happyHour.stopHappyHour({ groupJid: TEST_GROUP, broadcast: false });
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), false);

    // Usuario tiene 100 XP: en Hora Feliz le alcanzaba (75 XP), pero ahora falla porque cuesta 150 XP
    await db.subtractXp(buyerHappyJid, 10_000_000).catch(() => {});
    await db.addXp(buyerHappyJid, 100);

    const revertedRes = await handlePack({ args: [] }, TEST_GROUP, buyerHappyMsg, {
        sendConfirmation: false,
        throttleMs: 0
    });
    assert.equal(revertedRes.success, false);
    assert.equal(revertedRes.reason, 'INSUFFICIENT_FUNDS');
    assert.equal(revertedRes.cost, 150, 'El costo del pack debe revertirse inmediatamente a 150 XP');
});

// ─────────────────────────────────────────────────────────────────────────────
// PRUEBA EMPÍRICA 3: Distribución de cantidad de items en pack.js (50 muestras)
// ─────────────────────────────────────────────────────────────────────────────
test('Challenger 2 — Tarea 1.3: Muestreo de 50 packs en Hora Feliz [4, 6] vs 50 packs en Normal [3, 5]', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();

    const sampleUserJid = '5215599998888@s.whatsapp.net';
    const sampleMsg = {
        key: { remoteJid: TEST_GROUP, participant: sampleUserJid },
        pushName: 'Sampler User'
    };
    await db.addXp(sampleUserJid, 100_000); // Saldo suficiente para todas las compras

    // 1. Muestreo de 50 packs durante Hora Feliz (deben estar estrictamente en [4, 6])
    await happyHour.startHappyHour({ durationMinutes: 30, groupJid: TEST_GROUP, broadcast: false });
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);

    const happyCounts = [];
    const happyHistogram = { 4: 0, 5: 0, 6: 0, other: 0 };

    for (let i = 1; i <= 50; i++) {
        const res = await handlePack({ args: [] }, TEST_GROUP, sampleMsg, {
            sendConfirmation: false,
            throttleMs: 0,
            customDir: mockFotosDir
        });
        assert.equal(res.success, true);
        const count = res.images_sent;
        happyCounts.push(count);

        // Verificación estricta por muestra
        assert.ok(
            count >= 4 && count <= 6,
            `Muestra ${i} de Hora Feliz fuera del rango permitido [4, 6]: recibido ${count}`
        );

        if (happyHistogram[count] !== undefined) {
            happyHistogram[count]++;
        } else {
            happyHistogram.other++;
        }
    }

    assert.equal(happyCounts.length, 50);
    assert.equal(happyHistogram.other, 0, 'Ninguna muestra de Hora Feliz puede estar fuera de 4, 5 o 6');
    const minHappy = Math.min(...happyCounts);
    const maxHappy = Math.max(...happyCounts);
    assert.equal(minHappy, 4, `El mínimo observado en Hora Feliz debe ser 4 (recibido ${minHappy})`);
    assert.equal(maxHappy, 6, `El máximo observado en Hora Feliz debe ser 6 (recibido ${maxHappy})`);
    assert.ok(happyHistogram[4] > 0, 'Debe haber generado al menos un pack de 4 fotos');
    assert.ok(happyHistogram[5] > 0, 'Debe haber generado al menos un pack de 5 fotos');
    assert.ok(happyHistogram[6] > 0, 'Debe haber generado al menos un pack de 6 fotos');

    // 2. Muestreo de 50 packs en Modo Normal (deben estar estrictamente en [3, 5])
    await happyHour.stopHappyHour({ groupJid: TEST_GROUP, broadcast: false });
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), false);

    const normalCounts = [];
    const normalHistogram = { 3: 0, 4: 0, 5: 0, other: 0 };

    for (let j = 1; j <= 50; j++) {
        const res = await handlePack({ args: [] }, TEST_GROUP, sampleMsg, {
            sendConfirmation: false,
            throttleMs: 0,
            customDir: mockFotosDir
        });
        assert.equal(res.success, true);
        const count = res.images_sent;
        normalCounts.push(count);

        // Verificación estricta por muestra
        assert.ok(
            count >= 3 && count <= 5,
            `Muestra ${j} de Modo Normal fuera del rango permitido [3, 5]: recibido ${count}`
        );

        if (normalHistogram[count] !== undefined) {
            normalHistogram[count]++;
        } else {
            normalHistogram.other++;
        }
    }

    assert.equal(normalCounts.length, 50);
    assert.equal(normalHistogram.other, 0, 'Ninguna muestra Normal puede estar fuera de 3, 4 o 5');
    const minNormal = Math.min(...normalCounts);
    const maxNormal = Math.max(...normalCounts);
    assert.equal(minNormal, 3, `El mínimo observado en Normal debe ser 3 (recibido ${minNormal})`);
    assert.equal(maxNormal, 5, `El máximo observado en Normal debe ser 5 (recibido ${maxNormal})`);
    assert.ok(normalHistogram[3] > 0, 'Debe haber generado al menos un pack de 3 fotos');
    assert.ok(normalHistogram[4] > 0, 'Debe haber generado al menos un pack de 4 fotos');
    assert.ok(normalHistogram[5] > 0, 'Debe haber generado al menos un pack de 5 fotos');
});

// ─────────────────────────────────────────────────────────────────────────────
// PRUEBA EMPÍRICA 4: Restricciones de autorización de administración
// ─────────────────────────────────────────────────────────────────────────────
test('Challenger 2 — Tarea 2: Solicitudes no autorizadas a !horafeliz on y !horafeliz off devuelven rechazo exacto', async () => {
    happyHour.resetInMemoryState();
    await db.resetHappyHourState();
    sentTexts.length = 0;

    const EXACT_REJECTION = '> ❌ Acceso denegado. Solo administradores pueden activar o desactivar la Hora Feliz.';

    const nonAdminMsg = {
        key: { remoteJid: TEST_GROUP, participant: NON_ADMIN_JID },
        pushName: 'Usuario Malicioso No Admin'
    };

    const adminMsg = {
        key: { remoteJid: TEST_GROUP, participant: ADMIN_JID },
        pushName: 'Admin Autenticado'
    };

    // 1. Solicitud no autorizada para ACTIVAR: !horafeliz on 60
    const deniedOn = await handleHoraFeliz({ args: ['on', '60'], raw: '!horafeliz on 60' }, TEST_GROUP, nonAdminMsg);
    assert.equal(deniedOn.success, false);
    assert.equal(deniedOn.reason, 'FORBIDDEN');
    assert.equal(deniedOn.message, EXACT_REJECTION, 'El texto de rechazo en "on" debe coincidir carácter por carácter');
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), false, 'La Hora Feliz no debe haberse activado');

    // Verificar texto exacto enviado por evolución
    assert.ok(
        sentTexts.some(t => t.data.text === EXACT_REJECTION),
        'Evolution API debe haber transmitido el texto exacto de rechazo'
    );

    // 2. Solicitud no autorizada para ACTIVAR con alias: "iniciar", "activar", "prender"
    for (const alias of ['iniciar', 'activar', 'prender']) {
        const deniedAlias = await handleHoraFeliz({ args: [alias], raw: `!horafeliz ${alias}` }, TEST_GROUP, nonAdminMsg);
        assert.equal(deniedAlias.success, false);
        assert.equal(deniedAlias.reason, 'FORBIDDEN');
        assert.equal(deniedAlias.message, EXACT_REJECTION);
        assert.equal(happyHour.isHappyHourActive(TEST_GROUP), false);
    }

    // 3. Activar Hora Feliz legítimamente por un administrador
    const adminStart = await handleHoraFeliz({ args: ['on', '30'], raw: '!horafeliz on 30' }, TEST_GROUP, adminMsg);
    assert.equal(adminStart.success, true);
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true, 'La Hora Feliz debe estar activa tras orden de admin');

    // 4. Solicitud no autorizada para DESACTIVAR: !horafeliz off
    sentTexts.length = 0;
    const deniedOff = await handleHoraFeliz({ args: ['off'], raw: '!horafeliz off' }, TEST_GROUP, nonAdminMsg);
    assert.equal(deniedOff.success, false);
    assert.equal(deniedOff.reason, 'FORBIDDEN');
    assert.equal(deniedOff.message, EXACT_REJECTION, 'El texto de rechazo en "off" debe coincidir carácter por carácter');
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true, 'La Hora Feliz debe PERMANECER ACTIVA');

    assert.ok(
        sentTexts.some(t => t.data.text === EXACT_REJECTION),
        'Evolution API debe haber transmitido el texto exacto de rechazo en "off"'
    );

    // 5. Solicitud no autorizada para DESACTIVAR con alias: "apagar", "detener", "cancelar"
    for (const alias of ['apagar', 'detener', 'cancelar', 'desactivar']) {
        const deniedAliasOff = await handleHoraFeliz({ args: [alias], raw: `!horafeliz ${alias}` }, TEST_GROUP, nonAdminMsg);
        assert.equal(deniedAliasOff.success, false);
        assert.equal(deniedAliasOff.reason, 'FORBIDDEN');
        assert.equal(deniedAliasOff.message, EXACT_REJECTION);
        assert.equal(happyHour.isHappyHourActive(TEST_GROUP), true);
    }

    // 6. Solicitud no autorizada a través de dispatcher (defensa en profundidad)
    // Usar JIDs distintos para cada invocación para evitar el rate-limiter anti-spam (cooldown 1.5s)
    sentTexts.length = 0;
    const nonAdminUser1 = '5215599990001@s.whatsapp.net';
    await dispatch({
        text: '!horafeliz on',
        from: TEST_GROUP,
        isGroup: true,
        participant: nonAdminUser1,
        pushName: 'Hacker1',
        actualMessageType: 'conversation',
        actualMessageData: { key: { remoteJid: TEST_GROUP, participant: nonAdminUser1 } },
        shouldDispatch: true,
        hasPrefix: true
    });
    assert.ok(
        sentTexts.some(t => t.data.text === EXACT_REJECTION),
        'Dispatcher Sección 7 debe interceptar y responder con el texto exacto de rechazo en !horafeliz on'
    );

    // 7. Solicitud no autorizada en lenguaje natural a través de dispatcher
    sentTexts.length = 0;
    const nonAdminUser2 = '5215599990002@s.whatsapp.net';
    await dispatch({
        text: 'botsky activa la hora feliz 45 minutos',
        from: TEST_GROUP,
        isGroup: true,
        participant: nonAdminUser2,
        pushName: 'Hacker2',
        actualMessageType: 'conversation',
        actualMessageData: { key: { remoteJid: TEST_GROUP, participant: nonAdminUser2 } },
        shouldDispatch: true,
        hasPrefix: false
    });
    assert.ok(
        sentTexts.some(t => t.data.text === EXACT_REJECTION),
        'Dispatcher debe rechazar solicitudes en lenguaje natural de usuarios no administradores'
    );

    // 8. Solicitud no autorizada de apagado en lenguaje natural a través de dispatcher
    sentTexts.length = 0;
    const nonAdminUser3 = '5215599990003@s.whatsapp.net';
    await dispatch({
        text: 'apaga la hora feliz',
        from: TEST_GROUP,
        isGroup: true,
        participant: nonAdminUser3,
        pushName: 'Hacker3',
        actualMessageType: 'conversation',
        actualMessageData: { key: { remoteJid: TEST_GROUP, participant: nonAdminUser3 } },
        shouldDispatch: true,
        hasPrefix: false
    });
    assert.ok(
        sentTexts.some(t => t.data.text === EXACT_REJECTION),
        'Dispatcher debe rechazar apagado en lenguaje natural de usuarios no administradores'
    );

    // 9. Solicitud desde participante LID sin mapeo telefónico (Fail-Closed)
    sentTexts.length = 0;
    const lidOnlyMsg = {
        key: { remoteJid: TEST_GROUP, participant: '11223344556677@lid' },
        pushName: 'Lid Mystery User'
    };
    const deniedLid = await handleHoraFeliz({ args: ['on', '30'], raw: '!horafeliz on 30' }, TEST_GROUP, lidOnlyMsg);
    assert.equal(deniedLid.success, false);
    assert.equal(deniedLid.reason, 'FORBIDDEN');
    assert.equal(deniedLid.message, EXACT_REJECTION, 'Cuentas @lid sin mapeo telefónico deben fallar en FAIL-CLOSED');

    // 10. Consulta pública de estado NO requiere privilegios de administrador
    sentTexts.length = 0;
    const statusPublic = await handleHoraFeliz({ args: ['status'], raw: '!horafeliz status' }, TEST_GROUP, nonAdminMsg);
    assert.equal(statusPublic.success, true);
    assert.equal(statusPublic.action, 'status');
    assert.equal(statusPublic.status.active, true);
    assert.ok(
        sentTexts.some(t => t.data.text.includes('ESTADO DE LA HORA FELIZ')),
        'Cualquier usuario puede consultar el estado de la Hora Feliz'
    );

    // Admin apaga la Hora Feliz al finalizar
    const adminStop = await handleHoraFeliz({ args: ['off'], raw: '!horafeliz off' }, TEST_GROUP, adminMsg);
    assert.equal(adminStop.success, true);
    assert.equal(happyHour.isHappyHourActive(TEST_GROUP), false);
});
