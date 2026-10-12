'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const { runPatch } = require('../../scripts/v2/patch-evolution-native-tables.cjs');

test('native patch operator preserves guards and mode, is idempotent and fails before replacing unsupported bundles', () => {
    // Share the genuine guarded bundle fixture used by the integration contracts.
    const fixture = path.join(__dirname, 'evolutionNativeTables.test.js');
    const tree = ts.createSourceFile(fixture, fs.readFileSync(fixture, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    let source;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'bundle' && ts.isStringLiteral(node.initializer)) source = node.initializer.text;
        ts.forEachChild(node, visit);
    }
    visit(tree);
    assert.equal(typeof source, 'string');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'botsky-native-patch-'));
    try {
        const file = path.join(directory, 'bundle.js');
        fs.writeFileSync(file, source, { mode: 0o640 });
        assert.equal(runPatch(file, '/installed/v2/nativeTables.js'), true);
        const patched = fs.readFileSync(file, 'utf8');
        assert.ok(patched.includes("require('/installed/v2/nativeTables.js')"));
        assert.ok(patched.includes('...guards'));
        assert.equal(fs.statSync(file).mode & 0o777, 0o640);
        assert.equal(runPatch(file, '/installed/v2/nativeTables.js'), false);
        assert.equal(fs.readFileSync(file, 'utf8'), patched);
        fs.writeFileSync(file, 'unsupported provider bundle');
        assert.throws(() => runPatch(file, '/installed/v2/nativeTables.js'), /Unsupported/);
        assert.equal(fs.readFileSync(file, 'utf8'), 'unsupported provider bundle');
        assert.deepEqual(fs.readdirSync(directory), ['bundle.js']);
        const cli = path.resolve(__dirname, '../../scripts/v2/patch-evolution-native-tables.cjs');
        assert.throws(() => execFileSync(process.execPath, [cli], { stdio: 'pipe' }));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
