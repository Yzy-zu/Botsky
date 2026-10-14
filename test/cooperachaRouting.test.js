'use strict';

// Dispatcher real con transportes, comandos y modelo simulados: sin red ni BD.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ active = false, decision = 'pack' } = {}) {
    const commands = [];
    let routed = 0;
    const source = fs.readFileSync(path.join(__dirname, '../src/core/dispatcher.js'), 'utf8');
    const deps = Object.fromEntries([...source.matchAll(/require\('([^']+)'\)/g)].map(m => [m[1], {}]));
    Object.assign(deps, {
        '../core/parser': require('../src/core/parser'),
        '../services/scheduler': { registerTask() {} },
        '../services/logger': { info() {}, warn() {}, error() {}, cmd() {} },
        '../services/evolution': { sendText: async () => {}, sendTyping: async () => {} },
        '../services/history': { getHistory: () => [], addMessage() {} },
        '../services/proactive': { recordGroupActivity() {} },
        '../services/db': { getUserAffinityContext: async () => '' },
        '../services/ai': {
            routeWithAIOutcome: async () => {
                routed++;
                return { ok: true, decision: { action: decision, args: {} } };
            }
        },
        '../commands/cooperacha': { hasActiveCooperacha: () => active },
        '../commands/mensaje': { getPendingContactContext: () => [] },
        '../commands/buscar': { getSearchContext: () => [] },
        '../services/attachmentContext': {
            getAttachmentState: () => ({ attachments: [], activeId: null, pendingRequest: null }),
            clearPendingRequest() {}
        },
        '../services/semanticRouting': require('../src/services/semanticRouting'),
        '../services/operationFeedback': require('../src/services/operationFeedback'),
        './auth': require('../src/core/auth'),
        './commandRegistry': {
            isRegisteredCommand: cmd => ['cooperacha', 'coop', 'pack', 'encuesta'].includes(cmd),
            getCommandHandler: (command, context) => ({
                handler: async () => commands.push({ command, args: Array.from(context.parsed.args) }),
                queueTier: null
            })
        }
    });
    const module = { exports: {} };
    vm.runInNewContext(source, {
        module, exports: module.exports, process: { env: {} },
        Date, Intl, Map, Set, Buffer, setTimeout, clearTimeout,
        require: id => {
            if (!(id in deps)) throw Error('Import sin mock: ' + id);
            return deps[id];
        }
    });
    return {
        commands,
        get routed() { return routed; },
        async dispatch(text) {
            await module.exports.dispatch({
                from: 'test@g.us', text, messageType: 'conversation',
                messageData: {
                    key: { remoteJid: 'test@g.us', participant: '990000000001@lid' },
                    message: { conversation: text }, pushName: 'Prueba'
                }
            });
        }
    };
}

for (const [text, args] of [
    ['botsky échate una fotito censurada', []],
    ['botsky, arma una cooperación 300', ['300']],
    ['botsky arma cooperacha 300', ['300']],
    ['botsky inicia vaquita 300', ['300']],
    ['botsky reto de foto 300', ['300']],
    ['Botsky, mándame una foto censurada para juntar 400 XP.', ['400']]
]) {
    test(`Cooperacha natural: ${text}`, async () => {
        const h = harness({ decision: 'encuesta' });
        await h.dispatch(text);
        assert.equal(h.routed, 0, 'No debe depender de la interpretación errónea de la IA');
        assert.deepEqual(h.commands, [{ command: 'cooperacha', args }]);
    });
}

test('Pedir otra censurada con reto activo muestra estado sin deducir una aportación', async () => {
    const h = harness({ active: true });
    await h.dispatch('botsky, arma una cooperación 300');
    assert.deepEqual(h.commands, [{ command: 'cooperacha', args: ['estado'] }]);
    assert.equal(h.routed, 0);
});

test('Aportación con nombre del bot conserva la cantidad del participante', async () => {
    const h = harness({ active: true });
    await h.dispatch('botsky, le meto 100');
    assert.deepEqual(h.commands, [{ command: 'coop', args: ['100'] }]);
});

for (const text of ['botsky quiero comprar un pack', 'botsky cómo funciona la foto censurada', 'ayer mandaron una foto censurada']) {
    test(`No inicia cooperacha por mencionar una foto: ${text}`, async () => {
        const h = harness();
        await h.dispatch(text);
        assert.equal(h.commands.some(c => c.command === 'cooperacha'), false);
    });
}
