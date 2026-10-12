'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');

function toolRegistry(enabled, withProcess = true) {
    const rows = [];
    const module = { exports: {} };
    const runtime = { trackTool(name, args, context, operation) {
        rows.push({ name, isGroup: context?.isGroup });
        return operation();
    } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'src/services/toolRegistry.js'), 'utf8'), {
        module, exports: module.exports, ...(withProcess ? { process: { env: { LEGACY_COMMAND_USAGE_ENABLED: enabled ? 'true' : 'false' } } } : {}),
        require(id) {
            if (id === './logger') return { info() {}, error() {} };
            if (id === './commandUsageRuntime') { assert.ok(enabled); return runtime; }
            if (['./db', './evolution', '../utils/messageText', '../utils/reminderInput'].includes(id)) return {};
            throw new Error('Unexpected dependency: ' + id);
        }
    });
    return { api: module.exports, rows };
}

test('optional universal tool observation preserves permission rejection and result', async () => {
    const off = toolRegistry(false);
    const on = toolRegistry(true);
    const args = { comando: 'never-executed' };
    const context = { isAdmin: false, from: '19995550001@s.whatsapp.net' };
    const original = await off.api.executeTool('ejecutar_terminal', args, context);
    const observed = await on.api.executeTool('ejecutar_terminal', args, context);
    assert.equal(JSON.stringify(original), JSON.stringify(observed));
    assert.equal(observed.success, false);
    assert.equal(off.rows.length, 0);
    assert.equal(on.rows.length, 1);
});

test('legacy tool VM without a process global stays on the uninstrumented path', async () => {
    const vmApi = toolRegistry(false, false);
    const result = await vmApi.api.executeTool('ejecutar_terminal', {}, { isAdmin: false });
    assert.equal(result.success, false);
    assert.equal(vmApi.rows.length, 0);
});

test('dispatcher wrapper preserves result/rejection and has zero imports when off', async () => {
    const source = fs.readFileSync(path.join(root, 'src/core/dispatcher.js'), 'utf8');
    const begin = source.indexOf('function observeCommandUsage(');
    const end = source.indexOf('\n}', begin) + 2;
    const helper = source.slice(begin, end);
    for (const enabled of [false, true]) {
        const rows = [];
        const fn = vm.runInNewContext(helper + '\nobserveCommandUsage', {
            process: { env: { LEGACY_COMMAND_USAGE_ENABLED: enabled ? 'true' : 'false' } },
            require(id) {
                assert.ok(enabled);
                assert.equal(id, '../services/commandUsageRuntime');
                return { track(command, from, operation) { rows.push(command); return operation(); } };
            }
        });
        const result = {};
        assert.equal(await fn('notas', '19995550001@s.whatsapp.net', () => result), result);
        const error = new Error('Original operation failed');
        assert.throws(() => fn('notas', '19995550001@s.whatsapp.net', () => { throw error; }), err => err === error);
        assert.equal(rows.length, enabled ? 2 : 0);
    }
});
