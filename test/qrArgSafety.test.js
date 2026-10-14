'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('legacy QR passes option-looking payload as literal data and keeps it out of logs', async () => {
    const payload = '--read-from=/synthetic/private';
    const calls = [];
    const logger = { cmd(value) { calls.push({ type: 'log', value }); }, error() {} };
    const fakeFs = { existsSync: () => true };
    const childProcess = { execFile(command, args, options, callback) {
        calls.push({ type: 'exec', command, args, options });
        fs.writeFileSync(args[args.indexOf('-o') + 1], 'synthetic-png');
        callback(null, { stdout: '', stderr: '' });
    } };
    const deps = {
        '../utils/cleanup': { cleanup(...paths) { for (const file of paths) if (file) fs.rmSync(file, { force: true }); } }, fs: fakeFs, path,
        child_process: childProcess, util: require('node:util'),
        '../services/evolution': { sendText: async () => {}, sendMedia: async () => {}, downloadMedia: async () => {} },
        '../services/logger': logger
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/commands/qr.js'), 'utf8'), {
        module, exports: module.exports, process: { env: { TMP_DIR: require('node:os').tmpdir() } },
        Date, Math, Buffer, require(id) { assert.ok(id in deps, `Unexpected import: ${id}`); return deps[id]; }
    }, { filename: 'src/commands/qr.js' });
    await module.exports.handleQr({ args: [payload] }, 'synthetic-chat', {});
    const executed = calls.find(call => call.type === 'exec');
    assert.deepEqual(Array.from(executed.args), ['-s', '10', '-m', '2', '-o', executed.args[executed.args.indexOf('-o') + 1], '--', payload]);
    assert.equal(calls.find(call => call.type === 'log').value.includes(payload), false);
});
