'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const { auditArchitecture } = require('./check-architecture.cjs');

function evidenceProblems(evidence) {
    const issues = [];
    for (const name of ['evolution', 'store', 'ai']) {
        const contracts = evidence?.contracts?.[name];
        if (!contracts || contracts.pass < 1 || contracts.fail !== 0 || contracts.skipped !== 0) issues.push(`${name}: contracts must pass without skips`);
    }
    if (evidence?.verify?.exitCode !== 0) issues.push('npm run verify must pass');
    const legacy = evidence?.legacy;
    const validRun = legacy && Number.isInteger(legacy.tests) && legacy.tests >= 795
        && legacy.pass + legacy.fail === legacy.tests && legacy.skipped === 0
        && /^[a-f0-9]{64}$/.test(legacy.tapSha256 || '');
    const green = validRun && legacy.fail === 0 && legacy.exitCode === 0;
    const exception = evidence?.exceptions?.find(entry => entry.id === 'F2-E001');
    const authorizedDeferral = exception?.status === 'deferred' && exception.authorizedBy === 'user-delegated-decision'
        && exception.instruction === 'lo q tu creas mejor papu' && typeof exception.revisit === 'string' && exception.revisit.length > 20;
    const comparableRedRun = validRun && legacy.fail > 0 && legacy.exitCode === 1
        && legacy.newFailures === 0 && legacy.unmatchedFailureTitles?.length === 0
        && legacy.comparisonBaselineSha256 === '038ef53fc12e924fe0e7a0baad551fca75c1b786f1f62929f7f3315974d0da83';
    if (!green && !(authorizedDeferral && comparableRedRun)) {
        issues.push('legacy suite must be green or have explicit F2-E001 deferral with zero new failures against the fixed baseline');
    }
    if (evidence?.store?.integrity !== 'ok' || evidence.store.backupRestore !== true
        || evidence.store.actualLegacyCompatibility !== true || evidence.store.schemaTables !== 24 || evidence.store.schemaIndexes !== 13) {
        issues.push('store schema, consistent backup/restore and actual v1 compatibility evidence required');
    }
    return issues;
}
function main() {
    const issues = auditArchitecture(path.join(root, 'src/v2')).problems;
    for (const name of [
        'domain/ports.js', 'adapters/evolution/client.js', 'adapters/evolution/outbound.js',
        'adapters/evolution/media.js', 'adapters/evolution/groups.js', 'adapters/evolution/nativeTables.js',
        'adapters/evolution/echoGuard.js', 'adapters/store/sqlite.js', 'adapters/store/migrations/000-legacy.sql',
        'adapters/store/repos/users.js', 'adapters/store/repos/conversation.js', 'adapters/ai/gemini.js',
        'adapters/ai/groq.js', 'adapters/ai/keyPool.js', 'adapters/ai/circuitBreaker.js'
    ]) if (!fs.existsSync(path.join(root, 'src/v2', name))) issues.push(`missing required module ${name}`);
    let evidence;
    try { evidence = JSON.parse(fs.readFileSync(path.join(root, 'docs/refactor/phase2-evidence.json'), 'utf8')); }
    catch { issues.push('missing or invalid phase2-evidence.json'); }
    if (evidence) {
        issues.push(...evidenceProblems(evidence));
        if (evidence.legacy?.fail > 0) {
            try {
                const debt = JSON.parse(fs.readFileSync(path.join(root, 'docs/refactor/phase2-legacy-debt.json'), 'utf8'));
                const ids = debt.items.map(item => item.id);
                if (debt.exception !== 'F2-E001' || debt.remainingFailures !== evidence.legacy.fail
                    || debt.items.length !== evidence.legacy.fail || new Set(ids).size !== ids.length
                    || !debt.items.every(item => /^BF-\d{3}$/.test(item.id) && typeof item.file === 'string' && typeof item.revisit === 'string')) {
                    issues.push('deferred legacy debt inventory does not match the failing suite');
                }
            } catch { issues.push('missing or invalid deferred legacy debt inventory'); }
        }
    }
    if (evidence?.legacy?.fail > 0 && !issues.length) console.log('EXCEPTION F2-E001: legacy suite is red; prior failures remain deferred, zero new failures required.');
    for (const issue of issues) console.log(`GAP ${issue}`);
    console.log(`Gate 2: ${issues.length ? 'OPEN' : 'PASS'} (${issues.length} gaps). Evidence is an operational attestation, not a replacement for test execution.`);
    process.exitCode = issues.length ? 1 : 0;
}
if (require.main === module) main();
module.exports = { evidenceProblems };
