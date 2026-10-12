'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, extractUrl } = require('../src/core/parser');

test('Parser: detecta comandos simples', () => {
    const res = parse('ayuda');
    assert.equal(res.command, 'ayuda');
    assert.equal(res.args.length, 0);
});

test('Parser: extrae flags y argumentos', () => {
    const res = parse('convertir video.mp4 -f mp3 -q alta');
    assert.equal(res.command, 'convertir');
    assert.deepEqual(res.args, ['video.mp4']);
    assert.equal(res.flags.f, 'mp3');
    assert.equal(res.flags.q, 'alta');
});

test('Parser: flags booleanas', () => {
    const res = parse('sticker -a -r');
    assert.equal(res.command, 'sticker');
    assert.equal(res.flags.a, true);
    assert.equal(res.flags.r, true);
});

test('Parser: extractUrl extrae URLs de diferentes dominios', () => {
    const url = extractUrl(['mira', 'este', 'video', 'https://youtu.be/dQw4w9WgXcQ', 'perron']);
    assert.equal(url, 'https://youtu.be/dQw4w9WgXcQ');
});
