'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const sqlite3 = require('sqlite3');
const sharp = require('/home/petrov/petrovsky/backend/node_modules/sharp');
const { createLibrary } = require('/home/petrov/petrovsky/backend/rikolino_library');
const { createRikolinoReader } = require('../src/services/rikolinoLibrary');

const fixtureImage = color => sharp({ create: { width: 5, height: 5, channels: 3, background: color } }).png().toBuffer();
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
async function fixture(t) {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-rikolino-'));
    const library = createLibrary({ rootDir }); await library.ready;
    t.after(async () => { await library.close(); await fs.rm(rootDir, { recursive: true, force: true }); });
    return { library, rootDir, reader: createRikolinoReader({ rootDir, random: () => 0.999 }) };
}
async function photo(library, color) { return library.upload(await fixtureImage(color), `${color}.png`); }
async function publishedAlbum(library, name, photos, extra = {}) {
    const album = await library.saveAlbum(null, { name, photoCount: 1, ...extra });
    await library.membership(album.id, photos.map(row => row.id));
    await library.saveAlbum(album.id, { published: true });
    return album;
}
async function editDb(rootDir, sql, values = []) {
    const db = await new Promise((resolve, reject) => { const d = new sqlite3.Database(path.join(rootDir, 'library.db'), error => error ? reject(error) : resolve(d)); });
    try { await new Promise((resolve, reject) => db.run(sql, values, error => error ? reject(error) : resolve())); }
    finally { await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())); }
}
async function isolatedModule(file, dependencies, extra = {}) {
    const source = await fs.readFile(file, 'utf8');
    const module = { exports: {} };
    const sandbox = { module, exports: module.exports, Buffer, console, setTimeout, clearTimeout, process: { env: {} }, ...extra,
        require: name => { if (Object.hasOwn(dependencies, name)) return dependencies[name]; if (['fs', 'path', 'os'].includes(name)) return require(name); throw new Error(`Dependencia no aislada: ${name}`); }
    };
    vm.runInNewContext(source, sandbox, { filename: file });
    return module.exports;
}
const logger = { warn() {}, error() {}, info() {} };

test('lector integra factory real Petrovsky: publicación, nombres, papelera, asociaciones y cambios inmediatos', async t => {
    const { library, rootDir, reader } = await fixture(t);
    const photos = await Promise.all(['red', 'green', 'blue'].map(color => photo(library, color)));
    const privateAlbum = await library.saveAlbum(null, { name: 'Privado' });
    await library.membership(privateAlbum.id, [photos[2].id]);
    const album = await publishedAlbum(library, 'Vacaciones Épicas', photos.slice(0, 2), { slug: 'vacaciones' });
    await publishedAlbum(library, 'Segundo', [photos[0]]);
    assert.equal((await reader.getImages()).length, 2); // dedup entre álbumes
    assert.equal((await reader.getImages('VACACIONES')).length, 2);
    assert.equal((await reader.getImages('  Vacaciones   Epicas  ')).length, 2);
    assert.equal((await reader.getImages('Privado')).length, 0);
    assert.equal((await reader.getImages('vaca')).length, 0); // exacto, no substring
    assert.equal((await reader.getImages("' OR 1=1 --")).length, 0);
    assert.equal((await reader.getImages('vacaciones', { count: 1 })).length, 1);
    const first = (await reader.getImages('vacaciones'))[0];
    assert.equal(first.source, 'rikolino'); assert.equal(first.isTemporary, false);
    assert.equal(path.dirname(first.path), path.join(rootDir, 'originals'));
    await library.saveAlbum(album.id, { name: 'Renombrado', slug: 'nuevo', photoCount: 2, priceXp: 450, selectionMode: 'ordered' });
    await library.batch([photos[1].id], 'trash');
    assert.equal((await reader.getImages('vacaciones')).length, 0);
    assert.equal((await reader.getImages('nuevo')).length, 1); // available=false NO altera reglas proveedor
    await library.batch([photos[1].id], 'restore');
    await library.order(album.id, [photos[1].id, photos[0].id]);
    assert.equal((await reader.getImages('Renombrado')).length, 2); // sin cambiar selección random existente
    await library.membership(album.id, [photos[1].id], true);
    assert.equal((await reader.getImages('nuevo')).length, 1);
    await library.saveAlbum(album.id, { published: false });
    assert.equal((await reader.getImages('nuevo')).length, 0);
    await library.deleteAlbum(album.id);
    assert.equal((await reader.getImages()).length, 1); // Segundo conserva foto
});

test('apertura solo lectura no crea DB, no cambia bytes y libera conexiones corruptas', async t => {
    const { library, rootDir, reader } = await fixture(t);
    await publishedAlbum(library, 'Fotos', [await photo(library, 'red')]);
    const before = sha(await fs.readFile(path.join(rootDir, 'library.db')));
    await Promise.all(Array.from({ length: 10 }, () => reader.getImages()));
    assert.equal(sha(await fs.readFile(path.join(rootDir, 'library.db'))), before);
    const missing = path.join(rootDir, 'missing');
    assert.equal((await createRikolinoReader({ rootDir: missing }).getImages()).length, 0);
    await assert.rejects(fs.stat(missing), { code: 'ENOENT' });
    const corrupt = path.join(rootDir, 'corrupt'); await fs.mkdir(path.join(corrupt, 'originals'), { recursive: true });
    await fs.writeFile(path.join(corrupt, 'library.db'), 'not sqlite');
    assert.equal((await createRikolinoReader({ rootDir: corrupt }).getImages()).length, 0);
    assert.equal((await reader.getImages(null, { count: 0 })).length, 0);
});

test('paths manipuladas, symlinks, archivos ausentes y directorios no escapan originales', async t => {
    const { library, rootDir, reader } = await fixture(t);
    const p = await photo(library, 'red'); await publishedAlbum(library, 'Fotos', [p]);
    const absolute = (await library.media(p.id, 'original')).path;
    await editDb(rootDir, 'UPDATE photos SET originalPath=? WHERE id=?', ['../secret.png', p.id]);
    assert.equal((await reader.getImages()).length, 0);
    await editDb(rootDir, 'UPDATE photos SET originalPath=? WHERE id=?', [`originals/${p.id}.png`, p.id]);
    const saved = await fs.readFile(absolute); await fs.unlink(absolute);
    await fs.writeFile(path.join(rootDir, 'outside.png'), saved);
    await fs.symlink(path.join(rootDir, 'outside.png'), absolute);
    assert.equal((await reader.getImages()).length, 0);
    await fs.unlink(absolute); await fs.mkdir(absolute);
    assert.equal((await reader.getImages()).length, 0);
    await fs.rmdir(absolute);
    assert.equal((await reader.getImages()).length, 0);
    await fs.writeFile(absolute, saved);
    assert.equal((await reader.getImages()).length, 1);
});

test('proveedor packImages usa Rikolino sin web, vacío sin fallback; customDir explícito preserva legado', async t => {
    const { library, rootDir, reader } = await fixture(t);
    let calls = 0; const categories = [];
    const packImages = await isolatedModule(path.join(__dirname, '../src/services/packImages.js'), {
        axios: { get: async () => { calls++; throw new Error('Red bloqueada'); } }, './logger': logger,
        './rikolinoLibrary': { createRikolinoReader: () => ({ getImages: (category, options) => { categories.push(category); return reader.getImages(category, options); } }) }
    });
    assert.equal((await packImages.getPackImages('nada', { count: 3 })).length, 0);
    assert.equal(calls, 0);
    const photos = await Promise.all(['red', 'green', 'blue'].map(color => photo(library, color)));
    await publishedAlbum(library, 'Flores', photos, { slug: 'flores' });
    assert.equal((await packImages.getPackImages('de flores porfa', { count: 2 })).length, 2);
    assert.equal(categories.at(-1), 'flores');
    const legacy = path.join(rootDir, 'legacy'); await fs.mkdir(legacy);
    await fs.writeFile(path.join(legacy, 'legacy.jpg'), 'legacy fixture');
    const local = await packImages.getPackImages(null, { count: 1, customDir: legacy });
    assert.equal(local[0].source, 'local'); assert.equal(calls, 0);
    assert.equal((await packImages.getPackImages(null, { count: 5 })).length, 3);
    assert.equal(calls, 0);
});

test('handler pack sin modificar conserva 150XP, cantidad caller, privado viewOnce y reembolso actual', async t => {
    const { library, reader } = await fixture(t);
    const photos = await Promise.all(['red', 'green', 'blue'].map(color => photo(library, color)));
    await publishedAlbum(library, 'Conectado', photos, { priceXp: 999, photoCount: 1, selectionMode: 'ordered' });
    let xp = 500; const media = [];
    const buyer = '5215512345678@s.whatsapp.net';
    const packImages = await isolatedModule(path.join(__dirname, '../src/services/packImages.js'), {
        axios: { get: () => { throw new Error('Red prohibida'); } }, './logger': logger,
        './rikolinoLibrary': { createRikolinoReader: () => reader }
    });
    const pack = await isolatedModule(path.join(__dirname, '../src/commands/pack.js'), {
        '../services/evolution': { sendText: async () => {}, sendMedia: async (...args) => media.push(args) },
        '../services/db': { getOrCreateUser: async () => ({ xp }), deductUserXpAtomic: async (jid, amount) => { assert.equal(amount, 150); if (xp < amount) return { success: false, balance: xp }; xp -= amount; return { success: true, balance: xp }; }, refundUserXp: async (jid, amount) => { xp += amount; } },
        '../services/logger': logger, '../core/auth': { getSenderJid: () => buyer, cleanJidNumber: () => '5215512345678' }, '../services/packImages': packImages
    });
    const result = await pack.handlePack({ args: ['Conectado'] }, buyer, {}, { count: 3, throttleMs: 0 });
    assert.equal(result.success, true); assert.equal(result.cost, 150); assert.equal(xp, 350);
    assert.equal(media.length, 3); assert.ok(media.every(args => args[0] === buyer && args[3].viewOnce && args[7].viewOnce));
    const unavailable = await pack.handlePack({ args: ['desconocido'] }, buyer, {}, { count: 3, throttleMs: 0 });
    assert.equal(unavailable.reason, 'CONTENT_UNAVAILABLE'); assert.equal(unavailable.refunded, true); assert.equal(xp, 350);
    assert.equal(media.length, 3);
});
