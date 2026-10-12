'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { cleanup } = require('../src/utils/cleanup');
const { getSessionKey } = require('../src/utils/session');
const { encrypt, decrypt } = require('../src/utils/crypto');

test('Utils: cleanup elimina archivos y carpetas sin crashear', () => {
    const tmpFile = path.join(os.tmpdir(), `test_cleanup_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'hello');
    assert.equal(fs.existsSync(tmpFile), true);

    cleanup(tmpFile);
    assert.equal(fs.existsSync(tmpFile), false);

    // No debe lanzar error con archivos inexistentes o null
    cleanup(null, undefined, '/tmp/archivo_inexistente_xyz_123');
});

test('Utils: getSessionKey genera claves consistentes', () => {
    // Chat privado
    const dmKey = getSessionKey('5214431234567@s.whatsapp.net');
    assert.equal(dmKey, '5214431234567@s.whatsapp.net');

    // Grupo con participant en key
    const groupKey = getSessionKey('1203630248@g.us', {
        key: { participant: '5214439999999@s.whatsapp.net' }
    });
    assert.equal(groupKey, '1203630248@g.us_5214439999999@s.whatsapp.net');
});

test('Utils: crypto encripta y desencripta con random salt', () => {
    const masterKey = 'test_master_key_1234567890abcdef';
    const secret = 'mi_super_secreto';

    const enc = encrypt(secret, masterKey);
    const parts = enc.split(':');
    assert.equal(parts.length, 4, 'Debe tener 4 partes: salt:iv:tag:data');

    const dec = decrypt(enc, masterKey);
    assert.equal(dec, secret);
});

test('Utils: crypto soporta formato legado con salt fijo', () => {
    const cryptoMod = require('crypto');
    const masterKey = 'test_master_key_legacy_123';
    const secret = 'token_viejo_guardado';

    const key = cryptoMod.scryptSync(masterKey, 'salt', 32);
    const iv = cryptoMod.randomBytes(12);
    const cipher = cryptoMod.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(secret, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    const legacyFormat = `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
    const dec = decrypt(legacyFormat, masterKey);
    assert.equal(dec, secret);
});

test("Utils & Descargar: exportan getDownloadSessionKey correctamente", () => {
    const { getDownloadSessionKey: fromSession } = require("../src/utils/session");
    const { getDownloadSessionKey: fromDescargar } = require("../src/commands/descargar");

    assert.equal(typeof fromSession, "function");
    assert.equal(typeof fromDescargar, "function");

    assert.equal(fromSession("user@s.whatsapp.net"), "user@s.whatsapp.net");
    assert.equal(fromDescargar("user@s.whatsapp.net"), "user@s.whatsapp.net");
    assert.equal(fromDescargar("group@g.us", { key: { participant: "part@s.whatsapp.net" } }), "group@g.us_part@s.whatsapp.net");
});
