'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, raw } = require('../helpers/pipeline');
const { createSystemInfoFeature } = require('../../src/v2/features/system-info/manifest');

const snapshot = {
    version: 'v2.3.1', uptimeMs: 125 * 60_000,
    queue: { pending: 2, running: 1 }, sessions: 4, ai: 'degraded', memoryMb: 128,
    details: ['Circuit breaker: 1 proveedor degradado', 'Último chequeo: correcto']
};

function statusFeature() {
    return createSystemInfoFeature({ getStatus: async () => snapshot });
}

function routeByRequest() {
    return async request => {
        const input = JSON.parse(request.messages.at(-1).parts[0].text);
        const detail = /detallado/i.test(input.text);
        return { ok: true, data: { text: JSON.stringify({ kind: 'intent', intent: 'system-info.status', args: detail ? { detail: true } : {} }), parts: [], toolCalls: [], provider: 'fake' } };
    };
}

test('S10: estado breve conserva seis líneas y el modo detallado agrega el diagnóstico', async () => {
    const f = fixture({ features: [statusFeature()], generate: routeByRequest() });
    try {
        const brief = await f.handle(raw('101', 'estado del servidor', { private: true }));
        assert.equal(brief.kind, 'reply');
        const briefText = f.sent.at(-1).args[1];
        assert.equal(briefText.split('\n').length, 6);
        assert.match(briefText, /^Botsky · v2\.3\.1/m);
        assert.match(briefText, /Cola: 2 pendientes, 1 en curso/);
        assert.doesNotMatch(briefText, /Circuit breaker/);

        const detailed = await f.handle(raw('102', 'estado del servidor detallado', { private: true }));
        assert.equal(detailed.kind, 'reply');
        const detailedText = f.sent.at(-1).args[1];
        assert.equal(detailedText.split('\n').length, 8);
        assert.match(detailedText, /Circuit breaker: 1 proveedor degradado/);
        assert.match(detailedText, /Último chequeo: correcto/);
    } finally { f.dispose(); }
});
