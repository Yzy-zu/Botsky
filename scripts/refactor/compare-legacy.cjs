'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const baselineHash = '038ef53fc12e924fe0e7a0baad551fca75c1b786f1f62929f7f3315974d0da83';
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
function metrics(tap) {
    const result = {};
    for (const key of ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo', 'duration_ms']) {
        const match = tap.match(new RegExp('^# ' + key + ' ([0-9.]+)$', 'm'));
        if (!match) throw new Error('Incomplete TAP summary: ' + key);
        result[key] = Number(match[1]);
    }
    return result;
}
function failures(tap) {
    const lines = tap.split('\n'); const result = [];
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^\s*not ok \d+ - (.+)$/);
        if (!match) continue;
        let suite = false;
        for (let j = i + 1; j < lines.length; j++) {
            if (/^\s*(?:not )?ok \d+ - /.test(lines[j]) || /^\s*\.\.\.$/.test(lines[j])) break;
            if (/^\s*type: ['"]?suite['"]?\s*$/.test(lines[j])) suite = true;
        }
        if (!suite) result.push(match[1].replace(/\/home\/petrov\/botsky\/test\//g, 'test/'));
    }
    return result;
}
function compare(baseline, current) {
    const old = failures(baseline); const next = failures(current);
    const previous = metrics(baseline); const actual = metrics(current);
    if (old.length !== previous.fail || next.length !== actual.fail) throw new Error('Failure inventory does not match TAP counts');
    const remaining = new Map();
    for (const name of old) remaining.set(name, (remaining.get(name) || 0) + 1);
    let regressions = 0;
    for (const name of next) {
        if ((remaining.get(name) || 0) > 0) remaining.set(name, remaining.get(name) - 1);
        else regressions++;
    }
    return { ...actual, newFailures: regressions, resolvedBaselineFailures: old.length - next.length + regressions };
}
function main() {
    const [baselineFile, currentFile] = process.argv.slice(2);
    if (!baselineFile || !currentFile || process.argv.length !== 4) throw new Error('Usage: compare-legacy.cjs <original-baseline.tap> <current.tap>');
    const baseline = fs.readFileSync(baselineFile); const current = fs.readFileSync(currentFile);
    if (sha256(baseline) !== baselineHash) throw new Error('Original baseline checksum mismatch');
    const result = compare(baseline.toString('utf8'), current.toString('utf8'));
    console.log(JSON.stringify({ ...result, comparisonBaselineSha256: baselineHash, tapSha256: sha256(current) }));
    process.exitCode = result.newFailures ? 1 : 0;
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 2; } }
module.exports = { compare, failureTitles: failures };
