'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeClock } = require('../../../src/v2/platform/clock');
const { Scheduler } = require('../../../src/v2/platform/scheduler');
test('Scheduler requires explicit start and has repeatable stop/start lifecycle', async () => {
    const clock = new FakeClock(); const scheduler = new Scheduler({ clock, tickMs: 10 }); let runs = 0;
    const cancel = scheduler.register('job', 20, () => runs++);
    await clock.advance(20); assert.equal(runs, 0); assert.equal(clock.pendingTimers, 0);
    scheduler.start(); scheduler.start(); assert.equal(clock.pendingTimers, 1);
    await clock.advance(20); assert.equal(runs, 1);
    scheduler.stop(); await clock.advance(100); assert.equal(runs, 1);
    scheduler.start(); await clock.advance(10); assert.equal(runs, 2);
    assert.deepEqual(scheduler.getRegisteredTasks(), ['job']); cancel(); assert.equal(scheduler.unregister('job'), false);
    await scheduler.dispose(); assert.equal(clock.pendingTimers, 0);
    assert.throws(() => scheduler.start(), /disposed/); assert.throws(() => scheduler.register('x', 1, () => {}));
    scheduler.tick(); await scheduler.runAllMaintenance();
});
test('Scheduled and manual maintenance never overlap and dispose drains actual execution', async () => {
    const clock = new FakeClock(); const scheduler = new Scheduler({ clock, tickMs: 10 }); let resolve; let runs = 0;
    scheduler.register('job', 10, () => { runs++; return new Promise(r => { resolve = r; }); });
    scheduler.start(); await clock.advance(10); await scheduler.runAllMaintenance(); await clock.advance(100);
    assert.equal(runs, 1);
    let disposed = false; const draining = scheduler.dispose().then(() => { disposed = true; });
    await clock.flush(); assert.equal(disposed, false); resolve(); await draining;
    assert.equal(disposed, true); assert.deepEqual(scheduler.getRegisteredTasks(), []);
});
test('Errors are isolated, registrations validated and manual maintenance is sequential', async () => {
    const clock = new FakeClock(); const errors = [];
    const scheduler = new Scheduler({ clock, onError(error, id) { errors.push(id); throw error; } });
    assert.throws(() => new Scheduler({ clock, tickMs: 0 }));
    assert.throws(() => scheduler.register('', 1, () => {}));
    scheduler.register('sync', 1, () => { throw new Error('failure'); });
    scheduler.register('async', 1, async () => { throw new Error('failure'); });
    assert.throws(() => scheduler.register('sync', 1, () => {}));
    await scheduler.runAllMaintenance(); assert.deepEqual(errors, ['sync', 'async']);
    await clock.advance(1); scheduler.tick(); await clock.flush(); assert.equal(errors.length, 4);
    await scheduler.dispose();
});


test('Unregister cannot allow replacement to overlap a still-running job; stop inside a job cancels ticker', async () => {
    const clock = new FakeClock(); const scheduler = new Scheduler({ clock, tickMs: 10 }); let resolve;
    scheduler.register('job', 10, () => new Promise(r => { resolve = r; }));
    scheduler.start(); await clock.advance(10); scheduler.unregister('job');
    assert.throws(() => scheduler.register('job', 10, () => {}), /running/);
    resolve(); await clock.flush();
    scheduler.register('job', 10, () => scheduler.stop());
    await clock.advance(10); assert.equal(clock.pendingTimers, 0);
    await scheduler.dispose();
});
