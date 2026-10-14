'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ ownedAttachment = false, botLid = '', historyRows = [] } = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../src/core/dispatcher.js'), 'utf8');
    const dependencies = Object.fromEntries([...source.matchAll(/require\('([^']+)'\)/g)].map(match => [match[1], {}]));
    const calls = [], sent = [], commands = [], history = [];
    const messageHistory = [];
    const noOp = () => {};
    Object.assign(dependencies, {
        '../core/parser': require('../src/core/parser'),
        '../services/scheduler': { registerTask: noOp },
        '../core/queue': { add: async (_key, handler) => handler() },
        '../services/logger': Object.fromEntries(['info', 'warn', 'error', 'cmd'].map(name => [name, noOp])),
        '../services/evolution': { sendText: async (to, text) => sent.push({ to, text }), sendTyping: async () => {}, sendRecording: async () => {} },
        '../commands/descargar': { getSearchSession: () => null, getDownloadSessionKey: from => from, matchSelection: () => null, extractAdultUrl: () => null },
        '../services/ai': {
            routeWithAIOutcome: async (...args) => { calls.push({ type: 'route', args }); return { ok: true, decision: { action: 'chat', addressed_to_bot: true } }; },
            chatWithBotsky: async () => { calls.push({ type: 'chat' }); return 'addressed reply'; }
        },
        '../services/agentEngine': { runUniversalAgent: async () => { calls.push({ type: 'agent' }); } },
        '../services/history': { getHistory: () => [...historyRows, ...messageHistory], addMessage: (...args) => history.push(args) },
        './commandRegistry': {
            isRegisteredCommand: name => name === 'help',
            getCommandHandler: async (_name, context) => ({ handler: async () => commands.push(context), queueTier: null })
        },
        './auth': { isAuthorizedAdmin: () => false, getSenderJid: (from, data) => data?.key?.participant || from,
            cleanJidNumber: jid => String(jid).split('@')[0], normalizePhoneNumber: value => value },
        '../services/proactive': { recordGroupActivity: noOp, maybeTriggerBurstIntervention: async () => {} },
        '../services/db': { getUserAffinityContext: async () => '' },
        '../commands/mensaje': { getPendingContactContext: () => [] },
        '../services/attachmentContext': { getAttachmentState: () => ({ attachments: ownedAttachment ? [{ id: 'owned-file' }] : [], activeId: null, pendingRequest: null }), clearPendingRequest: noOp },
        '../services/semanticRouting': require('../src/services/semanticRouting'),
        '../services/contentReader': { prepareContent: async () => ({ success: true }) },
        '../commands/buscar': { getSearchContext: () => [] },
        '../services/operationFeedback': { aiRoutingFailureMessage: () => 'routing failed' },
        '../services/packImages': { cleanCategory: value => value }
    });
    const module = { exports: {} };
    vm.runInNewContext(source, { module, exports: module.exports,
        process: { env: { BOT_NUMBER: '1234567890', ...(botLid ? { BOT_LID: botLid } : {}) } }, Date, Intl, Map, Set, Buffer, setTimeout, clearTimeout,
        require: name => { if (!(name in dependencies)) throw Error(`Unmocked import: ${name}`); return dependencies[name]; }
    }, { filename: 'core/dispatcher.js' });
    return {
        calls, sent, commands, history,
        dispatch({ group = false, text = 'unrelated group chatter', mentioned = false, quoteBot = false, quoteAttachment = false,
            quoteParticipant = '', quoteText = 'previous bot reply' } = {}) {
            const from = group ? '19995550000@g.us' : '19995550101@s.whatsapp.net';
            const contextInfo = {
                ...(mentioned ? { mentionedJid: ['1234567890@s.whatsapp.net'] } : {}),
                ...(quoteBot || quoteParticipant ? { participant: quoteParticipant || '1234567890@s.whatsapp.net', stanzaId: 'bot-reply', quotedMessage: { conversation: quoteText } } : {}),
                ...(quoteAttachment ? { stanzaId: 'owned-file', participant: '19995550101@s.whatsapp.net', quotedMessage: { conversation: 'file' } } : {})
            };
            const messageData = { key: { id: `message-${calls.length}-${sent.length}`, remoteJid: from,
                ...(group ? { participant: '19995550101@s.whatsapp.net' } : {}) },
                message: { extendedTextMessage: { text, contextInfo } } };
            return module.exports.dispatch({ from, text, messageType: 'extendedTextMessage', messageData,
                ...(text.startsWith('!') ? { hasPrefix: true } : {}) });
        }
    };
}

test('unaddressed group messages do not route, run business handlers, persist history, or send', async () => {
    for (const text of ['El profe manda el archivo después', 'el bot puede ayudar?', 'hola equipo']) {
        const h = harness();
        await h.dispatch({ group: true, text });
        assert.deepEqual(h.calls, [], text);
        assert.deepEqual(h.commands, [], text);
        assert.deepEqual(h.history, [], text);
        assert.deepEqual(h.sent, [], text);
    }
});

test('private chat stays active and exact Botsky/botsito names address group chat', async () => {
    for (const input of [{}, { group: true, text: 'Botsky, qué onda' }, { group: true, text: 'botsito responde' }]) {
        const h = harness();
        await h.dispatch(input);
        assert.equal(h.calls[0]?.type, 'route');
        assert.ok(h.calls.some(call => call.type === 'chat'));
        assert.equal(h.sent.length, 1);
    }
});

test('explicit prefixes, bot mentions and verified bot quotes pass the group gate', async () => {
    for (const input of [
        { group: true, text: '!help' },
        { group: true, text: 'qué opinas', mentioned: true },
        { group: true, text: 'y esto?', quoteBot: true },
        { group: true, text: 'y esto?', quoteParticipant: '1234567890:3@s.whatsapp.net' }
    ]) {
        const h = harness();
        await h.dispatch(input);
        if (input.text === '!help') {
            assert.equal(h.commands.length, 1);
            assert.deepEqual(h.calls, []);
        } else {
            assert.equal(h.calls[0]?.type, 'route');
            assert.ok(h.sent.length > 0);
        }
    }
});

test('quoted text and partial phone matches cannot impersonate the bot; a configured LID alias must match exactly', async () => {
    for (const quoteParticipant of ['991234567890@s.whatsapp.net', 'prefix1234567890@s.whatsapp.net']) {
        const forged = harness({ historyRows: [{ role: 'assistant', content: 'some previous bot reply' }] });
        await forged.dispatch({ group: true, text: 'reply to this', quoteParticipant, quoteText: 'some previous bot reply' });
        assert.deepEqual(forged.calls, []);
        assert.deepEqual(forged.sent, []);
    }

    const configuredLid = harness({ botLid: '991111111111@lid' });
    await configuredLid.dispatch({ group: true, text: 'follow up', quoteParticipant: '991111111111@lid' });
    assert.ok(configuredLid.calls.some(call => call.type === 'route'));

    const unknownLid = harness();
    await unknownLid.dispatch({ group: true, text: 'follow up', quoteParticipant: '991111111111@lid' });
    assert.deepEqual(unknownLid.calls, []);
});

test('a quoted attachment continues only from the current sender scoped attachment state', async () => {
    const h = harness({ ownedAttachment: true });
    await h.dispatch({ group: true, text: 'lee esto', quoteAttachment: true });
    assert.equal(h.calls[0]?.type, 'route');
    assert.ok(h.sent.length > 0);

    const unrelated = harness();
    await unrelated.dispatch({ group: true, text: 'lee esto', quoteAttachment: true });
    assert.deepEqual(unrelated.calls, []);
    assert.deepEqual(unrelated.sent, []);
});
