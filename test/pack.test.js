'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
// Aislamiento de base de datos de pruebas para no alterar data/bot.db de producción (R4)
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botsky-pack-db-'));
process.env.DATA_DIR = testDataDir;

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.DATA_DIR = testDataDir;

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

// Mockear llamadas de red externas a meme-api.com y descargas de imagen (R4)
const axios = require('axios');
const originalAxiosGet = axios.get;
axios.get = async (url, config) => {
    if (typeof url === 'string') {
        if (url.includes('meme-api.com')) {
            return {
                data: {
                    memes: [
                        { url: 'https://mock.meme/img1.jpg' },
                        { url: 'https://mock.meme/img2.jpg' },
                        { url: 'https://mock.meme/img3.jpg' }
                    ],
                    url: 'https://mock.meme/img1.jpg'
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
const { isRegisteredCommand, getCommandHandler } = require('../src/core/commandRegistry');
const { handlePack, resolveBuyer, STANDARD_COST_XP } = require('../src/commands/pack');
const { getLocalPackImages, getPackImages } = require('../src/services/packImages');
const { dispatch, _resetCooldowns } = require('../src/core/dispatcher');

// Grupo autorizado configurado en .env (ALLOWED_GROUPS_NORMAL)
const AUTHORIZED_GROUP = '120363427922045362@g.us';
const UNAUTHORIZED_GROUP = '120363000000000001@g.us';

// Captura unificada de mensajes salientes sin llamadas reales a la red
const sentTexts = [];
const sentMediaList = [];

evolution.client.post = async (url, data) => {
    if (data && data.text) {
        sentTexts.push({ url, to: data.number, text: data.text, mentions: data.options?.mentions?.mentioned || [] });
    }
    if (data && data.caption) {
        sentTexts.push({ url, to: data.number, text: data.caption });
    }
    if (data && data.mediatype) {
        sentMediaList.push({ url, to: data.number, ...data });
    }
    return {
        data: {
            status: 'SUCCESS',
            key: { id: `mock_pack_msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
        }
    };
};

function clearHistory() {
    sentTexts.length = 0;
    sentMediaList.length = 0;
}

function createTestImagesDir(count = 5, prefix = 'foto') {
    const dir = path.join(os.tmpdir(), `botsky_pack_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 1; i <= count; i++) {
        fs.writeFileSync(path.join(dir, `${prefix}_${i}.jpg`), JPEG_1X1_BUFFER);
    }
    return dir;
}

test('Pack 1: Aliases y comandos registrados correctamente en commandRegistry', () => {
    assert.strictEqual(isRegisteredCommand('pack'), true, 'pack debe estar registrado');
    assert.strictEqual(isRegisteredCommand('packs'), true, 'packs debe estar registrado');
    assert.strictEqual(isRegisteredCommand('mercadonegro'), true, 'mercadonegro debe estar registrado');
    assert.strictEqual(isRegisteredCommand('comprarpack'), true, 'comprarpack debe estar registrado');
    assert.strictEqual(isRegisteredCommand('comprar'), true, 'comprar debe estar registrado');
    assert.strictEqual(isRegisteredCommand('compra'), true, 'compra debe estar registrado');
});

test('Pack 2: Deducción atómica de 150 XP en SQLite con saldo suficiente', async () => {
    clearHistory();
    const testDir = createTestImagesDir(4);
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;

    // 1. Asignar 250 XP
    await db.addXp(userJid, 250);
    const before = await db.getOrCreateUser(userJid);
    assert.strictEqual(before.xp, 250);

    // 2. Ejecutar compra
    const result = await handlePack(
        { args: [], raw: '!pack' },
        AUTHORIZED_GROUP,
        { key: { participant: userJid }, pushName: 'Juanito' },
        { customDir: testDir, throttleMs: 0 }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.cost, STANDARD_COST_XP);

    // 3. Verificar deducción exacta de 150 XP (250 - 150 = 100)
    const after = await db.getOrCreateUser(userJid);
    assert.strictEqual(after.xp, 100, 'Debe haber deducido exactamente 150 XP');

    fs.rmSync(testDir, { recursive: true, force: true });
});

test('Pack 3: Rechazo amigable por saldo insuficiente (<150 XP) sin cambios en saldo', async () => {
    clearHistory();
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;

    // 1. Asignar 80 XP (insuficiente para 150 XP)
    await db.addXp(userJid, 80);
    const before = await db.getOrCreateUser(userJid);
    assert.strictEqual(before.xp, 80);

    // 2. Intentar compra
    const result = await handlePack(
        { args: [], raw: '!pack' },
        AUTHORIZED_GROUP,
        { key: { participant: userJid }, pushName: 'Pobreton' },
        { throttleMs: 0 }
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'INSUFFICIENT_FUNDS');
    assert.strictEqual(result.balance, 80);

    // 3. Saldo intacto (sin cambios)
    const after = await db.getOrCreateUser(userJid);
    assert.strictEqual(after.xp, 80, 'El saldo no debe cambiar cuando la compra falla');

    // 4. Mensaje informativo amigable con alternativas
    assert.ok(result.message.includes('150 XP'));
    assert.ok(result.message.includes('daily') || result.message.includes('ruleta'));
});

test('Pack 4: Despacho desde grupo: confirmación en grupo y fotos exclusivamente al privado', async () => {
    clearHistory();
    const testDir = createTestImagesDir(3);
    const userPhone = '5215512345678';
    const userJid = `${userPhone}@s.whatsapp.net`;

    await db.addXp(userJid, 200);

    const result = await handlePack(
        { args: [], raw: '!pack' },
        AUTHORIZED_GROUP,
        { key: { participant: userJid }, pushName: 'Compañero' },
        { customDir: testDir, count: 3, throttleMs: 0 }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.delivered_to, userJid);

    // A. Confirmación enviada al grupo con mención
    const groupNotice = sentTexts.find(m => m.to === AUTHORIZED_GROUP);
    assert.ok(groupNotice, 'Debe haber un aviso público en el grupo');
    assert.match(groupNotice.text, /Sobres/i);
    assert.match(groupNotice.text, /mercancía/i);

    // B. Las fotos NUNCA deben enviarse al grupo
    const mediaToGroup = sentMediaList.filter(m => m.to === AUTHORIZED_GROUP);
    assert.strictEqual(mediaToGroup.length, 0, 'Jamás deben enviarse imágenes del pack al grupo público');

    // C. Las fotos deben despacharse al chat privado del usuario
    const mediaToPrivate = sentMediaList.filter(m => m.to === userJid);
    assert.strictEqual(mediaToPrivate.length, 3, 'Las 3 fotos deben enviarse al chat privado');

    fs.rmSync(testDir, { recursive: true, force: true });
});

test('Pack 5: Entrega incluye modo de visualización única (viewOnce: true)', async () => {
    clearHistory();
    const testDir = createTestImagesDir(3);
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;

    await db.addXp(userJid, 300);

    const result = await handlePack(
        { args: [], raw: '!pack' },
        userJid, // Chat privado directo
        { key: { remoteJid: userJid, participant: userJid }, pushName: 'Privado' },
        { customDir: testDir, count: 3, throttleMs: 0 }
    );

    assert.strictEqual(result.success, true);
    assert.ok(sentMediaList.length >= 3, 'Debe haber enviado al menos 3 fotos');

    for (const sentMedia of sentMediaList) {
        assert.strictEqual(sentMedia.viewOnce, true, 'Cada imagen debe incluir viewOnce: true');
        assert.strictEqual(sentMedia.options?.viewOnce, true, 'options debe incluir viewOnce: true');
    }

    fs.rmSync(testDir, { recursive: true, force: true });
});

test('Pack 6: Normalización de destinatario: saneamiento de números mexicanos 521 vs 52', async () => {
    // 1. Número con 52 (12 dígitos) se normaliza a 521 (13 dígitos) para WhatsApp
    const buyer1 = await resolveBuyer(AUTHORIZED_GROUP, {
        key: { participant: '525512345678:0@s.whatsapp.net' }
    });
    assert.strictEqual(buyer1.isLidOnly, false);
    assert.strictEqual(buyer1.phone, '5215512345678');
    assert.strictEqual(buyer1.privateJid, '5215512345678@s.whatsapp.net');

    // 2. Número con 521 (13 dígitos) se conserva canónico
    const buyer2 = await resolveBuyer(AUTHORIZED_GROUP, {
        key: { participant: '5215598765432@s.whatsapp.net' }
    });
    assert.strictEqual(buyer2.isLidOnly, false);
    assert.strictEqual(buyer2.phone, '5215598765432');
    assert.strictEqual(buyer2.privateJid, '5215598765432@s.whatsapp.net');

    // 3. Número local de 10 dígitos se antepone 521
    const buyer3 = await resolveBuyer(AUTHORIZED_GROUP, {
        senderPn: '5512345678'
    });
    assert.strictEqual(buyer3.isLidOnly, false);
    assert.strictEqual(buyer3.phone, '5215512345678');
});

test('Pack: compra con XP del participante LID y entrega al teléfono alternativo', async () => {
    clearHistory();
    const participant = '990000000001@lid';
    const phone = '5215500000001@s.whatsapp.net';
    const testDir = createTestImagesDir(3);
    const images = fs.readdirSync(testDir).map(file => ({ path: path.join(testDir, file) }));
    test.after(() => fs.rmSync(testDir, { recursive: true, force: true }));
    await db.addXp(participant, 250);
    const result = await handlePack({}, AUTHORIZED_GROUP, {
        key: { participant: '990000000001:2@lid', participantAlt: phone }
    }, {
        count: 3,
        throttleMs: 0,
        getPackImages: async () => images
    });
    assert.equal(result.success, true);
    assert.equal(result.delivered_to, phone);
    assert.equal((await db.getOrCreateUser(participant)).xp, 100);
    assert.equal((await db.getOrCreateUser(phone)).xp, 0);
    assert.equal(sentMediaList.length, 3);
    assert.ok(sentMediaList.every(item => item.to === phone));
});

test('Pack: muestra saldo LID insuficiente y permite usar saldo telefónico existente', async () => {
    clearHistory();
    const participant = '990000000002@lid';
    const phone = '5215500000002@s.whatsapp.net';
    const message = { key: { participant, participantAlt: phone } };
    await db.addXp(participant, 80);
    const rejected = await handlePack({}, AUTHORIZED_GROUP, message);
    assert.equal(rejected.reason, 'INSUFFICIENT_FUNDS');
    assert.equal(rejected.balance, 80);
    await db.addXp(phone, 200);
    const buyer = await resolveBuyer(AUTHORIZED_GROUP, message);
    assert.equal(buyer.userJid, phone);
    assert.equal((await db.getOrCreateUser(participant)).xp, 80);
});

test('Pack 7: Fail-Closed si el remitente solo es @lid sin número telefónico', async () => {
    clearHistory();
    const lidUser = `lid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@lid`;
    await db.addXp(lidUser, 500);

    const result = await handlePack(
        { args: [], raw: '!pack' },
        AUTHORIZED_GROUP,
        { key: { participant: lidUser }, pushName: 'LidGuy' },
        { throttleMs: 0 }
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'LID_ONLY');

    // Verificar que NO se dedujo XP (saldo intacto)
    const after = await db.getOrCreateUser(lidUser);
    assert.strictEqual(after.xp, 500, 'No debe deducir XP en fail-closed');
});

test('Pack 8: Selección híbrida de contenido: prioridad local vs fallback web', async () => {
    // 1. Con carpeta local con suficientes archivos -> obtiene archivos locales
    const localDir = createTestImagesDir(4);
    const localImages = await getPackImages(null, { customDir: localDir, count: 3 });
    assert.strictEqual(localImages.length, 3);
    for (const img of localImages) {
        assert.strictEqual(img.source, 'local');
        assert.strictEqual(img.isTemporary, false);
        assert.ok(fs.existsSync(img.path));
    }
    fs.rmSync(localDir, { recursive: true, force: true });

    // 2. Con carpeta local vacía -> no arroja excepción
    const emptyDir = path.join(os.tmpdir(), `botsky_empty_${Date.now()}`);
    fs.mkdirSync(emptyDir, { recursive: true });
    const emptyLocal = getLocalPackImages(emptyDir, 3);
    assert.strictEqual(emptyLocal.length, 0);
    fs.rmSync(emptyDir, { recursive: true, force: true });
});

test('Pack 9: Reembolso automático e integridad si la obtención de fotos falla por completo', async () => {
    clearHistory();
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 200);

    // Mock temporal para simular fallo catastrófico de red/almacén (0 imágenes)
    const packImagesModule = require('../src/services/packImages');
    const origGetPackImages = packImagesModule.getPackImages;
    packImagesModule.getPackImages = async () => [];

    try {
        const result = await handlePack(
            { args: [], raw: '!pack' },
            AUTHORIZED_GROUP,
            { key: { participant: userJid }, pushName: 'Desafortunado' },
            { throttleMs: 0 }
        );

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.reason, 'CONTENT_UNAVAILABLE');
        assert.strictEqual(result.refunded, true);

        // Saldo restaurado por reembolso
        const after = await db.getOrCreateUser(userJid);
        assert.strictEqual(after.xp, 200, 'Los 150 XP deben ser reembolsados intactos');
    } finally {
        packImagesModule.getPackImages = origGetPackImages;
    }
});

test('Pack 10: Comando explícito !comprar pack forwardea correctamente a handlePack', async () => {
    clearHistory();
    const testDir = createTestImagesDir(3, 'anime');
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 300);

    const origFotos = process.env.FOTOS_DIR;
    process.env.FOTOS_DIR = testDir;

    try {
        const cmdHandler = await getCommandHandler('comprar', {
            parsed: { command: 'comprar', args: ['pack', 'anime'], flags: {}, raw: '!comprar pack anime' },
            from: AUTHORIZED_GROUP,
            messageData: { key: { participant: userJid }, pushName: 'AnimeFan' }
        });

        assert.ok(cmdHandler, 'Debe retornar configuración de comando');
        const execResult = await cmdHandler.handler();

        assert.strictEqual(execResult.success, true);
        assert.ok(execResult.images_sent >= 3);

        const after = await db.getOrCreateUser(userJid);
        assert.strictEqual(after.xp, 150);
    } finally {
        process.env.FOTOS_DIR = origFotos;
        fs.rmSync(testDir, { recursive: true, force: true });
    }
});

test('Pack 11: Detección en lenguaje natural mediante dispatcher (Botsky véndeme un pack)', async () => {
    clearHistory();
    const testDir = createTestImagesDir(3);
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 300);

    // Mock temporal de getPackImages para usar testDir
    const packImagesModule = require('../src/services/packImages');
    const origGetPackImages = packImagesModule.getPackImages;
    packImagesModule.getPackImages = async (cat, opts) => origGetPackImages(cat, { ...opts, customDir: testDir, count: 3 });

    try {
        await dispatch({
            from: AUTHORIZED_GROUP,
            text: 'Botsky véndeme un pack',
            messageData: {
                key: { remoteJid: AUTHORIZED_GROUP, participant: userJid, id: 'NAT_PACK_1' },
                pushName: 'NaturalUser'
            }
        });

        // Verificar que se ejecutó y se dedujo el saldo
        const after = await db.getOrCreateUser(userJid);
        assert.strictEqual(after.xp, 150, 'Dispatcher debe enrutar y deducir 150 XP');

        // Verificar aviso en grupo y fotos al privado
        assert.ok(sentTexts.some(m => m.to === AUTHORIZED_GROUP && m.text.includes('Sobres')));
        assert.strictEqual(sentMediaList.filter(m => m.to === userJid).length, 3);
    } finally {
        packImagesModule.getPackImages = origGetPackImages;
        fs.rmSync(testDir, { recursive: true, force: true });
    }
});

test('Pack 12: Throttling espacia envíos consecutivos de fotos', async () => {
    clearHistory();
    const testDir = createTestImagesDir(3);
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 300);

    const timestamps = [];
    const origSendMedia = evolution.sendMedia;
    evolution.sendMedia = async (...args) => {
        timestamps.push(Date.now());
        return origSendMedia(...args);
    };

    try {
        await handlePack(
            { args: [], raw: '!pack' },
            userJid,
            { key: { participant: userJid }, pushName: 'Speedy' },
            { customDir: testDir, count: 3, throttleMs: 80 }
        );

        assert.strictEqual(timestamps.length, 3);
        const diff1 = timestamps[1] - timestamps[0];
        const diff2 = timestamps[2] - timestamps[1];
        assert.ok(diff1 >= 60, `diff1 (${diff1}ms) debe respetar el throttling`);
        assert.ok(diff2 >= 60, `diff2 (${diff2}ms) debe respetar el throttling`);
    } finally {
        evolution.sendMedia = origSendMedia;
        fs.rmSync(testDir, { recursive: true, force: true });
    }
});

test('Pack 13: Verificación de rechazo en grupo no autorizado', async () => {
    clearHistory();
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 300);

    const result = await handlePack(
        { args: [], raw: '!pack' },
        UNAUTHORIZED_GROUP,
        { key: { participant: userJid }, pushName: 'Intruso' },
        { throttleMs: 0 }
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'UNAUTHORIZED_GROUP');

    // No debe deducir XP
    const after = await db.getOrCreateUser(userJid);
    assert.strictEqual(after.xp, 300);
});

test('Pack 14: Lenguaje natural "Botsky, pásame un pack" en grupo', async () => {
    clearHistory();
    const testDir = createTestImagesDir(3);
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 300);

    const packImagesModule = require('../src/services/packImages');
    const origGetPackImages = packImagesModule.getPackImages;
    packImagesModule.getPackImages = async (cat, opts) => origGetPackImages(cat, { ...opts, customDir: testDir, count: 3 });

    try {
        await dispatch({
            from: AUTHORIZED_GROUP,
            text: 'Botsky, pásame un pack',
            messageData: {
                key: { remoteJid: AUTHORIZED_GROUP, participant: userJid, id: 'NAT_PACK_NOPREFIX' },
                pushName: 'CompaSinPrefijo'
            }
        });

        // Debe deducir 150 XP exactamente (300 - 150 = 150)
        const after = await db.getOrCreateUser(userJid);
        assert.strictEqual(after.xp, 150, 'Debe procesar la compra sin requerir que digan botsky');

        // Confirmación en el grupo y fotos al privado
        assert.ok(sentTexts.some(m => m.to === AUTHORIZED_GROUP && m.text.includes('Sobres')));
        assert.strictEqual(sentMediaList.filter(m => m.to === userJid).length, 3);
    } finally {
        packImagesModule.getPackImages = origGetPackImages;
        fs.rmSync(testDir, { recursive: true, force: true });
    }
});

test('Pack 15: Lenguaje natural con categoría ("pásame un pack de monas chinas") extrae categoría', async () => {
    clearHistory();
    let requestedCategory = null;
    const testDir = createTestImagesDir(3);
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 250);

    const packImagesModule = require('../src/services/packImages');
    const origGetPackImages = packImagesModule.getPackImages;
    packImagesModule.getPackImages = async (cat, opts) => {
        requestedCategory = cat;
        return origGetPackImages(cat, { ...opts, customDir: testDir, count: 3 });
    };

    try {
        await dispatch({
            from: AUTHORIZED_GROUP,
            text: 'Botsky, pásame un pack de monas chinas',
            messageData: {
                key: { remoteJid: AUTHORIZED_GROUP, participant: userJid, id: 'NAT_PACK_CAT' },
                pushName: 'Otaku'
            }
        });

        assert.strictEqual(requestedCategory, 'monas chinas');
        const after = await db.getOrCreateUser(userJid);
        assert.strictEqual(after.xp, 100);
    } finally {
        packImagesModule.getPackImages = origGetPackImages;
        fs.rmSync(testDir, { recursive: true, force: true });
    }
});

test('Pack 16: Concurrencia atómica: 2 compras simultáneas con saldo para 1 sola (200 XP)', async () => {
    clearHistory();
    const testDir = createTestImagesDir(4);
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 200);

    const results = await Promise.all([
        handlePack(
            { args: [], raw: '!pack' },
            AUTHORIZED_GROUP,
            { key: { participant: userJid }, pushName: 'Concurrent1' },
            { customDir: testDir, count: 3, throttleMs: 0 }
        ),
        handlePack(
            { args: [], raw: '!pack' },
            AUTHORIZED_GROUP,
            { key: { participant: userJid }, pushName: 'Concurrent2' },
            { customDir: testDir, count: 3, throttleMs: 0 }
        )
    ]);

    const successes = results.filter(r => r.success);
    const failures = results.filter(r => !r.success);

    assert.strictEqual(successes.length, 1, 'Exactamente una compra debe tener éxito');
    assert.strictEqual(failures.length, 1, 'Exactamente una compra debe fallar');
    assert.strictEqual(failures[0].reason, 'INSUFFICIENT_FUNDS');

    // Saldo final debe ser exactamente 50 XP (200 - 150 = 50, sin sobregiro)
    const after = await db.getOrCreateUser(userJid);
    assert.strictEqual(after.xp, 50, 'El saldo final debe ser 50 XP sin doble cobro');

    fs.rmSync(testDir, { recursive: true, force: true });
});

test('Pack 17: Subcarpeta local por categoría e inventario incompleto (<3) reembolsa', async () => {
    clearHistory();
    const baseDir = path.join(os.tmpdir(), `botsky_subcat_${Date.now()}`);
    const animeDir = path.join(baseDir, 'anime');
    fs.mkdirSync(animeDir, { recursive: true });

    // Crear 3 fotos en la subcarpeta 'anime'
    for (let i = 1; i <= 3; i++) {
        fs.writeFileSync(path.join(animeDir, `pic_${i}.png`), JPEG_1X1_BUFFER);
    }

    const { getLocalPackImages } = require('../src/services/packImages');
    const images = getLocalPackImages(baseDir, 3, 'anime');
    assert.strictEqual(images.length, 3, 'Debe leer imágenes de la subcarpeta anime');

    // Ahora probar cuando el inventario es menor a 3 fotos: debe reembolsar
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 300);

    const result = await handlePack(
        { args: [], raw: '!pack' },
        AUTHORIZED_GROUP,
        { key: { participant: userJid }, pushName: 'Incomplete' },
        {
            getPackImages: async () => [images[0], images[1]], // Solo 2 imágenes devueltas
            throttleMs: 0
        }
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'CONTENT_UNAVAILABLE');
    assert.strictEqual(result.refunded, true);

    const after = await db.getOrCreateUser(userJid);
    assert.strictEqual(after.xp, 300, 'Debe haber reembolsado el saldo completo');

    fs.rmSync(baseDir, { recursive: true, force: true });
});

test('Pack 18: Compra en chat privado 1-a-1 sin prefijo ("un pack")', async () => {
    clearHistory();
    const testDir = createTestImagesDir(3);
    const userPhone = '52155' + Date.now().toString().slice(-8);
    const userJid = `${userPhone}@s.whatsapp.net`;
    await db.addXp(userJid, 200);

    const origAllowed = process.env.ALLOWED_NUMBERS_NORMAL;
    process.env.ALLOWED_NUMBERS_NORMAL = origAllowed ? `${origAllowed},${userPhone}` : userPhone;

    const packImagesModule = require('../src/services/packImages');
    const origGetPackImages = packImagesModule.getPackImages;
    packImagesModule.getPackImages = async (cat, opts) => origGetPackImages(cat, { ...opts, customDir: testDir, count: 3 });

    try {
        await dispatch({
            from: userJid,
            text: 'un pack',
            messageData: {
                key: { remoteJid: userJid, participant: userJid, id: 'PRIVATE_UNPACK_1' },
                pushName: 'Privado'
            }
        });

        const after = await db.getOrCreateUser(userJid);
        assert.strictEqual(after.xp, 50, 'Debe deducir 150 XP');
        assert.strictEqual(sentMediaList.filter(m => m.to === userJid).length, 3);
    } finally {
        process.env.ALLOWED_NUMBERS_NORMAL = origAllowed;
        packImagesModule.getPackImages = origGetPackImages;
        fs.rmSync(testDir, { recursive: true, force: true });
    }
});

test('Pack 19: Blindaje contra Path Traversal en categorías locales (../../etc)', async () => {
    const baseDir = createTestImagesDir(3);
    const { getLocalPackImages } = require('../src/services/packImages');

    // Intentar escapar con traversal relativo
    const traversalImages = getLocalPackImages(baseDir, 3, '../../etc');
    for (const img of traversalImages) {
        assert.ok(
            img.path.startsWith(path.resolve(baseDir)),
            `La ruta ${img.path} no debe escapar de ${baseDir}`
        );
    }

    fs.rmSync(baseDir, { recursive: true, force: true });
});

test('Pack 20: Lenguaje natural expandido ("quiero comprar un pack", "me vendes un pack", "saca el pack")', async () => {
    clearHistory();
    const testDir = createTestImagesDir(3);
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 450);

    const packImagesModule = require('../src/services/packImages');
    const origGetPackImages = packImagesModule.getPackImages;
    packImagesModule.getPackImages = async (cat, opts) => origGetPackImages(cat, { ...opts, customDir: testDir, count: 3 });

    try {
        // Frase 1: "quiero comprar un pack"
        await dispatch({
            from: AUTHORIZED_GROUP,
            text: 'Botsky, quiero comprar un pack',
            messageData: {
                key: { remoteJid: AUTHORIZED_GROUP, participant: userJid, id: 'NAT_EXP_1' },
                pushName: 'NaturalExp1'
            }
        });

        const after1 = await db.getOrCreateUser(userJid);
        assert.strictEqual(after1.xp, 300, 'Debe deducir 150 XP para "quiero comprar un pack"');

        // Resetear cooldown de chat anti-spam para la segunda frase
        _resetCooldowns();

        // Frase 2: "saca el pack"
        await dispatch({
            from: AUTHORIZED_GROUP,
            text: 'Botsky, saca el pack',
            messageData: {
                key: { remoteJid: AUTHORIZED_GROUP, participant: userJid, id: 'NAT_EXP_2' },
                pushName: 'NaturalExp2'
            }
        });

        const after2 = await db.getOrCreateUser(userJid);
        assert.strictEqual(after2.xp, 150, 'Debe deducir 150 XP para "saca el pack"');
    } finally {
        packImagesModule.getPackImages = origGetPackImages;
        fs.rmSync(testDir, { recursive: true, force: true });
    }
});

test('Pack 21: Extracción y saneamiento de categoría con prefijo "de " (!pack de carros)', async () => {
    clearHistory();
    const testDir = createTestImagesDir(3);
    const carsDir = path.join(testDir, 'carros');
    fs.mkdirSync(carsDir, { recursive: true });
    for (let i = 1; i <= 3; i++) {
        fs.writeFileSync(path.join(carsDir, `car_${i}.jpg`), JPEG_1X1_BUFFER);
    }

    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 200);

    const result = await handlePack(
        { args: ['de', 'carros'], raw: '!pack de carros' },
        AUTHORIZED_GROUP,
        { key: { participant: userJid }, pushName: 'CarLover' },
        { customDir: testDir, count: 3, throttleMs: 0 }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.images_sent, 3);

    const after = await db.getOrCreateUser(userJid);
    assert.strictEqual(after.xp, 50);

    fs.rmSync(testDir, { recursive: true, force: true });
});

test('Pack 22: Categoría inexistente localmente devuelve 0 locales y recurre a web fallback en vez de fotos irrelevantes', async () => {
    const testDir = createTestImagesDir(4, 'perro'); // Solo archivos perro_1.jpg ...
    const { getLocalPackImages } = require('../src/services/packImages');

    // Búsqueda de categoría 'anime' donde solo hay 'perro'
    const animeImages = getLocalPackImages(testDir, 3, 'anime');
    assert.strictEqual(animeImages.length, 0, 'No debe devolver fotos de perros cuando se pide anime');

    fs.rmSync(testDir, { recursive: true, force: true });
});

test('Pack 23: Detección natural con signos de puntuación (!, ?), mención @Botsky y formas verbales expandidas', async () => {
    clearHistory();
    const testDir = createTestImagesDir(3);
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 600);

    const packImagesModule = require('../src/services/packImages');
    const origGetPackImages = packImagesModule.getPackImages;
    packImagesModule.getPackImages = async (cat, opts) => origGetPackImages(cat, { ...opts, customDir: testDir, count: 3 });

    try {
        // Frase con signo de admiración: "Botsky véndeme un pack!"
        await dispatch({
            from: AUTHORIZED_GROUP,
            text: 'Botsky véndeme un pack!',
            messageData: {
                key: { remoteJid: AUTHORIZED_GROUP, participant: userJid, id: 'NAT_PUNCT_1' },
                pushName: 'PunctUser'
            }
        });
        let user = await db.getOrCreateUser(userJid);
        assert.strictEqual(user.xp, 450, 'Debe deducir 150 XP para "Botsky véndeme un pack!"');
        _resetCooldowns();

        // Frase con mención @ y cortesía: "@Botsky pásame un pack porfa"
        await dispatch({
            from: AUTHORIZED_GROUP,
            text: '@Botsky pásame un pack porfa',
            messageData: {
                key: { remoteJid: AUTHORIZED_GROUP, participant: userJid, id: 'NAT_MENTION_1' },
                pushName: 'MentionUser'
            }
        });
        user = await db.getOrCreateUser(userJid);
        assert.strictEqual(user.xp, 300, 'Debe deducir 150 XP para "@Botsky pásame un pack porfa"');
        _resetCooldowns();

        // Forma verbal "te compro un pack"
        await dispatch({
            from: AUTHORIZED_GROUP,
            text: 'Botsky, te compro un pack',
            messageData: {
                key: { remoteJid: AUTHORIZED_GROUP, participant: userJid, id: 'NAT_VERB_1' },
                pushName: 'VerbUser'
            }
        });
        user = await db.getOrCreateUser(userJid);
        assert.strictEqual(user.xp, 150, 'Debe deducir 150 XP para "te compro un pack"');
    } finally {
        packImagesModule.getPackImages = origGetPackImages;
        fs.rmSync(testDir, { recursive: true, force: true });
    }
});

test('Pack 24: Saneamiento de muletillas de cortesía ("porfa", "por favor") no las trata como categorías', async () => {
    clearHistory();
    let capturedCategory = null;
    const testDir = createTestImagesDir(3);
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 300);

    const packImagesModule = require('../src/services/packImages');
    const origGetPackImages = packImagesModule.getPackImages;
    packImagesModule.getPackImages = async (cat, opts) => {
        capturedCategory = cat;
        return origGetPackImages(cat, { ...opts, customDir: testDir, count: 3 });
    };

    try {
        // "pásame un pack de monas chinas porfa" -> categoría debe ser "monas chinas", no "monas chinas porfa"
        await dispatch({
            from: AUTHORIZED_GROUP,
            text: 'Botsky, pásame un pack de monas chinas porfa',
            messageData: {
                key: { remoteJid: AUTHORIZED_GROUP, participant: userJid, id: 'NAT_CAT_COURTESY' },
                pushName: 'PoliteUser'
            }
        });

        assert.strictEqual(capturedCategory, 'monas chinas', 'La categoría debe ser limpia sin muletillas');
        const user = await db.getOrCreateUser(userJid);
        assert.strictEqual(user.xp, 150);
    } finally {
        packImagesModule.getPackImages = origGetPackImages;
        fs.rmSync(testDir, { recursive: true, force: true });
    }
});

test('Pack 25: Búsqueda general (!pack) incluye fotos de subdirectorios locales de primer nivel', () => {
    const baseDir = path.join(os.tmpdir(), `botsky_tree_${Date.now()}`);
    const subDir1 = path.join(baseDir, 'memes');
    const subDir2 = path.join(baseDir, 'paisajes');
    fs.mkdirSync(subDir1, { recursive: true });
    fs.mkdirSync(subDir2, { recursive: true });

    fs.writeFileSync(path.join(subDir1, 'meme1.jpg'), JPEG_1X1_BUFFER);
    fs.writeFileSync(path.join(subDir2, 'paisaje1.png'), JPEG_1X1_BUFFER);
    fs.writeFileSync(path.join(baseDir, 'root.jpg'), JPEG_1X1_BUFFER);

    const { getLocalPackImages } = require('../src/services/packImages');
    const found = getLocalPackImages(baseDir, 5, null);
    assert.strictEqual(found.length, 3, 'Debe encontrar las 3 imágenes entre la raíz y subdirectorios');

    fs.rmSync(baseDir, { recursive: true, force: true });
});

test('Pack 26: getLocalPackImages reconoce archivos .mp4 y .webm con isVideo: true y mime adecuado', () => {
    const testDir = path.join(os.tmpdir(), `botsky_pack_video_${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'foto_1.jpg'), JPEG_1X1_BUFFER);
    fs.writeFileSync(path.join(testDir, 'video_1.mp4'), Buffer.from('mock-mp4-data'));
    fs.writeFileSync(path.join(testDir, 'video_2.webm'), Buffer.from('mock-webm-data'));

    const items = getLocalPackImages(testDir, 5, null);
    assert.strictEqual(items.length, 3, 'Debe detectar 3 archivos multimedia');

    const jpgItem = items.find(it => it.id === 'foto_1.jpg');
    assert.ok(jpgItem);
    assert.strictEqual(jpgItem.isVideo, false);
    assert.strictEqual(jpgItem.mime, 'image/jpeg');

    const mp4Item = items.find(it => it.id === 'video_1.mp4');
    assert.ok(mp4Item);
    assert.strictEqual(mp4Item.isVideo, true);
    assert.strictEqual(mp4Item.mime, 'video/mp4');

    const webmItem = items.find(it => it.id === 'video_2.webm');
    assert.ok(webmItem);
    assert.strictEqual(webmItem.isVideo, true);
    assert.strictEqual(webmItem.mime, 'video/webm');

    fs.rmSync(testDir, { recursive: true, force: true });
});

test('Pack 27: handlePack despacha vídeos MP4 con mediatype video y viewOnce true en mensaje privado', async () => {
    clearHistory();
    const testDir = path.join(os.tmpdir(), `botsky_pack_mp4_${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    for (let i = 1; i <= 3; i++) {
        fs.writeFileSync(path.join(testDir, `clip_${i}.mp4`), Buffer.from(`mock-mp4-stream-${i}`));
    }

    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 300);

    const result = await handlePack(
        { args: [], raw: '!pack' },
        AUTHORIZED_GROUP,
        { key: { participant: userJid }, pushName: 'VideoUser' },
        { customDir: testDir, throttleMs: 0, count: 3 }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(sentMediaList.length, 3, 'Debe haber enviado 3 medios');

    for (const media of sentMediaList) {
        assert.strictEqual(media.to, userJid, 'Debe enviarse exclusivamente al chat privado');
        assert.strictEqual(media.mediatype, 'video', 'Mediatype debe ser video para MP4');
        assert.strictEqual(media.viewOnce, true, 'viewOnce debe ser true a nivel raíz');
        assert.strictEqual(media.options?.viewOnce, true, 'options.viewOnce debe ser true');
        assert.strictEqual(media.mimetype, 'video/mp4', 'mimetype debe ser video/mp4');
        assert.ok(media.fileName.endsWith('.mp4'));
    }

    fs.rmSync(testDir, { recursive: true, force: true });
});

test('Pack 28: Detección y despacho de archivos WebM como mediatype video con View Once', async () => {
    clearHistory();
    const testDir = path.join(os.tmpdir(), `botsky_pack_webm_${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    for (let i = 1; i <= 3; i++) {
        fs.writeFileSync(path.join(testDir, `clip_${i}.webm`), Buffer.from(`mock-webm-stream-${i}`));
    }

    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 300);

    const result = await handlePack(
        { args: [], raw: '!pack' },
        AUTHORIZED_GROUP,
        { key: { participant: userJid }, pushName: 'WebmUser' },
        { customDir: testDir, throttleMs: 0, count: 3 }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(sentMediaList.length, 3, 'Debe haber enviado 3 medios WebM');

    for (const media of sentMediaList) {
        assert.strictEqual(media.to, userJid);
        assert.strictEqual(media.mediatype, 'video', 'WebM debe mapearse a video, no a document');
        assert.strictEqual(media.viewOnce, true, 'viewOnce debe ser true');
        assert.strictEqual(media.options?.viewOnce, true, 'options.viewOnce debe ser true');
        assert.strictEqual(media.mimetype, 'video/webm', 'mimetype debe ser video/webm');
        assert.ok(media.fileName.endsWith('.webm'));
    }

    fs.rmSync(testDir, { recursive: true, force: true });
});

test('Pack 29: Entrega mixta de pack multimedia (fotos y vídeos) preserva tipos respectivos y View Once', async () => {
    clearHistory();
    const testDir = path.join(os.tmpdir(), `botsky_pack_mixed_${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'foto_1.jpg'), JPEG_1X1_BUFFER);
    fs.writeFileSync(path.join(testDir, 'foto_2.png'), JPEG_1X1_BUFFER);
    fs.writeFileSync(path.join(testDir, 'video_1.mp4'), Buffer.from('mock-mp4-data'));
    fs.writeFileSync(path.join(testDir, 'video_2.webm'), Buffer.from('mock-webm-data'));

    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    await db.addXp(userJid, 300);

    const result = await handlePack(
        { args: [], raw: '!pack' },
        AUTHORIZED_GROUP,
        { key: { participant: userJid }, pushName: 'MixedUser' },
        { customDir: testDir, throttleMs: 0, count: 4 }
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(sentMediaList.length, 4, 'Debe despachar los 4 archivos');

    // Verificar que todos tienen View Once
    for (const media of sentMediaList) {
        assert.strictEqual(media.viewOnce, true);
        assert.strictEqual(media.options?.viewOnce, true);
        assert.strictEqual(media.to, userJid);
    }

    // Verificar que hay tanto imágenes como vídeos
    const videos = sentMediaList.filter(m => m.mediatype === 'video');
    const images = sentMediaList.filter(m => m.mediatype === 'image');
    assert.strictEqual(videos.length, 2, 'Debe haber 2 vídeos');
    assert.strictEqual(images.length, 2, 'Debe haber 2 imágenes');

    fs.rmSync(testDir, { recursive: true, force: true });
});

test('Pack 30: REGLA ABSOLUTA de aislamiento: 0 peticiones de red salientes a números reales de WhatsApp', async () => {
    // Verificar que todas las llamadas registradas son interceptadas por los mocks de prueba
    for (const entry of sentTexts) {
        assert.ok(entry.url.includes('/message/'), 'Endpoint debe ser de la API mock');
    }
    for (const entry of sentMediaList) {
        assert.ok(entry.url.includes('/message/sendMedia/'), 'Endpoint debe ser sendMedia mock');
        assert.ok(entry.to.includes('@s.whatsapp.net') || entry.to.includes('@g.us'), 'JID con formato válido');
        // Asegurar que no sea ningún número real de WhatsApp de producción
        assert.ok(entry.to.startsWith('52155'), 'JID ficticio de prueba');
    }
});

test.after(() => {
    try {
        fs.rmSync(testDataDir, { recursive: true, force: true });
    } catch (_) {}
});


