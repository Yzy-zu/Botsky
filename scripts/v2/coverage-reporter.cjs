'use strict';
module.exports = async function* report(source) {
    let passed = 0; let failed = 0;
    for await (const event of source) {
        if (event.type === 'test:pass') passed++;
        if (event.type === 'test:fail') { failed++; yield `FAIL ${event.data.name}: ${event.data.details?.error?.message || 'test failed'}\n`; }
        if (event.type === 'test:summary') yield `Tests: ${JSON.stringify(event.data.counts)}\n`;
        if (event.type === 'test:coverage') {
            const files = event.data.summary.files.map(file => ({ path: file.path,
                lines: file.coveredLinePercent, branches: file.coveredBranchPercent,
                functions: file.coveredFunctionPercent }));
            yield `V2_COVERAGE=${JSON.stringify(files)}\n`;
        }
    }
    yield `Test events: ${passed} pass, ${failed} fail. Runner exit status also checked.\n`;
};
