'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, raw } = require('../helpers/pipeline');
const { AppError } = require('../../src/v2/domain/errors');

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

test('S11: typed quota from a feature reaches the user with next step and duplicate delivery stays suppressed', async () => {
    let attempts = 0;
    const feature = { id:'quota-feature', commands:[{ name:'do', aliases:[], scope:['private','group'], access:'public', tier:'none',
        help:{short:'Quota test',examples:[]}, handler:async()=>{ attempts++; throw new AppError('quota'); } }],
        intents:[{id:'quota.do',description:'Run quota test',schema:{type:'object'},command:'do'}] };
    const f = fixture({ features:[feature], plan:{kind:'intent',intent:'quota.do',args:{}} });
    try {
        const event = raw('112', 'run quota test', {private:true});
        const result = await f.handle(event);
        assert.equal(result.kind, 'error');
        assert.equal(f.sent.length, 1);
        assert.match(f.sent[0].args[1], /cuota de IA/i);
        assert.match(f.sent[0].args[1], /administrador/i);
        await f.handle(event);
        assert.equal(attempts, 1);
        assert.equal(f.sent.length, 1);
        assert.equal(f.requests.length, 1);
    } finally { f.dispose(); }
});
