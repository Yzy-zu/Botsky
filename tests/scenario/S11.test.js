'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, raw } = require('../helpers/pipeline');

test('S11: cuota de IA comunica un siguiente paso sin filtrar diagnóstico interno', async () => {
    const f = fixture({ generate: async () => ({ ok: false, failure: { kind: 'quota', retryable: true } }) });
    try {
        const result = await f.handle(raw('111', '¿qué puedes hacer?', { private: true }));
        assert.equal(result.kind, 'error');
        assert.equal(f.sent.length, 1);
        const text = f.sent[0].args[1];
        assert.match(text, /cuota de IA/i);
        assert.match(text, /siguiente paso|Pídeme otra acción|administrador/i);
        assert.doesNotMatch(text, /Error:|\bat\s+\S+\s*\(|API_KEY|stack|^\s*(?:\[!\]|>\s*❌)/im);
    } finally { f.dispose(); }
});
