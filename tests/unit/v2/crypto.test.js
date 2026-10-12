'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {encrypt,decrypt} = require('../../../src/v2/platform/crypto');
const legacy = require('../../../src/utils/crypto');
test('modern tokens roundtrip with random salt and authenticated integrity', () => {
    const a=encrypt('hola 👀','test-master'); const b=encrypt('hola 👀','test-master');
    assert.notEqual(a,b); assert.equal(decrypt(a,'test-master'),'hola 👀');
    assert.throws(()=>decrypt(a,'wrong-key')); assert.throws(()=>decrypt(a.slice(0,-2)+'ff','test-master'));
    assert.equal(decrypt(encrypt('','test-master'),'test-master'),'');
});
test('reads fixed-salt three-part token created with legacy AES GCM parameters', () => {
    const iv=Buffer.alloc(12,3); const cipher=crypto.createCipheriv('aes-256-gcm',crypto.scryptSync('test-master','salt',32),iv);
    const data=cipher.update('legacy token','utf8','hex')+cipher.final('hex');
    const token=[iv.toString('hex'),cipher.getAuthTag().toString('hex'),data].join(':');
    assert.equal(decrypt(token,'test-master'),'legacy token');
    for (const bad of ['abc', 'zz:'+token, '00:00:00',token+':extra']) assert.throws(()=>decrypt(bad,'test-master'));
});
test('modern token format remains interoperable with the actual legacy implementation', () => {
    const text = 'synthetic migration token 👀';
    const key = 'synthetic-migration-master';
    assert.equal(decrypt(legacy.encrypt(text, key), key), text);
    assert.equal(legacy.decrypt(encrypt(text, key), key), text);
});
