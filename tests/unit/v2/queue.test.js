'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeClock } = require('../../../src/v2/platform/clock');
const { TieredQueue, queueConfig } = require('../../../src/v2/platform/queue');
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function make(options = {}) { const clock = new FakeClock(); return { clock, queue: new TieredQueue({ clock, tiers: {
    light: { concurrency: 1, maxPerUser: 3, maxPending: 2 }, heavy: { concurrency: 1, maxPerUser: 3, maxPending: 2 }
}, ...options }) }; }
test('Queue preserves tiers, FIFO within priority, user limits and global backpressure', async () => {
    const { queue, clock } = make(); const gate = deferred(); const order = [];
    const running = queue.add('u', () => gate.promise, 'light');
    const normal = queue.add('u', () => order.push('normal'), 'light');
    const high = queue.add('v', () => order.push('high'), 'light', 'Task', { priority: 1 });
    await assert.rejects(queue.add('u', () => {}, 'light'), { code: 'BACKPRESSURE' });
    const heavy = queue.add('__proto__', () => 4, 'unknown');
    assert.equal(await heavy, 4);
    assert.equal(queue.stats.light.pending, 2);
    gate.resolve(1); await running; await clock.flush(); await Promise.all([normal, high]);
    assert.deepEqual(order, ['high', 'normal']);
    assert.deepEqual(queue.stats.light.users, {});
    await queue.dispose();
    await assert.rejects(queue.add('u', () => 1), { code: 'STOPPED' });
});
test('User limit includes active tasks and priority insertion stays stable', async () => {
    const { queue, clock } = make({ tiers: { light: { concurrency: 1, maxPerUser: 1 }, heavy: { concurrency: 1, maxPerUser: 5 } } });
    const gate = deferred(); const order = [];
    const active = queue.add('u', () => gate.promise, 'light');
    await assert.rejects(queue.add('u', () => {}, 'light'), { code: 'USER_LIMIT' });
    const blocker = queue.add('x', () => gate.promise);
    const a = queue.add('x', () => order.push('a'), 'heavy', '', { priority: 1 });
    const b = queue.add('x', () => order.push('b'), 'heavy', '', { priority: 1 });
    gate.resolve(); await clock.flush(); await Promise.all([active, blocker, a, b]);
    assert.deepEqual(order, ['a', 'b']); await queue.dispose();
});
test('Timeout aborts task but retains concurrency and user reservation until real settlement', async () => {
    const { queue, clock } = make(); const gate = deferred(); let signal; let nextStarted = false;
    const task = queue.add('u', received => { signal = received; return gate.promise; }, 'heavy', '', { timeoutMs: 10 });
    const rejection = assert.rejects(task, { code: 'TIMEOUT' });
    const next = queue.add('v', () => { nextStarted = true; return 2; });
    await clock.advance(10); await rejection;
    assert.equal(signal.aborted, true); assert.equal(nextStarted, false);
    assert.equal(queue.stats.heavy.running, 1); assert.equal(queue.stats.heavy.users.u, 1);
    gate.resolve(1); await clock.flush(); assert.equal(await next, 2);
    assert.equal(queue.stats.heavy.running, 0); await queue.dispose();
});
test('Task failures, stop draining, cancellation and invalid configuration are handled', async () => {
    const { queue, clock } = make();
    await assert.rejects(queue.add('u', () => { throw new Error('failure'); }, 'heavy', '', { timeoutMs: 100 }), /failure/);
    assert.equal(clock.pendingTimers, 0);
    await assert.rejects(queue.add('u', () => {}, 'heavy', '', { timeoutMs: -1 }), { code: 'INVALID' });
    const gate = deferred(); const active = queue.add('u', () => gate.promise);
    const pending = queue.add('v', () => 2); const cancelled = assert.rejects(pending, { code: 'STOPPED' });
    queue.stop(); await cancelled;
    assert.equal(queue.stats.heavy.users.v, undefined);
    gate.resolve(); await active; await queue.dispose();
    assert.throws(() => make({ tiers: { heavy: { concurrency: 0, maxPerUser: 1 } } }));
    assert.throws(() => make({ tiers: { heavy: { concurrency: 1, maxPerUser: 1 } } }));
    assert.deepEqual(queueConfig(), { light: { concurrency: 4, maxPerUser: 5, maxPending: 100 }, heavy: { concurrency: 2, maxPerUser: 3, maxPending: 100 } });
    assert.equal(queueConfig({ MAX_QUEUE_PER_USER: 8, MAX_QUEUE_LIGHT: 9 }).heavy.maxPerUser, 8);
    assert.equal(queueConfig({ MAX_QUEUE_HEAVY: 7 }).heavy.maxPerUser, 7);
});
