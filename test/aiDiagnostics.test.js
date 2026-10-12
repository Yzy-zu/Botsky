'use strict';

// Loads the actual adapter/router with fake HTTP/configuration in a VM. No .env,
// production keys, database, model requests or WhatsApp transports are loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const failures = require('../src/services/aiFailure');
const decision = { action: 'descargar', args: { query: 'documentales del océano' }, addressed_to_bot: true };
const gemini = text => ({ data: { candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } }] } });
const groq = text => ({ data: { choices: [{ finish_reason: 'stop', message: { content: text } }] } });
function harness({ env = { GEMINI_API_KEY: 'fake-gemini', GROQ_API_KEY: 'fake-groq' }, post, config = {} } = {}) {
    const calls = [], logs = [];
    const module = { exports: {} };
    const dependencies = {
        https: { Agent: class {} }, axios: { post: async (...args) => { calls.push(args); return post(...args); } },
        './logger': { info: line => logs.push(line), warn: line => logs.push(line), error: line => logs.push(line) },
        './aiConfig': { getAiConfig: () => config }, './conversationStyle': require('../src/services/conversationStyle'),
        './generationSettings': require('../src/services/generationSettings'), './semanticRouting': require('../src/services/semanticRouting'),
        './aiFailure': failures
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/ai.js'), 'utf8'), {
        module, exports: module.exports, process: { env }, Date, Intl, Map, Set, Buffer, setTimeout, clearTimeout,
        require(name) { if (!(name in dependencies)) throw Error('Unmocked import ' + name); return dependencies[name]; }
    }, { filename: 'ai.js' });
    return { ai: module.exports, calls, logs };
}

test('Empty Gemini result uses fallback and records empty_response instead of guessing a block', async () => {
    const h = harness({ post: async url => url.includes('googleapis') ? { data: {} } : groq(JSON.stringify(decision)) });
    const outcome = await h.ai.routeWithAIOutcome('Busca documentales del océano');
    assert.equal(outcome.ok, true);
    assert.equal(outcome.decision.action, 'descargar');
    assert.equal(outcome.attempts[0].kind, 'empty_response');
    assert.equal(h.calls.length, 2);
});

test('Prompt block and candidate safety finish are explicit blocked outcomes without fallback', async () => {
    for (const data of [{ promptFeedback: { blockReason: 'SAFETY' } }, { promptFeedback: { blockReason: 'FUTURE_BLOCK_REASON' } },
        { candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] }, { candidates: [{ finishReason: 'RECITATION' }] }]) {
        const h = harness({ post: async () => ({ data }) });
        const outcome = await h.ai.routeWithAIOutcome('Petición de prueba');
        assert.equal(outcome.ok, false);
        assert.equal(outcome.failure.kind, 'blocked');
        assert.equal(h.calls.length, 1);
    }
});

test('Malformed/unexpected tool output is rejected before valid-looking partial text can execute', () => {
    for (const finishReason of ['MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL', 'OTHER']) {
        assert.throws(() => failures.assertGeminiResponse({ candidates: [{ finishReason,
            content: { parts: [{ text: JSON.stringify(decision) }] } }] }), error => error.diagnostic.kind === 'invalid_response');
    }
    assert.throws(() => failures.assertGeminiResponse({ candidates: [{ content: { parts: [{ text: '' }] } }] },
        { needsText: false }), error => error.diagnostic.kind === 'empty_response');
});

test('Malformed model JSON is invalid_response and structured fallback can recover', async () => {
    const h = harness({ post: async url => url.includes('googleapis') ? gemini('no json') : groq(JSON.stringify(decision)) });
    const outcome = await h.ai.routeWithAIOutcome('Busca documentales');
    assert.equal(outcome.ok, true);
    assert.equal(outcome.attempts[0].kind, 'invalid_response');
});

test('A truncated route is rejected even when partial output parses into valid JSON', async () => {
    const h = harness({ post: async url => {
        if (!url.includes('googleapis')) return groq(JSON.stringify(decision));
        const response = gemini(JSON.stringify(decision));
        response.data.candidates[0].finishReason = 'MAX_TOKENS';
        return response;
    } });
    const outcome = await h.ai.routeWithAIOutcome('Busca documentales');
    assert.equal(outcome.ok, true);
    assert.equal(outcome.attempts[0].finishReason, 'MAX_TOKENS');
});

test('Semantic schema repair remains bounded and does not execute incomplete outbound plans', async () => {
    const incomplete = { action: 'mensaje', args: { mensaje: 'Nos vemos mañana' }, addressed_to_bot: true };
    const h = harness({ post: async url => url.includes('googleapis') ? gemini(JSON.stringify(incomplete)) : groq(JSON.stringify(incomplete)) });
    const outcome = await h.ai.routeWithAIOutcome('Manda el recado');
    assert.equal(outcome.ok, false);
    assert.equal(outcome.failure.kind, 'invalid_response');
    assert.equal(h.calls.length, 3);
});

test('Groq HTTP 400 diagnostics retain known code/parameter and omit raw body/messages/config', async () => {
    const secret = 'SECRET-token-request-content';
    const h = harness({ post: async url => {
        if (url.includes('googleapis')) return { data: {} };
        throw Object.assign(Error(secret), { config: { headers: { Authorization: secret } },
            response: { status: 400, data: { error: { code: 'json_validate_failed', param: 'response_format',
                message: secret, failed_generation: secret } } } });
    } });
    const outcome = await h.ai.routeWithAIOutcome('Busca documentales');
    assert.equal(outcome.ok, false);
    assert.equal(outcome.failure.kind, 'invalid_response');
    assert.equal(outcome.failure.httpStatus, 400);
    assert.equal(outcome.failure.providerCode, 'json_validate_failed');
    assert.equal(outcome.failure.parameter, 'response_format');
    assert.ok(!JSON.stringify(outcome).includes(secret));
    assert.ok(!h.logs.join('\n').includes(secret));
    assert.equal(h.ai.isGroqAvailable(), true, 'Bad request must not trip a rate-limit breaker');
});

test('HTTP configuration, network, rate-limit and unavailable faults remain distinct', () => {
    for (const [error, kind] of [
        [{ response: { status: 401 } }, 'configuration'], [{ response: { status: 400 } }, 'invalid_request'],
        [{ response: { status: 429 } }, 'rate_limit'], [{ response: { status: 503 } }, 'provider_unavailable'],
        [{ code: 'ENOTFOUND' }, 'network']
    ]) assert.equal(failures.classifyAiError(error, 'groq').kind, kind);
});

test('Unknown arbitrary provider codes/parameters/finish reasons cannot leak secrets', () => {
    const secret = 'sensitive_api_key';
    const fault = failures.classifyAiError({ response: { status: 400, data: { error: { code: secret, param: secret } } } }, 'groq');
    assert.ok(!JSON.stringify(fault).includes(secret));
    assert.ok(!JSON.stringify(new failures.AiProviderError({ kind: 'blocked', provider: 'gemini', finishReason: secret })).includes(secret));
});

test('Groq payload uses current token field, optional system message and supported OSS options', async () => {
    const h = harness({ post: async () => groq(JSON.stringify(decision)) });
    await h.ai.callGroq({ generationProfile: 'router', userMessage: 'Return JSON', maxTokens: 1800, jsonMode: true });
    const payload = h.calls[0][1];
    assert.equal(payload.max_completion_tokens, 1800);
    assert.equal(payload.max_tokens, undefined);
    assert.equal(payload.messages.length, 1);
    assert.equal(payload.reasoning_effort, 'low');
    assert.equal(payload.include_reasoning, false);
    assert.equal(payload.reasoning_format, undefined);
    const other = harness({ config: { groqModel: 'llama-3.3-70b-versatile' }, post: async () => groq('ok') });
    await other.ai.callGroq({ userMessage: 'hola' });
    assert.equal(other.calls[0][1].include_reasoning, undefined);
});

test('Tool-content ABI is preserved, including valid function call without text', async () => {
    const content = { role: 'model', parts: [{ functionCall: { name: 'lookup', args: {} } }] };
    const h = harness({ post: async () => ({ data: { candidates: [{ finishReason: 'STOP', content }] } }) });
    const result = await h.ai.callGemini({ userMessage: 'lookup', returnContent: true });
    assert.equal(result, content);
    const metadata = await h.ai.callGemini({ userMessage: 'lookup', returnContent: true, returnMetadata: true });
    assert.equal(metadata.content, content);
    assert.equal(metadata.finishReason, 'STOP');
});

test('Legacy route API still returns decision or null, typed outcome reports missing configuration', async () => {
    const h = harness({ env: {}, post: async () => { throw Error('No request expected'); } });
    assert.equal(await h.ai.routeWithAI('hola'), null);
    assert.equal((await h.ai.routeWithAIOutcome('hola')).failure.kind, 'configuration');
    const success = harness({ post: async () => gemini(JSON.stringify(decision)) });
    assert.equal((await success.ai.routeWithAI('Busca documentales')).action, 'descargar');
});

test('Groq content filtering is blocked, genuine rate limits activate breaker', async () => {
    const blocked = harness({ post: async () => ({ data: { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] } }) });
    await assert.rejects(blocked.ai.callGroq({ userMessage: 'prueba' }), error => error.diagnostic.kind === 'blocked');
    const limited = harness({ post: async () => { throw Object.assign(Error('rate limit'), { response: { status: 429 } }); } });
    await assert.rejects(limited.ai.callGroq({ userMessage: 'prueba' }), error => error.diagnostic.kind === 'rate_limit');
    assert.equal(limited.ai.isGroqAvailable(), false);
});
