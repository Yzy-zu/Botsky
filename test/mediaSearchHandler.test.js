'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(result) {
    const searches = [], texts = [], failures = [], logs = [], feedbackCalls = [];
    const deps = {
        fs: { mkdirSync() {} }, path,
        '../services/evolution': { sendText: async (to, text) => texts.push(text), sendMedia: async () => { throw Error('No media'); } },
        '../core/parser': { extractUrl: () => null },
        '../services/logger': { info: (...args) => logs.push(args), error() {}, warn() {} },
        '../services/progress': { Progress: class { async start() {} async fail(text) { failures.push(text); } async done() {} } },
        '../services/drive': {},
        '../services/mediaSearch': { searchMedia: async (...args) => { searches.push(args); return result; } },
        '../services/operationFeedback': { searchFailureMessage: state => { feedbackCalls.push(state); return 'search_' + state.status; } },
        '../utils/thumbnailCollage': { generateThumbnailCollage: async () => null }
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/commands/descargar.js'), 'utf8'), {
        module, exports: module.exports, process: { env: {} },
        require: id => { if (!(id in deps)) throw Error('Unmocked dependency: ' + id); return deps[id]; }
    });
    return { api: module.exports, searches, texts, failures, logs, feedbackCalls };
}

const message = { key: { participant: 'owner@s.whatsapp.net' } };
const chat = 'group@g.us';
const key = `${chat}_${message.key.participant}`;
const parsed = { args: ['-10 ejercicios de física'], flags: {}, semanticDecision: { action: 'descargar' }, raw: 'otra consulta que no debe usarse' };

test('Handler mantiene consulta semántica, muestra duración desconocida y guarda opciones', async () => {
    const item = { title: 'Curso directo', url: 'https://www.youtube.com/watch?v=abcdefghijk', duration: null, secs: null };
    const h = harness({ status: 'success', provider: 'youtube', items: [item], diagnostic: { code: 'results', accepted: 1 } });
    await h.api.handleDescargar(parsed, chat, message);
    assert.equal(h.searches.length, 1);
    assert.equal(h.searches[0][0], '-10 ejercicios de física');
    assert.match(h.texts[0], /duración no disponible/);
    assert.doesNotMatch(h.texts[0], /null|N\/A|escribe bien/);
    assert.equal(h.api.getSearchSession(key).results[0].url, item.url);
    assert.equal(JSON.stringify(h.logs).includes('ejercicios'), false);
});

test('Handler distingue vacío, proveedor caído y solicitud inválida sin crear opciones', async () => {
    for (const status of ['empty', 'unavailable', 'invalid']) {
        const state = { status, provider: 'youtube', items: [], diagnostic: { code: 'technical_code' } };
        const h = harness(state);
        h.api.setSearchSession(key, { results: [{ title: 'Opciones de otra consulta' }] });
        await h.api.handleDescargar(parsed, chat, message);
        assert.equal(h.feedbackCalls[0], state);
        assert.equal(h.failures[0], 'search_' + status);
        assert.equal(h.api.getSearchSession(key), null);
        assert.equal(h.texts.length, 0);
    }
});

test('Sin consulta pregunta en lenguaje natural sin imponer prefijo', async () => {
    const h = harness({ status: 'success', items: [] });
    await h.api.handleDescargar({ args: [], semanticDecision: { action: 'descargar' } }, chat, message);
    assert.equal(h.searches.length, 0);
    assert.match(h.failures[0], /video o canción/);
    assert.doesNotMatch(h.failures[0], /\/@/);
});

test('Wrapper de compatibilidad mantiene la lista para consumidores antiguos', async () => {
    const item = { title: 'Curso', url: 'https://www.youtube.com/watch?v=abcdefghijk' };
    const h = harness({ status: 'success', items: [item] });
    assert.equal((await h.api.searchYoutubeList('curso'))[0], item);
});
