'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeClock } = require('../../../src/v2/platform/clock');
const { TieredQueue } = require('../../../src/v2/platform/queue');
const { createExecutor } = require('../../../src/v2/pipeline/executor');

function fixture(commandTimeoutMs) {
    const clock = new FakeClock();
    const queue = new TieredQueue({ clock });
    let startedSignal;
    let handlerCalls = 0;
    const command = { name: 'run', scope: ['private', 'group'], access: 'public', tier: 'heavy', help: { short: '', examples: [] },
        ...(commandTimeoutMs === undefined ? {} : { timeoutMs: commandTimeoutMs }),
        handler: (_ctx, _args, signal) => {
            handlerCalls++;
            startedSignal = signal;
            return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
        } };
    const features = [{ id: 'test', commands: [command] }];
    const executor = createExecutor({ features, queue, clock, llm: { generate: async () => ({ ok: true, data: { text: '' } }) } });
    const ctx = { event: { id: 'event-1', chatId: '12345@g.us', sender: { jid: '67890@s.whatsapp.net' }, isGroup: true, text: '' }, roles: { admins: [], owners: [] } };
    const decision = { kind: 'command', feature: 'test', name: 'run', args: {}, confidence: 1, via: 'explicit' };
    return { clock, queue, executor, ctx, decision, get startedSignal() { return startedSignal; }, get handlerCalls() { return handlerCalls; } };
}

async function started(f) {
    const result = f.executor.execute(f.ctx, f.decision);
    while (!f.startedSignal) await new Promise(resolve => setTimeout(resolve, 1));
    return { result };
}

test('command-specific heavy deadline overrides 30s default and aborts exactly at its fixed 75s deadline', async () => {
    const f = fixture(75_000);
    const { result } = await started(f);
    await f.clock.advance(30_000);
    assert.equal(f.startedSignal.aborted, false);
    await f.clock.advance(44_999);
    assert.equal(f.startedSignal.aborted, false);
    await f.clock.advance(1);
    await assert.rejects(result, { code: 'TIMEOUT' });
    assert.equal(f.startedSignal.aborted, true);
});

test('commands without metadata retain the 30s executor default', async () => {
    const f = fixture(undefined);
    const { result } = await started(f);
    await f.clock.advance(29_999);
    assert.equal(f.startedSignal.aborted, false);
    await f.clock.advance(1);
    await assert.rejects(result, { code: 'TIMEOUT' });
    assert.equal(f.startedSignal.aborted, true);
});

test('invalid manifest deadlines fail executor construction before command handlers can run', () => {
    for (const timeoutMs of [0, -1, 900_001, 1.5, Number.NaN]) {
        const clock = new FakeClock();
        const queue = new TieredQueue({ clock });
        let handlerCalls = 0;
        assert.throws(() => createExecutor({ features: [{ id: 'invalid', commands: [{ name: 'bad', timeoutMs, scope: ['private'], access: 'public', tier: 'heavy', help: { short: '', examples: [] }, handler: async () => { handlerCalls++; return { parts: [] }; } }] }], queue, clock, llm: {} }), /Invalid timeout/);
        assert.equal(handlerCalls, 0);
    }
});
