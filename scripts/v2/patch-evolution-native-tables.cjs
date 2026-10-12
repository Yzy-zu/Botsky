'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { patchEvolutionBundle } = require('../../src/v2/adapters/evolution/nativeTables');

// Explicit paths prevent silently patching the active deployment. No I/O on import.
function runPatch(target, modulePath) {
    if (!target || !modulePath) throw new Error('Bundle and installed native-table module paths are required');
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Bundle must be a regular file');
    const source = fs.readFileSync(target, 'utf8');
    const patched = patchEvolutionBundle(source, modulePath);
    if (patched === source) return false;
    const directory = fs.mkdtempSync(path.join(path.dirname(target), '.native-table-'));
    const temporary = path.join(directory, 'bundle.js');
    try {
        fs.writeFileSync(temporary, patched, { mode: stat.mode & 0o777, flag: 'wx' });
        fs.renameSync(temporary, target);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    return true;
}
if (require.main === module) {
    try {
        if (process.argv.length !== 4) throw new Error('Usage: patch-evolution-native-tables.cjs <bundle> <installed-module-path>');
        const changed = runPatch(process.argv[2], process.argv[3]);
        console.log(changed ? 'Native-table patch applied' : 'Native-table patch already applied');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { runPatch };
