'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Linter } = require('eslint');
const { auditArchitecture } = require('../../../scripts/v2/check-architecture.cjs');
const { referencedEnv, referencedPythonEnv } = require('../../../scripts/v2/env-example.cjs');
const { coverageProblems } = require('../../../scripts/v2/check-coverage.cjs');
const stateRule = require('../../../scripts/v2/no-global-state.cjs');

function fixture(files, operation) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'botsky-architecture-'));
    try {
        for (const [name, source] of Object.entries(files)) {
            const filename = path.join(root, name);
            fs.mkdirSync(path.dirname(filename), { recursive: true });
            fs.writeFileSync(filename, source);
        }
        return operation(root);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('architecture rejects cross-layer dependencies, cycles and dynamic requires', () => {
    const result = fixture({
        'features/a/handler.js': "require('../../adapters/ai/client'); require(name);",
        'adapters/ai/client.js': "require('../store/client');",
        'adapters/store/client.js': "require('../ai/client');",
        'domain/error.js': "require('../features/a/handler');",
        'platform/clock.js': 'const value = process.env.PORT;'
    }, auditArchitecture);
    for (const pattern of [/features -> adapters/, /domain -> features/, /cycle/, /dynamic import/, /another adapter/, /process.env/]) {
        assert.ok(result.problems.some(problem => pattern.test(problem)), String(pattern));
    }
});

test('architecture accepts explicit ports and rejects escape to legacy', () => {
    const result = fixture({
        'domain/types.js': 'module.exports = {};',
        'platform/service.js': "require('../domain/types'); require('node:crypto');",
        'features/a/handler.js': "require('../../domain/types');",
        'adapters/ai/client.js': "require('../../domain/types');"
    }, auditArchitecture);
    assert.equal(result.problems.length, 0);
    fixture({ 'legacy.js': 'module.exports = {};', 'v2/platform/service.js': "require('../../legacy');" }, root => {
        assert.ok(auditArchitecture(path.join(root, 'v2')).problems.some(problem => /outside v2/.test(problem)));
    });
});

test('mutable collections cannot hide at module scope under Object.freeze', () => {
    const linter = new Linter();
    const config = [{ plugins: { own: { rules: { state: stateRule } } }, rules: { 'own/state': 'error' } }];
    for (const source of ['const x = new Map();', 'const x = Object.freeze(new Set());', 'const x = [new globalThis.Map()];', 'class A { static x = new Set(); }']) {
        assert.equal(linter.verify(source, config).length, 1, source);
    }
    assert.equal(linter.verify('function create() { return new Map(); } class A { x = new Set(); }', config).length, 0);
});

test('environment inventory handles aliases, destructuring, static brackets and ignores comments', () => {
    assert.deepEqual(referencedEnv("// process.env.FAKE\nconst env = process.env; const { PORT: port } = env; env['KEY']; process.env.URL;", 'input.js').sort(), ['KEY', 'PORT', 'URL']);
    assert.deepEqual(referencedEnv("const env = process['env']; env.NEXT;", 'input.js'), ['NEXT']);
    assert.deepEqual(referencedPythonEnv("# os.getenv('FAKE')\nos.getenv('WHISPER_DEVICE', 'cpu')\nos.environ.get('WHISPER_COMPUTE_TYPE')\nos.environ['KMP_DUPLICATE_LIB_OK']"), ['WHISPER_DEVICE', 'WHISPER_COMPUTE_TYPE', 'KMP_DUPLICATE_LIB_OK']);
});

test('coverage fails closed for omitted or subthreshold critical modules', () => {
    const root = path.resolve(__dirname, '../../../src/v2');
    const files = ['config/schema.js', 'config/index.js', 'platform/ttlStore.js', 'platform/queue.js', 'platform/scheduler.js']
        .map(name => ({ path: path.join(root, name), lines: 90 }));
    assert.equal(coverageProblems(files).length, 0);
    files[0].lines = 89.99;
    assert.equal(coverageProblems(files).length, 1);
    files.pop();
    assert.equal(coverageProblems(files).length, 2);
});
