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
const { evidenceProblems } = require('../../../scripts/v2/check-phase2.cjs');
const { compare } = require('../../../scripts/refactor/compare-legacy.cjs');

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

test('phase 2 gate never treats the red legacy baseline as a passing suite', () => {
    const evidence = {
        contracts: Object.fromEntries(['evolution', 'store', 'ai'].map(name => [name, { pass: 1, fail: 0, skipped: 0 }])),
        verify: { exitCode: 0 },
        store: { integrity: 'ok', backupRestore: true, actualLegacyCompatibility: true, schemaTables: 24, schemaIndexes: 13 },
        legacy: { tests: 795, pass: 608, fail: 187, skipped: 0, exitCode: 1, tapSha256: 'a'.repeat(64) }
    };
    assert.equal(evidenceProblems(evidence).length, 1);
    assert.match(evidenceProblems(evidence)[0], /zero new failures/);
    evidence.legacy = { ...evidence.legacy, pass: 795, fail: 0, exitCode: 0 };
    assert.equal(evidenceProblems(evidence).length, 0);
    evidence.contracts.ai.skipped = 1;
    assert.equal(evidenceProblems(evidence).length, 1);
});

test('phase 2 legacy deferral is scoped and cannot hide a new regression', () => {
    const evidence = {
        contracts: Object.fromEntries(['evolution', 'store', 'ai'].map(name => [name, { pass: 1, fail: 0, skipped: 0 }])),
        verify: { exitCode: 0 },
        store: { integrity: 'ok', backupRestore: true, actualLegacyCompatibility: true, schemaTables: 24, schemaIndexes: 13 },
        exceptions: [{ id: 'F2-E001', status: 'deferred', authorizedBy: 'user-delegated-decision', instruction: 'lo q tu creas mejor papu', revisit: 'Before each feature migration and final cutover.' }],
        legacy: { tests: 795, pass: 636, fail: 159, skipped: 0, exitCode: 1, tapSha256: 'b'.repeat(64), newFailures: 0, unmatchedFailureTitles: [], comparisonBaselineSha256: '038ef53fc12e924fe0e7a0baad551fca75c1b786f1f62929f7f3315974d0da83' }
    };
    assert.equal(evidenceProblems(evidence).length, 0);
    evidence.legacy.newFailures = 1;
    assert.equal(evidenceProblems(evidence).length, 1);
    evidence.legacy.newFailures = 0;
    evidence.exceptions[0].instruction = 'implicit authorization';
    assert.equal(evidenceProblems(evidence).length, 1);
});

test('legacy comparison excludes suite aggregates and counts duplicate regressions', () => {
    const report = names => names.map(name => `not ok 1 - ${name}\n  ---\n  type: 'test'\n  ...\n`).join('')
        + "not ok 2 - suite wrapper\n  ---\n  type: 'suite'\n  ...\n"
        + `# tests 795\n# pass ${795 - names.length}\n# fail ${names.length}\n# skipped 0\n# cancelled 0\n# todo 0\n# duration_ms 10\n`;
    assert.equal(compare(report(['old', 'old', 'fixed']), report(['old', 'old'])).resolvedBaselineFailures, 1);
    assert.equal(compare(report(['old']), report(['old', 'old'])).newFailures, 1);
    assert.equal(compare(report(['old']), report(['new'])).newFailures, 1);
    assert.throws(() => compare('incomplete TAP', report(['old'])), /Incomplete/);
});
