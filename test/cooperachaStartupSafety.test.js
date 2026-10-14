'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

async function loadCooperacha({ getImage }) {
    const filename = path.resolve(__dirname, '../src/commands/cooperacha.js');
    const source = await fs.readFile(filename, 'utf8');
    const sent = [];
    const module = { exports: {} };
    const deps = {
        '../services/evolution': { sendText: async (to, text) => sent.push({ to, text }), sendMedia: async () => {} },
        '../services/db': { getDeliveredPhotoIds: async () => new Set() },
        '../services/logger': { warn() {}, error() {}, info() {} },
        '../services/imageCensor': { generateCensoredImage: async value => value },
        '../services/cooperachaImages': { getCooperachaImage: getImage },
        '../services/packImages': { cleanCategory: value => value }
    };
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        Buffer,
        process: { env: {} },
        console,
        Date,
        Math,
        Map,
        Set,
        Promise,
        Number,
        String,
        Array,
        Object,
        setTimeout: () => ({ unref() {} }),
        clearTimeout() {},
        require(name) {
            if (deps[name]) return deps[name];
            if (name === 'fs') return require('node:fs');
            if (name === 'path') return path;
            throw new Error(`Unexpected dependency: ${name}`);
        }
    }, { filename });
    return { api: module.exports, sent };
}

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

test('simultaneous starts in one group reserve the group and emit one no-image warning', async () => {
    const gate = deferred();
    let providerCalls = 0;
    const { api, sent } = await loadCooperacha({ getImage: async () => { providerCalls++; await gate.promise; return null; } });
    const group = '120363000000000001@g.us';

    const first = api.startCooperacha(group, {}, { authorized: true });
    const second = await api.startCooperacha(group, {}, { authorized: true });
    assert.equal(second, null);
    gate.resolve();
    assert.equal(await first, null);

    assert.equal(providerCalls, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /No pude conseguir una imagen/);
});

test('in-flight reservation is per group and releases after provider rejection', async () => {
    const gate = deferred();
    const calls = [];
    const { api, sent } = await loadCooperacha({ getImage: async (_category, options) => {
        calls.push(options);
        await gate.promise;
        throw new Error('synthetic provider failure');
    } });
    const a = api.startCooperacha('120363000000000001@g.us', {}, { authorized: true });
    const b = api.startCooperacha('120363000000000002@g.us', {}, { authorized: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 2, 'different groups proceed independently');
    gate.resolve();
    await Promise.all([assert.rejects(a, /synthetic provider failure/), assert.rejects(b, /synthetic provider failure/)]);

    await assert.rejects(api.startCooperacha('120363000000000001@g.us', {}, { authorized: true }), /synthetic provider failure/);
    assert.equal(calls.length, 3, 'finally releases the failed group reservation');
    assert.equal(sent.length, 0);
});

test('missing category match gets precise safe guidance without echoing requested category', async () => {
    const { api, sent } = await loadCooperacha({ getImage: async () => null });
    await api.startCooperacha('120363000000000003@g.us', {}, { authorized: true, category: 'private category name' });
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /No encontré una imagen disponible para esa categoría/);
    assert.match(sent[0].text, /Pide el reto sin categoría/);
    assert.doesNotMatch(sent[0].text, /private category name/i);
});
