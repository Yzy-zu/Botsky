'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const sqlite3 = require('sqlite3');
const sharp = require('/home/petrov/petrovsky/backend/node_modules/sharp');
const { createLibrary } = require('/home/petrov/petrovsky/backend/rikolino_library');

// Aislamiento de base de datos de pruebas para botsky
const testDataDir = path.join(os.tmpdir(), `botsky-antirep-db-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
process.env.DATA_DIR = testDataDir;

const db = require('../src/services/db');
const evolution = require('../src/services/evolution');
const { createRikolinoReader } = require('../src/services/rikolinoLibrary');
const { getLocalPackImages, getPackImages } = require('../src/services/packImages');
const { getLocalImage, getCooperachaImage } = require('../src/services/cooperachaImages');
const { handlePack } = require('../src/commands/pack');
const { startCooperacha, completeCooperacha, expireCooperacha, activeSessions } = require('../src/commands/cooperacha');

const fixtureImage = color => sharp({ create: { width: 5, height: 5, channels: 3, background: color } }).png().toBuffer();

async function createRikolinoFixture(t) {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-rikolino-antirep-'));
    const prevDir = process.env.RIKOLINO_DIR;
    process.env.RIKOLINO_DIR = rootDir;
    const library = createLibrary({ rootDir });
    await library.ready;
    t.after(async () => {
        if (prevDir !== undefined) process.env.RIKOLINO_DIR = prevDir;
        else delete process.env.RIKOLINO_DIR;
        await library.close();
        await fs.rm(rootDir, { recursive: true, force: true });
    });
    return { library, rootDir, reader: createRikolinoReader({ rootDir }) };
}

test('Anti-Repetición 1: Persistencia SQLite (getDeliveredPhotoIds, recordDeliveredPhotos, clearDeliveredPhotoHistory)', async () => {
    const userJid = '5215500000001@s.whatsapp.net';
    const groupJid = '120363999999999999@g.us';
    const category = 'carros';

    // 1. Vacío inicial
    const initialUser = await db.getDeliveredPhotoIds('user', userJid, category);
    assert.equal(initialUser.size, 0);

    // 2. Registrar entregas para usuario
    await db.recordDeliveredPhotos('user', userJid, category, ['foto-1', 'foto-2']);
    const afterUser = await db.getDeliveredPhotoIds('user', userJid, category);
    assert.equal(afterUser.size, 2);
    assert.ok(afterUser.has('foto-1'));
    assert.ok(afterUser.has('foto-2'));
    assert.ok(!afterUser.has('foto-3'));

    // 3. Diferente categoría o scope no interfiere
    const otherCat = await db.getDeliveredPhotoIds('user', userJid, 'motos');
    assert.equal(otherCat.size, 0);

    const groupHistory = await db.getDeliveredPhotoIds('group', groupJid, category);
    assert.equal(groupHistory.size, 0);

    // 4. Registrar para grupo
    await db.recordDeliveredPhotos('group', groupJid, category, ['foto-1']);
    const afterGroup = await db.getDeliveredPhotoIds('group', groupJid, category);
    assert.equal(afterGroup.size, 1);
    assert.ok(afterGroup.has('foto-1'));

    // 5. Limpieza de ciclo / reinicio
    await db.clearDeliveredPhotoHistory('user', userJid, category);
    const clearedUser = await db.getDeliveredPhotoIds('user', userJid, category);
    assert.equal(clearedUser.size, 0);

    // Grupo conserva su historial intacto tras limpiar usuario
    const stillGroup = await db.getDeliveredPhotoIds('group', groupJid, category);
    assert.equal(stillGroup.size, 1);
});

test('Anti-Repetición 2: RikolinoReader filtra fotos vistas y resetea mazo al completarse', async t => {
    const { library, reader } = await createRikolinoFixture(t);

    const p1 = await library.upload(await fixtureImage('red'), 'red.png');
    const p2 = await library.upload(await fixtureImage('green'), 'green.png');
    const p3 = await library.upload(await fixtureImage('blue'), 'blue.png');
    const p4 = await library.upload(await fixtureImage('yellow'), 'yellow.png');

    const album = await library.saveAlbum(null, { name: 'Colores', slug: 'colores', selectionMode: 'ordered' });
    await library.membership(album.id, [p1.id, p2.id, p3.id, p4.id]);
    await library.saveAlbum(album.id, { published: true });

    // Primera extracción: pide 2 fotos sin exclusiones
    const draw1 = await reader.getImages('colores', { count: 2, excludePhotoIds: [] });
    assert.equal(draw1.length, 2);
    assert.equal(draw1[0].id, p1.id);
    assert.equal(draw1[1].id, p2.id);
    assert.equal(draw1[0].deckCycled, false);

    // Segunda extracción: excluye p1 y p2
    const draw2 = await reader.getImages('colores', { count: 2, excludePhotoIds: [p1.id, p2.id] });
    assert.equal(draw2.length, 2);
    assert.equal(draw2[0].id, p3.id);
    assert.equal(draw2[1].id, p4.id);
    assert.equal(draw2[0].deckCycled, false);

    // Tercera extracción: excluye todas las 4 fotos (álbum completado!)
    // Debe detectar deckCycled: true y entregar fotos barajadas del nuevo ciclo
    const draw3 = await reader.getImages('colores', { count: 2, excludePhotoIds: [p1.id, p2.id, p3.id, p4.id] });
    assert.equal(draw3.length, 2);
    assert.equal(draw3[0].deckCycled, true);
});

test('Anti-Repetición 3: Packs consecutivos del usuario no repiten fotos hasta agotar álbum', async t => {
    const { library, reader, rootDir } = await createRikolinoFixture(t);

    const p1 = await library.upload(await fixtureImage('red'), 'red.png');
    const p2 = await library.upload(await fixtureImage('green'), 'green.png');
    const p3 = await library.upload(await fixtureImage('blue'), 'blue.png');
    const p4 = await library.upload(await fixtureImage('yellow'), 'yellow.png');
    const p5 = await library.upload(await fixtureImage('purple'), 'purple.png');
    const p6 = await library.upload(await fixtureImage('cyan'), 'cyan.png');

    const album = await library.saveAlbum(null, { name: 'Autos', slug: 'autos', selectionMode: 'ordered' });
    await library.membership(album.id, [p1.id, p2.id, p3.id, p4.id, p5.id, p6.id]);
    await library.saveAlbum(album.id, { published: true });

    const buyerJid = '5215588888888@s.whatsapp.net';
    await db.addXp(buyerJid, 1000);

    const sentMedia = [];
    evolution.client.post = async (url, data) => {
        if (data?.mediatype) sentMedia.push(data);
        return { data: { status: 'SUCCESS', key: { id: 'mock_test_id' } } };
    };

    // Compra 1: pide 3 fotos
    const res1 = await handlePack(
        { args: ['autos'] },
        buyerJid,
        {},
        {
            count: 3,
            throttleMs: 0,
            getPackImages: (cat, opts) => reader.getImages(cat, opts)
        }
    );
    assert.equal(res1.success, true);
    assert.equal(res1.images_sent, 3);
    assert.equal(res1.deckCycled, false);

    // Verificar en BD que se guardaron 3 fotos vistas
    const seenAfter1 = await db.getDeliveredPhotoIds('user', buyerJid, 'autos');
    assert.equal(seenAfter1.size, 3);
    assert.ok(seenAfter1.has(p1.id));
    assert.ok(seenAfter1.has(p2.id));
    assert.ok(seenAfter1.has(p3.id));

    // Compra 2: pide 3 fotos (deben ser las 3 restantes: p4, p5, p6)
    const res2 = await handlePack(
        { args: ['autos'] },
        buyerJid,
        {},
        {
            count: 3,
            throttleMs: 0,
            getPackImages: (cat, opts) => reader.getImages(cat, opts)
        }
    );
    assert.equal(res2.success, true);
    assert.equal(res2.images_sent, 3);
    assert.equal(res2.deckCycled, false);

    const seenAfter2 = await db.getDeliveredPhotoIds('user', buyerJid, 'autos');
    assert.equal(seenAfter2.size, 6);
    assert.ok(seenAfter2.has(p4.id));
    assert.ok(seenAfter2.has(p5.id));
    assert.ok(seenAfter2.has(p6.id));

    // Compra 3: pide 3 fotos más -> ¡Álbum completado!
    // Debe marcar deckCycled: true y reiniciar el ciclo
    const res3 = await handlePack(
        { args: ['autos'] },
        buyerJid,
        {},
        {
            count: 3,
            throttleMs: 0,
            getPackImages: (cat, opts) => reader.getImages(cat, opts)
        }
    );
    assert.equal(res3.success, true);
    assert.equal(res3.deckCycled, true);

    // El historial se limpió y ahora solo contiene las nuevas 3 de la nueva vuelta
    const seenAfter3 = await db.getDeliveredPhotoIds('user', buyerJid, 'autos');
    assert.equal(seenAfter3.size, 3);
});

test('Anti-Repetición 4: Cooperachas consecutivas en grupo no repiten la foto destapada', async t => {
    const { library, reader } = await createRikolinoFixture(t);

    const p1 = await library.upload(await fixtureImage('red'), 'red.png');
    const p2 = await library.upload(await fixtureImage('green'), 'green.png');

    const album = await library.saveAlbum(null, { name: 'Misterio', slug: 'misterio', photoCount: 2, selectionMode: 'ordered' });
    await library.membership(album.id, [p1.id, p2.id]);
    await library.saveAlbum(album.id, { published: true });

    const groupJid = '120363555555555555@g.us';
    const donorJid = '5215577777777@s.whatsapp.net';
    await db.addXp(donorJid, 2000);

    evolution.client.post = async () => ({ data: { status: 'SUCCESS', key: { id: 'mock_test_id' } } });

    // Iniciar y completar 1ra cooperacha
    const session1 = await startCooperacha(groupJid, {}, {
        targetXp: 100,
        category: 'misterio',
        skipAuth: true,
        customDir: null
    });
    // Simular que el lector usa reader
    session1.photoId = p1.id;
    session1.category = 'misterio';
    activeSessions.set(groupJid, session1);

    const completed1 = await completeCooperacha(groupJid);
    assert.equal(completed1.status, 'completed');

    // Verificar en BD que el grupo ya tiene registrada la foto 1
    const groupSeen1 = await db.getDeliveredPhotoIds('group', groupJid, 'misterio');
    assert.equal(groupSeen1.size, 1);
    assert.ok(groupSeen1.has(p1.id));

    // Si una cooperacha expira sin completarse, la foto NO se registra
    const sessionExpired = {
        groupJid,
        targetXp: 100,
        currentXp: 50,
        contributors: new Map(),
        photoId: p2.id,
        category: 'misterio',
        status: 'active'
    };
    activeSessions.set(groupJid, sessionExpired);
    await expireCooperacha(groupJid);

    // El historial sigue teniendo solo 1 foto (la completada)
    const groupSeenAfterExpired = await db.getDeliveredPhotoIds('group', groupJid, 'misterio');
    assert.equal(groupSeenAfterExpired.size, 1);
    assert.ok(!groupSeenAfterExpired.has(p2.id));
});
