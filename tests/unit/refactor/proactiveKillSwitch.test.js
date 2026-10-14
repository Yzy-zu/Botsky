'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, proactiveHarness } = require('../../../test/aiOfflineHarness.test');

test('proactive defaults off before scheduler, DB, AI or outbound calls', async () => {
    for (const value of [undefined, 'false', 'TRUE', '1', '']) {
        const forbidden = () => { throw Error('Disabled proactivity performed IO'); };
        const env = value === undefined ? {} : { PROACTIVE_ENABLED: value };
        const api = loadModule('services/proactive.js', {
            './logger': { info() {}, warn: forbidden, error: forbidden },
            './evolution': { sendText: forbidden, sendTyping: forbidden },
            './history': { getHistory: forbidden, addMessage: forbidden },
            './scheduler': { registerTask: forbidden },
            './ai': { evaluateProactiveAction: forbidden },
            './db': { db: { all: forbidden }, canSendProactiveMessage: forbidden }
        }, { env });
        api.initProactiveHeartbeat();
        assert.equal((await api.runProactiveCycle()).reason, 'kill_switch');
        await api.maybeTriggerBurstIntervention('120000000001@g.us');
    }
});

test('explicit enabled fixture preserves behavior; disabling prevents subsequent cycles', async () => {
    const env = { PROACTIVE_ENABLED: 'true', ALLOWED_GROUPS_NORMAL: '120000000001@g.us' };
    const local = proactiveHarness({ env, history: [{ role: 'user', content: 'synthetic', timestamp: Date.parse('2026-10-12T18:00:00Z') }] });
    await local.api.runProactiveCycle();
    assert.equal(local.plans.length, 1);
    env.PROACTIVE_ENABLED = 'false';
    assert.equal((await local.api.runProactiveCycle()).reason, 'kill_switch');
    assert.equal(local.plans.length, 1);
    assert.equal(local.sent.length, 0);
});

test('switch flipped during an AI decision blocks pending group send', async () => {
    const env = { PROACTIVE_ENABLED: 'true', ALLOWED_GROUPS_NORMAL: '120000000001@g.us' };
    const decision = { channel: 'group', message: 'synthetic' };
    Object.defineProperty(decision, 'should_act', { get() { env.PROACTIVE_ENABLED = 'false'; return true; } });
    const local = proactiveHarness({ env, decision, history: [{ role: 'user', content: 'synthetic', timestamp: Date.parse('2026-10-12T18:00:00Z') }] });
    assert.equal((await local.api.runProactiveCycle()).reason, 'kill_switch');
    assert.equal(local.sent.length, 0);
});
