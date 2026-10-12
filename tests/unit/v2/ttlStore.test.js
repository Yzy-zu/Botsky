'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeClock } = require('../../../src/v2/platform/clock');
const { TtlStore } = require('../../../src/v2/platform/ttlStore');
test('TTL expiry, touch and composite namespaces are deterministic', async () => {
    const clock = new FakeClock();
    const store = new TtlStore({ clock });
    store.set('a:b', 'c', 1, 10);
    store.set('a', 'b:c', 2, 20);
    store.set('__proto__', 'x', undefined, 30);
    assert.equal(store.get('a:b', 'c'), 1);
    assert.equal(store.get('a', 'b:c'), 2);
    assert.equal(store.touch('__proto__', 'x', 40), true);
    await clock.advance(10);
    assert.equal(store.get('a:b', 'c'), undefined);
    assert.equal(store.touch('a:b', 'c', 10), false);
    assert.equal(store.touch('a', 'b:c', 20), true);
    await clock.advance(20);
    assert.equal(store.size, 1);
    assert.equal(store.delete('__proto__', 'x'), true);
    assert.equal(store.delete('missing', 'x'), false);
    assert.equal(store.size, 0);
    store.set('a', 'x', 1, 1);
    store.dispose();
    assert.equal(store.size, 0);
});
test('TTL validates capacity and expiry before admitting a new entry', async () => {
    const clock = new FakeClock();
    assert.throws(() => new TtlStore({ clock, maxEntries: 0 }));
    const store = new TtlStore({ clock, maxEntries: 1 });
    assert.throws(() => store.set('a', 'x', 1, 0));
    assert.throws(() => store.touch('a', 'x', Infinity));
    store.set('a', 'x', 1, 10);
    store.set('a', 'x', 2, 10);
    assert.equal(store.get('a', 'x'), 2);
    assert.throws(() => store.set('b', 'x', 2, 10));
    await clock.advance(10);
    store.set('b', 'x', 2, 10);
    assert.equal(store.get('missing', 'x'), undefined);
});


test('Namespace occupancy is isolated, expires lazily and resets on reusable disposal', async () => {
    const clock = new FakeClock(); const store = new TtlStore({ clock, maxEntries: 5 });
    store.set('a:b', 'c', 1, 10); store.set('a', 'b:c', 2, 20); store.set('__proto__', 'x', 3, 30);
    const stats = store.stats;
    assert.equal(stats.size, 3); assert.equal(stats.maxEntries, 5);
    assert.deepEqual({ ...stats.namespaces }, { 'a:b': 1, a: 1, ['__proto__']: 1 });
    stats.namespaces.a = 99; assert.equal(store.stats.namespaces.a, 1);
    await clock.advance(10); assert.equal(store.stats.namespaces['a:b'], undefined); assert.equal(store.stats.size, 2);
    store.dispose(); assert.equal(store.stats.size, 0);
    store.set('reused', 'x', 1, 1); assert.equal(store.stats.namespaces.reused, 1);
});
