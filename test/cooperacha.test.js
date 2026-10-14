'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
// Aislamiento de base de datos de pruebas para no alterar data/bot.db de producción (R4)
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botsky-coop-db-'));
process.env.DATA_DIR = testDataDir;

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.DATA_DIR = testDataDir;

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

// Mockear llamadas de red externas a meme-api.com y descargas de imagen (R4)
const axios = require('axios');
const originalAxiosGet = axios.get;
axios.get = async (url, config) => {
    if (typeof url === 'string') {
        if (url.includes('meme-api.com')) {
            return {
                data: {
                    memes: [
                        { url: 'https://mock.meme/coop1.jpg' }
                    ],
                    url: 'https://mock.meme/coop1.jpg'
                }
            };
        }
        if (url.includes('mock.meme') || url.includes('picsum.photos') || config?.responseType === 'arraybuffer') {
            return { data: JPEG_1X1_BUFFER };
        }
    }
    return originalAxiosGet(url, config);
};

const db = require('../src/services/db');
const evolution = require('../src/services/evolution');
const { isRegisteredCommand } = require('../src/core/commandRegistry');
const {
    handleCooperacha,
    startCooperacha,
    contributeToCooperacha,
    showCooperachaStatus,
    expireCooperacha,
    completeCooperacha,
    cancelCooperacha,
    hasActiveCooperacha,
    getCooperachaSession,
    isGroupAuthorized,
    activeSessions
} = require('../src/commands/cooperacha');
const { generateCensoredImage } = require('../src/services/imageCensor');
const { getLocalImage, getCooperachaImage } = require('../src/services/cooperachaImages');

// Captura unificada de mensajes salientes sin llamadas reales a la red
const sentTexts = [];
const sentMediaList = [];

evolution.client.post = async (url, data) => {
    if (data && data.text) {
        sentTexts.push(data.text);
    }
    if (data && data.caption) {
        sentTexts.push(data.caption);
    }
    if (data && data.mediatype) {
        sentMediaList.push(data);
    }
    return {
        data: {
            status: 'SUCCESS',
            key: { id: `mock_msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
        }
    };
};

function clearMessageHistory() {
    sentTexts.length = 0;
    sentMediaList.length = 0;
}

// Helper para crear una imagen JPEG válida de prueba usando FFmpeg
function createTestImage(filePath) {
    return new Promise((resolve, reject) => {
        execFile('ffmpeg', [
            '-y',
            '-f', 'lavfi',
            '-i', 'testsrc=size=320x240:rate=1',
            '-frames:v', '1',
            filePath
        ], (err) => {
            if (err) return reject(err);
            resolve(filePath);
        });
    });
}

test('Cooperacha 1: aliases registrados correctamente en commandRegistry', () => {
    assert.strictEqual(isRegisteredCommand('cooperacha'), true);
    assert.strictEqual(isRegisteredCommand('coop'), true);
    assert.strictEqual(isRegisteredCommand('coperacha'), true);
    assert.strictEqual(isRegisteredCommand('vaquita'), true);
    assert.strictEqual(isRegisteredCommand('reto'), true);
    assert.strictEqual(isRegisteredCommand('destapar'), true);
    assert.strictEqual(isRegisteredCommand('cooperar'), true);
    assert.strictEqual(isRegisteredCommand('aportar'), true);
});

test('Cooperacha 2: rechazo estricto en chats privados y verificación de autorización de grupos', async () => {
    clearMessageHistory();
    const privateJid = '5215512345678@s.whatsapp.net';
    const fakeMessageData = {
        key: { remoteJid: privateJid, participant: privateJid },
        pushName: 'Privado'
    };

    await handleCooperacha({ raw: '!cooperacha', args: [], flags: {} }, privateJid, fakeMessageData);

    assert.ok(sentTexts.length > 0, 'Debe enviar respuesta al chat privado');
    assert.ok(sentTexts.some(t => t.includes('solo se puede jugar en grupos')), 'Debe indicar que solo es para grupos');
    assert.strictEqual(hasActiveCooperacha(privateJid), false, 'No debe crear sesión en privado');

    // Prueba con grupo no autorizado cuando se restringe ALLOWED_GROUPS_NORMAL
    const unauthorizedGroup = '120363000000000001@g.us';
    const origGroups = process.env.ALLOWED_GROUPS_NORMAL;
    const origAdminGroups = process.env.ALLOWED_GROUPS_ADMIN;
    process.env.ALLOWED_GROUPS_NORMAL = '120363999999999999';
    process.env.ALLOWED_GROUPS_ADMIN = '';

    clearMessageHistory();
    await handleCooperacha({ raw: '!cooperacha', args: [], flags: {} }, unauthorizedGroup, {
        key: { remoteJid: unauthorizedGroup, participant: '5215511111111@s.whatsapp.net' }
    });

    assert.ok(sentTexts.length > 0);
    assert.ok(sentTexts.some(t => t.includes('no está autorizado')), 'Debe rechazar grupos no autorizados');
    assert.strictEqual(hasActiveCooperacha(unauthorizedGroup), false);

    process.env.ALLOWED_GROUPS_NORMAL = origGroups;
    process.env.ALLOWED_GROUPS_ADMIN = origAdminGroups;
});

test('Cooperacha 3: procesamiento no bloqueante de imagen censurada con FFmpeg', async () => {
    const tmpDir = os.tmpdir();
    const testInput = path.join(tmpDir, `test_censor_input_${Date.now()}.jpg`);
    await createTestImage(testInput);

    try {
        const censoredOutput = await generateCensoredImage(testInput);
        assert.ok(censoredOutput, 'Debe retornar la ruta de salida censurada');
        assert.ok(fs.existsSync(censoredOutput), 'El archivo censurado debe existir en disco');

        const stats = fs.statSync(censoredOutput);
        assert.ok(stats.size > 0, 'El archivo censurado no debe estar vacío');

        fs.unlinkSync(censoredOutput);
    } finally {
        if (fs.existsSync(testInput)) fs.unlinkSync(testInput);
    }
});

test('Cooperacha 4: arranque de reto, creación de sesión, meta configurable y previsualización censurada', async () => {
    clearMessageHistory();
    const groupJid = `test_coop_start_${Date.now()}@g.us`;
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;

    const tmpDir = os.tmpdir();
    const customTestDir = path.join(tmpDir, `test_fotos_${Date.now()}`);
    fs.mkdirSync(customTestDir, { recursive: true });
    const localImg = path.join(customTestDir, 'local_test.png');
    await createTestImage(localImg);

    try {
        const session = await startCooperacha(groupJid, {
            key: { remoteJid: groupJid, participant: userJid }
        }, {
            targetXp: 400,
            durationMs: 60000,
            customDir: customTestDir,
            authorized: true
        });

        assert.ok(session, 'La sesión debe haber sido creada');
        assert.strictEqual(hasActiveCooperacha(groupJid), true);
        assert.strictEqual(session.targetXp, 400);
        assert.strictEqual(session.currentXp, 0);
        assert.ok(session.timer !== null, 'Debe tener un temporizador activo');

        // Verificar que se envió la previsualización censurada
        assert.ok(sentMediaList.length > 0, 'Debe despachar la imagen censurada');
        assert.ok(sentMediaList[0].caption.includes('COOPERACHA DE XP'), 'Caption debe anunciar la cooperacha');
        assert.ok(sentMediaList[0].caption.includes('400 XP'), 'Caption debe reflejar la meta de 400 XP');

        // Aislamiento estricto: segundo intento de arrancar en el mismo grupo es rechazado
        clearMessageHistory();
        const secondSession = await startCooperacha(groupJid, {}, { customDir: customTestDir, authorized: true });
        assert.strictEqual(secondSession, null, 'No debe permitir segunda sesión simultánea');
        assert.ok(sentTexts.some(t => t.includes('Ya hay una cooperacha activa')));
    } finally {
        cancelCooperacha(groupJid);
        if (fs.existsSync(localImg)) fs.unlinkSync(localImg);
        if (fs.existsSync(customTestDir)) fs.rmdirSync(customTestDir);
    }
});

test('Cooperacha 5: deducción atómica de XP y validaciones contra saldo insuficiente y datos inválidos', async () => {
    clearMessageHistory();
    const groupJid = `test_coop_atoms_${Date.now()}@g.us`;
    const userJid = `user_atoms_${Date.now()}@s.whatsapp.net`;
    const userName = 'DonadorAtómico';

    const tmpDir = os.tmpdir();
    const customTestDir = path.join(tmpDir, `test_fotos_${Date.now()}`);
    fs.mkdirSync(customTestDir, { recursive: true });
    const localImg = path.join(customTestDir, 'test.jpg');
    await createTestImage(localImg);

    try {
        await startCooperacha(groupJid, {}, { targetXp: 500, customDir: customTestDir, authorized: true });

        // Inicializar usuario con exactamente 40 XP
        await db.getOrCreateUser(userJid);
        const userBefore = await db.getOrCreateUser(userJid);
        if (userBefore.xp > 0) await db.subtractXp(userJid, userBefore.xp);
        await db.addXp(userJid, 40);

        // 1. Aporte inválido (negativo, cero o flotante) -> Rechazar
        clearMessageHistory();
        const resInvalid = await contributeToCooperacha(groupJid, userJid, userName, -20);
        assert.strictEqual(resInvalid.success, false);
        assert.strictEqual(resInvalid.reason, 'INVALID_AMOUNT');
        assert.ok(sentTexts.some(t => t.includes('mayor a 0')));

        const checkAfterInvalid = await db.getOrCreateUser(userJid);
        assert.strictEqual(checkAfterInvalid.xp, 40, 'El saldo no debe cambiar tras aporte inválido');

        // 2. Saldo insuficiente: intenta meter 50 XP teniendo solo 40 XP -> Rechazo amigable
        clearMessageHistory();
        const resInsufficient = await contributeToCooperacha(groupJid, userJid, userName, 50);
        assert.strictEqual(resInsufficient.success, false);
        assert.strictEqual(resInsufficient.reason, 'INSUFFICIENT_FUNDS');
        assert.ok(sentTexts.some(t => t.includes('No traes suficiente XP') && t.includes('40 XP')));

        const checkAfterInsuff = await db.getOrCreateUser(userJid);
        assert.strictEqual(checkAfterInsuff.xp, 40, 'El saldo debe conservarse en 40 XP');
        assert.strictEqual(getCooperachaSession(groupJid).currentXp, 0, 'La cooperacha debe seguir en 0 XP');

        // 3. Aporte válido: mete 30 XP de sus 40 XP
        clearMessageHistory();
        const resSuccess = await contributeToCooperacha(groupJid, userJid, userName, 30);
        assert.strictEqual(resSuccess.success, true);
        assert.strictEqual(resSuccess.completed, false);
        assert.strictEqual(resSuccess.currentXp, 30);

        const checkAfterSuccess = await db.getOrCreateUser(userJid);
        assert.strictEqual(checkAfterSuccess.xp, 10, 'El saldo debe reducirse atómicamente a 10 XP');

        // Verificar mensaje de progreso conciso
        assert.ok(sentTexts.some(t => t.includes('+30 XP') && t.includes('DonadorAtómico')));
        assert.ok(sentTexts.some(t => t.includes('30 / 500 XP')));
        assert.ok(sentTexts.some(t => t.includes('Tiempo restante:')));
        assert.ok(sentTexts.some(t => t.includes('Faltan') && t.includes('470 XP')));
    } finally {
        cancelCooperacha(groupJid);
        if (fs.existsSync(localImg)) fs.unlinkSync(localImg);
        if (fs.existsSync(customTestDir)) fs.rmdirSync(customTestDir);
    }
});

test('Cooperacha 6: ciclo completo de expiración con retención del 20% y reembolso automático del 80%', async () => {
    clearMessageHistory();
    const groupJid = `test_coop_expire_${Date.now()}@g.us`;
    const userA = `user_a_${Date.now()}@s.whatsapp.net`;
    const userB = `user_b_${Date.now()}@s.whatsapp.net`;

    const tmpDir = os.tmpdir();
    const customTestDir = path.join(tmpDir, `test_fotos_${Date.now()}`);
    fs.mkdirSync(customTestDir, { recursive: true });
    const localImg = path.join(customTestDir, 'expire_test.jpg');
    await createTestImage(localImg);

    try {
        // Inicializar saldos
        const uA = await db.getOrCreateUser(userA);
        if (uA.xp > 0) await db.subtractXp(userA, uA.xp);
        await db.addXp(userA, 100);

        const uB = await db.getOrCreateUser(userB);
        if (uB.xp > 0) await db.subtractXp(userB, uB.xp);
        await db.addXp(userB, 50);

        // Arrancar reto con meta 500 XP
        await startCooperacha(groupJid, {}, { targetXp: 500, customDir: customTestDir, authorized: true });

        // User A mete 100 XP (queda con 0 XP)
        await contributeToCooperacha(groupJid, userA, 'Pancho', 100);
        // User B mete 50 XP (queda con 0 XP)
        await contributeToCooperacha(groupJid, userB, 'Chucho', 50);

        const checkA_mid = await db.getOrCreateUser(userA);
        const checkB_mid = await db.getOrCreateUser(userB);
        assert.strictEqual(checkA_mid.xp, 0);
        assert.strictEqual(checkB_mid.xp, 0);

        clearMessageHistory();

        // Expirar la cooperacha
        const expResult = await expireCooperacha(groupJid);
        assert.ok(expResult);
        assert.strictEqual(expResult.status, 'expired');
        assert.strictEqual(hasActiveCooperacha(groupJid), false);

        // Validar reembolsos del 80%:
        // User A aportó 100 XP -> Reembolso: floor(100 * 0.8) = 80 XP (20 XP comisión)
        // User B aportó 50 XP -> Reembolso: floor(50 * 0.8) = 40 XP (10 XP comisión)
        const checkA_final = await db.getOrCreateUser(userA);
        const checkB_final = await db.getOrCreateUser(userB);

        assert.strictEqual(checkA_final.xp, 80, 'User A debe recibir exactamente el 80% (80 XP)');
        assert.strictEqual(checkB_final.xp, 40, 'User B debe recibir exactamente el 80% (40 XP)');

        // Validar que la foto original NUNCA fue enviada
        assert.strictEqual(sentMediaList.length, 0, 'La foto original JAMÁS debe enviarse al expirar');

        // Validar mensaje burlón de Botsky sobre marros y comisión del 20%
        assert.ok(sentTexts.some(t => t.includes('SE LES ACABÓ EL TIEMPO')));
        assert.ok(sentTexts.some(t => t.includes('20% de comisión')));
        assert.ok(sentTexts.some(t => t.includes('80%')));
        assert.ok(sentTexts.some(t => t.includes('Pancho') && t.includes('+80 XP')));
        assert.ok(sentTexts.some(t => t.includes('Chucho') && t.includes('+40 XP')));
    } finally {
        if (fs.existsSync(localImg)) fs.unlinkSync(localImg);
        if (fs.existsSync(customTestDir)) fs.rmdirSync(customTestDir);
    }
});

test('Cooperacha 7: ciclo completo de cumplimiento al 100% de la meta con destape de foto original', async () => {
    clearMessageHistory();
    const groupJid = `test_coop_complete_${Date.now()}@g.us`;
    const userC = `user_c_${Date.now()}@s.whatsapp.net`;
    const userD = `user_d_${Date.now()}@s.whatsapp.net`;

    const tmpDir = os.tmpdir();
    const customTestDir = path.join(tmpDir, `test_fotos_${Date.now()}`);
    fs.mkdirSync(customTestDir, { recursive: true });
    const localImg = path.join(customTestDir, 'complete_destape.jpg');
    await createTestImage(localImg);

    try {
        const uC = await db.getOrCreateUser(userC);
        if (uC.xp > 0) await db.subtractXp(userC, uC.xp);
        await db.addXp(userC, 200);

        const uD = await db.getOrCreateUser(userD);
        if (uD.xp > 0) await db.subtractXp(userD, uD.xp);
        await db.addXp(userD, 200);

        // Arrancar reto con meta de 150 XP
        await startCooperacha(groupJid, {}, { targetXp: 150, customDir: customTestDir, authorized: true });
        clearMessageHistory();

        // 1. User C aporta 100 XP (100 / 150 XP, falta aún)
        const res1 = await contributeToCooperacha(groupJid, userC, 'Mariachi', 100);
        assert.strictEqual(res1.completed, false);
        assert.strictEqual(sentMediaList.length, 0, 'No debe destaparse aún');

        // 2. User D aporta 50 XP (150 / 150 XP -> 100% de meta alcanzado)
        const res2 = await contributeToCooperacha(groupJid, userD, 'Compadre', 50);
        assert.strictEqual(res2.completed, true);
        assert.strictEqual(hasActiveCooperacha(groupJid), false, 'La sesión debe cerrarse tras completarse');

        // Validar que se despachó la imagen original sin censura
        assert.ok(sentMediaList.length > 0, 'Debe despachar la foto destapada');
        assert.ok(sentMediaList[0].caption.includes('¡SE ARMÓ LA COOPERACHA, CABRONES!'));
        assert.ok(sentMediaList[0].caption.includes('Mariachi'));
        assert.ok(sentMediaList[0].caption.includes('150 XP'));
        assert.doesNotMatch(sentMediaList[0].caption, /dios|cristo|jes[uú]s|virgen/i);
    } finally {
        if (fs.existsSync(localImg)) fs.unlinkSync(localImg);
        if (fs.existsSync(customTestDir)) fs.rmdirSync(customTestDir);
    }
});

test('Cooperacha 8: gestión híbrida de fuentes (carpeta local vs fallback web)', async () => {
    // 1. Carpeta local vacía o inexistente
    const nonExistentDir = path.join(os.tmpdir(), `empty_dir_${Date.now()}`);
    const localRes = getLocalImage(nonExistentDir);
    assert.strictEqual(localRes, null, 'Directorio inexistente debe retornar null');

    // 2. Carpeta con archivos compatibles
    const populatedDir = path.join(os.tmpdir(), `populated_${Date.now()}`);
    fs.mkdirSync(populatedDir, { recursive: true });
    const testFile = path.join(populatedDir, 'foto_valida.png');
    await createTestImage(testFile);

    try {
        const found = getLocalImage(populatedDir);
        assert.ok(found);
        assert.strictEqual(found.source, 'local');
        assert.strictEqual(found.isTemporary, false);
        assert.strictEqual(found.path, testFile);

        // Hybrid prioriza local cuando no hay categoría
        const hybridLocal = await getCooperachaImage(null, { customDir: populatedDir });
        assert.ok(hybridLocal);
        assert.strictEqual(hybridLocal.source, 'local');

        // 3. Auditoría H6: getCooperachaImage sin customDir ni FOTOS_DIR no debe lanzar ReferenceError
        const origFotos = process.env.FOTOS_DIR;
        const origRikolino = process.env.RIKOLINO_DIR;
        delete process.env.FOTOS_DIR;
        process.env.RIKOLINO_DIR = nonExistentDir;
        try {
            const noOpt = await getCooperachaImage();
            assert.strictEqual(noOpt, null, 'Sin customDir ni biblioteca debe retornar null sin errores');

            const filler = await getCooperachaImage('porfa');
            assert.strictEqual(filler, null, 'Muletilla "porfa" debe normalizarse a null sin lanzar errores');

            const unk = await getCooperachaImage('categoria_inexistente_xyz');
            assert.strictEqual(unk, null, 'Categoría inexistente debe retornar null sin fallback a web');
        } finally {
            if (origFotos) process.env.FOTOS_DIR = origFotos;
            if (origRikolino) process.env.RIKOLINO_DIR = origRikolino;
            else delete process.env.RIKOLINO_DIR;
        }
    } finally {
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
        if (fs.existsSync(populatedDir)) fs.rmdirSync(populatedDir);
    }
});

test('Cooperacha 9: consulta de estado cuando la cooperacha está activa muestra progreso y tiempo', async () => {
    clearMessageHistory();
    const groupJid = `test_coop_status_${Date.now()}@g.us`;
    const userJid = `user_status_${Date.now()}@s.whatsapp.net`;

    const tmpDir = os.tmpdir();
    const customTestDir = path.join(tmpDir, `test_fotos_${Date.now()}`);
    fs.mkdirSync(customTestDir, { recursive: true });
    const localImg = path.join(customTestDir, 'status_test.jpg');
    await createTestImage(localImg);

    try {
        await startCooperacha(groupJid, {}, { targetXp: 500, customDir: customTestDir, authorized: true });

        await db.getOrCreateUser(userJid);
        await db.addXp(userJid, 200);
        await contributeToCooperacha(groupJid, userJid, 'Observador', 150);

        clearMessageHistory();
        await handleCooperacha({ raw: '!coop', args: [], flags: {} }, groupJid, {
            key: { remoteJid: groupJid, participant: userJid },
            pushName: 'Observador'
        });

        assert.ok(sentTexts.some(t => t.includes('ESTADO DE LA COOPERACHA')));
        assert.ok(sentTexts.some(t => t.includes('150 / 500 XP')));
        assert.ok(sentTexts.some(t => t.includes('30%')));
        assert.ok(sentTexts.some(t => t.includes('Observador')));
    } finally {
        cancelCooperacha(groupJid);
        if (fs.existsSync(localImg)) fs.unlinkSync(localImg);
        if (fs.existsSync(customTestDir)) fs.rmdirSync(customTestDir);
    }
});

test('Cooperacha 10: cancelación por administrador reembolsa 100% y rechaza a no administradores', async () => {
    clearMessageHistory();
    const groupJid = `test_coop_cancel_${Date.now()}@g.us`;
    const adminJid = '5214435810175@s.whatsapp.net'; // Admin configurado
    const normalJid = `normal_user_${Date.now()}@s.whatsapp.net`;

    const tmpDir = os.tmpdir();
    const customTestDir = path.join(tmpDir, `test_fotos_${Date.now()}`);
    fs.mkdirSync(customTestDir, { recursive: true });
    const localImg = path.join(customTestDir, 'cancel_test.jpg');
    await createTestImage(localImg);

    try {
        await startCooperacha(groupJid, {}, { targetXp: 300, customDir: customTestDir, authorized: true });

        // Usuario normal aporta 80 XP
        await db.getOrCreateUser(normalJid);
        await db.addXp(normalJid, 80);
        await contributeToCooperacha(groupJid, normalJid, 'Aportador', 80);

        const checkBeforeCancel = await db.getOrCreateUser(normalJid);
        assert.strictEqual(checkBeforeCancel.xp, 0);

        // 1. Intento de cancelar por usuario común -> Rechazar
        clearMessageHistory();
        await handleCooperacha({ raw: '!coop cancelar', args: ['cancelar'], flags: {} }, groupJid, {
            key: { remoteJid: groupJid, participant: normalJid },
            pushName: 'Aportador'
        });

        assert.ok(sentTexts.some(t => t.includes('Solo los administradores pueden cancelar')));
        assert.strictEqual(hasActiveCooperacha(groupJid), true);

        // 2. Cancelación por admin autorizado -> Reembolsa 100%
        clearMessageHistory();
        await handleCooperacha({ raw: '!coop cancelar', args: ['cancelar'], flags: {} }, groupJid, {
            key: { remoteJid: groupJid, participant: adminJid },
            pushName: 'Admin'
        });

        assert.strictEqual(hasActiveCooperacha(groupJid), false);
        assert.ok(sentTexts.some(t => t.includes('Cooperacha cancelada') && t.includes('100%')));

        // Validar reembolso total del 100% (80 XP de vuelta completos)
        const checkAfterCancel = await db.getOrCreateUser(normalJid);
        assert.strictEqual(checkAfterCancel.xp, 80);
    } finally {
        cancelCooperacha(groupJid);
        if (fs.existsSync(localImg)) fs.unlinkSync(localImg);
        if (fs.existsSync(customTestDir)) fs.rmdirSync(customTestDir);
    }
});

test('Cooperacha 11: concurrencia atómica de SQLite previene sobregiro en aportes paralelos', async () => {
    const userJid = `concurrent_user_${Date.now()}@s.whatsapp.net`;
    await db.getOrCreateUser(userJid);
    const curr = await db.getOrCreateUser(userJid);
    if (curr.xp > 0) await db.subtractXp(userJid, curr.xp);
    await db.addXp(userJid, 100); // Saldo: 100 XP

    // Ejecutar 3 deducciones concurrentes de 40 XP cada una (total 120 XP > 100 XP)
    const results = await Promise.all([
        db.deductUserXpAtomic(userJid, 40),
        db.deductUserXpAtomic(userJid, 40),
        db.deductUserXpAtomic(userJid, 40)
    ]);

    const successes = results.filter(r => r.success === true);
    const failures = results.filter(r => r.success === false && r.reason === 'INSUFFICIENT_FUNDS');

    assert.strictEqual(successes.length, 2, 'Exactamente 2 deducciones deben tener éxito (40 + 40 = 80 XP)');
    assert.strictEqual(failures.length, 1, 'Exactamente 1 deducción debe fallar por saldo insuficiente');

    const finalUser = await db.getOrCreateUser(userJid);
    assert.strictEqual(finalUser.xp, 20, 'El saldo restante debe ser exactamente 20 XP (100 - 80)');
});

test('Cooperacha 12: enrutamiento de lenguaje natural mediante dispatcher (le meto 100)', async () => {
    clearMessageHistory();
    const { dispatch, _resetCooldowns } = require('../src/core/dispatcher');
    _resetCooldowns();

    const groupJid = `test_coop_nat_${Date.now()}@g.us`;
    const userJid = '5214435810175@s.whatsapp.net';
    const origNormal = process.env.ALLOWED_GROUPS_NORMAL;
    process.env.ALLOWED_GROUPS_NORMAL = groupJid; // Autorizar grupo en el dispatcher

    const tmpDir = os.tmpdir();
    const customTestDir = path.join(tmpDir, `test_fotos_${Date.now()}`);
    fs.mkdirSync(customTestDir, { recursive: true });
    const localImg = path.join(customTestDir, 'nat_test.jpg');
    await createTestImage(localImg);

    try {
        const beforeUser = await db.getOrCreateUser(userJid);
        await db.addXp(userJid, 500);
        const startXp = beforeUser.xp + 500;

        // Arrancar cooperacha
        await startCooperacha(groupJid, {}, { targetXp: 500, customDir: customTestDir, authorized: true });
        assert.strictEqual(hasActiveCooperacha(groupJid), true);

        clearMessageHistory();

        // Enviar frase natural "le meto 100" en el grupo
        await dispatch({
            from: groupJid,
            participant: userJid,
            text: 'Botsky, le meto 100',
            messageType: 'conversation',
            isGroup: true,
            hasPrefix: false,
            pushName: 'NaturalUser',
            messageData: {
                key: { remoteJid: groupJid, participant: userJid },
                pushName: 'NaturalUser'
            }
        });

        // Verificar que el aporte de 100 XP fue procesado correctamente
        const session = getCooperachaSession(groupJid);
        assert.strictEqual(session.currentXp, 100);

        const afterUser = await db.getOrCreateUser(userJid);
        assert.strictEqual(afterUser.xp, startXp - 100, 'Debe descontar exactamente 100 XP');

        assert.ok(sentTexts.some(t => t.includes('+100 XP') && t.includes('NaturalUser')));
    } finally {
        cancelCooperacha(groupJid);
        process.env.ALLOWED_GROUPS_NORMAL = origNormal;
        if (fs.existsSync(localImg)) fs.unlinkSync(localImg);
        if (fs.existsSync(customTestDir)) fs.rmdirSync(customTestDir);
    }
});

test('Cooperacha 13: censura blindada genera archivo válido con pixelado y barra de censura', async () => {
    const tmpDir = os.tmpdir();
    const testImg = path.join(tmpDir, `censor_test_${Date.now()}.jpg`);
    await createTestImage(testImg);

    try {
        const censoredOutput = await generateCensoredImage(testImg);
        assert.ok(fs.existsSync(censoredOutput), 'El archivo censurado debe existir');
        const stats = fs.statSync(censoredOutput);
        assert.ok(stats.size > 100, 'El archivo debe tener bytes válidos');
        fs.unlinkSync(censoredOutput);
    } finally {
        if (fs.existsSync(testImg)) fs.unlinkSync(testImg);
    }
});

test('Cooperacha 14: reto autónomo cada 48 horas opera independientemente de activaciones manuales', async () => {
    const {
        maybeTriggerAutonomousCooperacha,
        getLastAutonomousCooperachaTime,
        AUTONOMOUS_COOLDOWN_MS
    } = require('../src/commands/cooperacha');

    const groupJid = `test_coop_auto_${Date.now()}@g.us`;
    const origNormal = process.env.ALLOWED_GROUPS_NORMAL;
    const origFotos = process.env.FOTOS_DIR;
    process.env.ALLOWED_GROUPS_NORMAL = groupJid;

    const tmpDir = os.tmpdir();
    const customTestDir = path.join(tmpDir, `test_auto_fotos_${Date.now()}`);
    fs.mkdirSync(customTestDir, { recursive: true });
    const localImg = path.join(customTestDir, 'auto_test.jpg');
    await createTestImage(localImg);
    process.env.FOTOS_DIR = customTestDir;

    try {
        // 1. Un usuario activa la cooperacha manualmente
        await startCooperacha(groupJid, {}, { targetXp: 200, customDir: customTestDir, authorized: true });
        assert.strictEqual(hasActiveCooperacha(groupJid), true);

        // Verificar que la activación manual NO registra evento de 'autonomous_cooperacha'
        const lastAutoTimeAfterManual = await getLastAutonomousCooperachaTime(groupJid);
        assert.strictEqual(lastAutoTimeAfterManual, 0, 'Activación manual no debe registrar evento autónomo');

        // Cancelar la cooperacha manual para dejar el chat libre
        cancelCooperacha(groupJid);
        assert.strictEqual(hasActiveCooperacha(groupJid), false);

        // 2. Simular que se lanzó una autónoma hace 10 horas (< 48 horas)
        const tenHoursAgo = Date.now() - (10 * 60 * 60 * 1000);
        await db.addSocialEvent(groupJid, 'autonomous_cooperacha', 'Reto de prueba hace 10h');
        // Sobreescribir el created_at a hace 10 horas
        const rawDb = db.db || db;
        await new Promise((resolve) => {
            rawDb.run(
                `UPDATE bot_social_events SET created_at = ? WHERE chat_id = ? AND event_type = 'autonomous_cooperacha'`,
                [tenHoursAgo, groupJid],
                resolve
            );
        });

        const checkCooldown = await maybeTriggerAutonomousCooperacha(groupJid);
        assert.strictEqual(checkCooldown.triggered, false);
        assert.ok(checkCooldown.reason && checkCooldown.reason.includes('cooldown_active'));

        // 3. Simular que pasaron 49 horas (> 48 horas)
        const fortyNineHoursAgo = Date.now() - (49 * 60 * 60 * 1000);
        await new Promise((resolve) => {
            rawDb.run(
                `UPDATE bot_social_events SET created_at = ? WHERE chat_id = ? AND event_type = 'autonomous_cooperacha'`,
                [fortyNineHoursAgo, groupJid],
                resolve
            );
        });

        // Forzar chequeo autónomo omitiendo restricción horaria para el test
        const checkPassed = await maybeTriggerAutonomousCooperacha(groupJid, { ignoreHours: true });
        assert.strictEqual(checkPassed.triggered, true, 'Debe dispararse tras superar 48h de cooldown');
        assert.strictEqual(hasActiveCooperacha(groupJid), true, 'La sesión de cooperacha debe quedar activa');
        cancelCooperacha(groupJid);
    } finally {
        cancelCooperacha(groupJid);
        process.env.ALLOWED_GROUPS_NORMAL = origNormal;
        process.env.FOTOS_DIR = origFotos;
        if (fs.existsSync(localImg)) fs.unlinkSync(localImg);
        if (fs.existsSync(customTestDir)) fs.rmdirSync(customTestDir);
    }
});

test.after(() => {
    try {
        fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch (_) {}
});
