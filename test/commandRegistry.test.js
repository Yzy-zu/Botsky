'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const test = require('node:test');
const assert = require('node:assert/strict');
const { isRegisteredCommand, getRegisteredCommands, getCommandHandler } = require('../src/core/commandRegistry');

test('Registry: reconoce comandos registrados y aliases', () => {
    assert.equal(isRegisteredCommand('descargar'), true);
    assert.equal(isRegisteredCommand('dl'), true);
    assert.equal(isRegisteredCommand('tiktok'), true);
    assert.equal(isRegisteredCommand('video'), true);
    assert.equal(isRegisteredCommand('videos'), true);
    assert.equal(isRegisteredCommand('youtube'), true);
    assert.equal(isRegisteredCommand('yt'), true);
    assert.equal(isRegisteredCommand('buscavideo'), true);
    assert.equal(isRegisteredCommand('musica'), true);
    assert.equal(isRegisteredCommand('cancion'), true);
    assert.equal(isRegisteredCommand('minecraft'), true);
    assert.equal(isRegisteredCommand('vps'), true);
    assert.equal(isRegisteredCommand('linux'), true);
    assert.equal(isRegisteredCommand('stickers'), true);
    assert.equal(isRegisteredCommand('calca'), true);
    assert.equal(isRegisteredCommand('afinidad'), true);
    assert.equal(isRegisteredCommand('karma'), true);
    assert.equal(isRegisteredCommand('relacion'), true);
    assert.equal(isRegisteredCommand('rencor'), true);
    assert.equal(isRegisteredCommand('ayuda'), true);
    assert.equal(isRegisteredCommand('help'), true);
    assert.equal(isRegisteredCommand('convertir'), true);
    assert.equal(isRegisteredCommand('cv'), true);
    assert.equal(isRegisteredCommand('maicra'), true);

    assert.equal(isRegisteredCommand('comando_que_no_existe_xyz'), false);
});

test('Registry: getRegisteredCommands retorna lista no vacía', () => {
    const list = getRegisteredCommands();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 30);
    assert.ok(list.includes('descargar'));
});

test('Registry: asigna los tiers de cola correctamente', async () => {
    const resHeavy = await getCommandHandler('descargar', { parsed: { args: [] }, from: '123' });
    assert.equal(resHeavy.queueTier, 'heavy');

    const resLight = await getCommandHandler('sticker', { parsed: { args: [] }, from: '123' });
    assert.equal(resLight.queueTier, 'light');

    const resNull = await getCommandHandler('ayuda', { parsed: { args: [] }, from: '123' });
    assert.equal(resNull.queueTier, null);
});

test('Registry: musica asigna formato mp3 por defecto para descargas de audio', async () => {
    const parsed = { args: ['peso pluma'], flags: {} };
    const res = await getCommandHandler('musica', { parsed, from: '123' });
    assert.equal(res.queueTier, 'heavy');
    assert.equal(parsed.flags.f, 'mp3');
});

test('Registry: reconoce recortarpdf y aliases con queueTier light', async () => {
    assert.equal(isRegisteredCommand('recortar'), true);
    assert.equal(isRegisteredCommand('recortarpdf'), true);
    assert.equal(isRegisteredCommand('cortar'), true);
    assert.equal(isRegisteredCommand('cortarpdf'), true);
    assert.equal(isRegisteredCommand('extraerpdf'), true);

    const res = await getCommandHandler('recortar', { parsed: { args: ['1-5'], flags: {} }, from: '123' });
    assert.equal(res.queueTier, 'light');
    assert.equal(typeof res.handler, 'function');
});

