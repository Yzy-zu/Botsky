'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiAdapter } = require('../../src/v2/adapters/ai');
const { validateSchema } = require('../../src/v2/adapters/ai/schema');
const { FakeClock } = require('../../src/v2/platform/clock');
const request = extra => ({ task: 'chat', messages: [{ role: 'user', parts: [{ text: 'hello' }] }], budget: { maxOutputTokens: 120, timeoutMs: 1000 }, ...extra });
const gemini = parts => ({ data: { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts } }] } });
function adapter(post, config = { GEMINI_API_KEY: ['fake-key'] }) {
    const clock = new FakeClock();
    const calls = [];
    const api = createAiAdapter({ clock, config: () => config, http: { post: async (...args) => { calls.push(args); return post(clock, ...args); } } });
    return { api, clock, calls };
}
test('schema rejects malformed keywords and unsupported nested keywords even when property is absent', () => {
    for (const schema of [
        { type: 'object', required: 'action' },
        { type: 'object', properties: { optional: { pattern: 'unsupported' } } },
        { type: 'object', additionalProperties: { type: 'string' } },
        { type: 'object', properties: { optional: null } },
        { type: 'array', items: false },
        { type: 'number', minimum: 'one' }
    ]) assert.equal(validateSchema(schema.type === 'array' ? [] : schema.type === 'number' ? 1 : {}, schema), false);
});
test('unconstrained schema still enforces bounded JSON depth and plain JSON values', () => {
    let nested = {};
    for (let n = 0; n < 30; n++) nested = { child: nested };
    assert.equal(validateSchema({ payload: nested }, { type: 'object' }), false);
    assert.equal(validateSchema({ count: Infinity }, { type: 'object' }), false);
    assert.equal(validateSchema({ date: new Date(0) }, { type: 'object' }), false);
});
test('public response omits model thoughts and strips provider metadata from domain parts', async () => {
    const h = adapter(async () => gemini([{ text: 'internal thought', thought: true }, { text: 'visible answer', providerMetadata: { secret: 'private provider field' } }]));
    const result = await h.api.generate(request());
    assert.equal(result.ok, true);
    assert.equal(result.data.text, 'visible answer');
    assert.deepEqual(result.data.parts, [{ text: 'visible answer' }]);
});
test('invalid response parts fail with typed bad_output instead of crossing domain boundary', async () => {
    for (const part of [{ text: 123 }, null, { text: 'mixed', functionCall: { name: 'lookup', args: {} } }, { text: 'hidden', thought: 'true' }]) {
        const h = adapter(async () => gemini([{ text: 'ok' }, part]));
        const result = await h.api.generate(request());
        assert.equal(result.ok, false);
        assert.equal(result.failure.kind, 'bad_output');
    }
});
test('deadline reached exactly cannot report successful generation', async () => {
    const h = adapter(async clock => { await clock.advance(1000); return gemini([{ text: 'late result' }]); });
    const result = await h.api.generate(request());
    assert.equal(result.ok, false);
    assert.equal(result.failure.kind, 'timeout');
});
test('invalid schemas and hidden request metadata are rejected before paid transport', async () => {
    const h = adapter(async () => { throw Error('unexpected transport'); });
    for (const input of [
        request({ schema: { type: 'object', properties: { optional: { pattern: 'unsupported' } } } }),
        request({ tools: [{ name: 'lookup', parameters: { required: 'field' } }] }),
        request({ messages: [{ role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data: 'cGRm', headers: { secret: 'not-for-provider' } } }] }] }),
        request({ messages: [{ role: 'assistant', parts: [{ functionCall: { name: 'lookup', args: {}, providerSecret: 'not-for-provider' } }] }] }),
        request({ tools: [{ name: 'lookup', metadata: 'not-for-provider' }] })
    ]) {
        const result = await h.api.generate(input);
        assert.equal(result.ok, false);
        assert.equal(result.failure.kind, 'bad_output');
    }
    assert.equal(h.calls.length, 0);
});
test('unsupported schemas fail independently of data and object enum ignores member order', () => {
    assert.equal(validateSchema({}, { properties: { optional: { $ref: 'unavailable' } } }), false);
    assert.equal(validateSchema({}, { required: ['missing'] }), false);
    assert.equal(validateSchema({ n: 2 }, { properties: { n: { minimum: 3 } } }), false);
    assert.equal(validateSchema({ b: 2, a: 1 }, { enum: [{ a: 1, b: 2 }] }), true);
    const cyclic = {}; cyclic.self = cyclic;
    assert.equal(validateSchema({}, cyclic), false);
});
test('untrusted tool args cannot bypass bounds through additional unconstrained properties', async () => {
    let nested = {};
    for (let n = 0; n < 30; n++) nested = { child: nested };
    const unsafe = JSON.parse('{"__proto__":{"elevated":true}}');
    for (const args of [{ payload: nested }, unsafe, { count: Infinity }]) {
        const h = adapter(async () => gemini([{ functionCall: { name: 'lookup', args } }]));
        const result = await h.api.generate(request({ task: 'agent', tools: [{ name: 'lookup', parameters: { type: 'object' } }] }));
        assert.equal(result.ok, false);
        assert.equal(result.failure.kind, 'bad_output');
    }
    assert.equal(Object.prototype.elevated, undefined);
});
test('malformed visible response can fall back without exposing metadata or thoughts', async () => {
    const h = adapter(async (_clock, url) => url.includes('googleapis')
        ? gemini([{ text: 'private reasoning', thought: true }, { text: 123 }])
        : { data: { choices: [{ finish_reason: 'stop', message: { content: 'backup answer', providerMetadata: 'private' } }] } },
    { GEMINI_API_KEY: ['fake-key'], GROQ_API_KEY: 'fake-backup' });
    const result = await h.api.generate(request());
    assert.equal(result.ok, true);
    assert.equal(result.data.provider, 'groq');
    assert.equal(result.data.text, 'backup answer');
    assert.deepEqual(result.data.parts, [{ text: 'backup answer' }]);
    assert.equal(h.calls.length, 2);
});
