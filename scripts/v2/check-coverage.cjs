'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { javascriptFiles } = require('./check-architecture.cjs');
const root = path.resolve(__dirname, '../..');
const requiredFiles = ['config/schema.js', 'config/index.js', 'platform/ttlStore.js', 'platform/queue.js', 'platform/scheduler.js'];
function coverageProblems(files) {
    const problems = [];
    const phaseThreeFiles = ['pipeline', 'policies'].flatMap(directory => javascriptFiles(path.join(root, 'src/v2', directory))).filter(file => !file.endsWith('/contracts.js')).map(file => path.relative(path.join(root, 'src/v2'), file));
    const featureFiles = javascriptFiles(path.join(root, 'src/v2/features')).map(file => path.relative(path.join(root, 'src/v2'), file));
    for (const name of [...requiredFiles, ...phaseThreeFiles, ...featureFiles]) {
        const file = files.find(entry => path.normalize(entry.path) === path.join(root, 'src/v2', name));
        const minimum = name.startsWith('features/') ? 70 : 90;
        if (!file || !Number.isFinite(file.lines) || file.lines < minimum) problems.push(`${name}: ${file?.lines ?? 'missing'}% lines; need >=${minimum}%`);
    }
    return problems;
}
function main() {
    const tests = ['tests/unit/v2', 'tests/unit/tooling', 'tests/contract', 'tests/scenario'].flatMap(directory => javascriptFiles(path.join(root, directory)))
        .filter(file => file.endsWith('.test.js'));
    if (!tests.length) throw new Error('No v2 tests found');
    const environment = { ...process.env };
    delete environment.NODE_V8_COVERAGE;
    const result = spawnSync(process.execPath, ['--test', '--experimental-test-coverage',
        '--test-reporter=' + path.join(__dirname, 'coverage-reporter.cjs'), ...tests], {
        cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
        env: environment
    });
    const output = result.stdout || '';
    for (const line of output.split('\n')) if (line && !line.startsWith('V2_COVERAGE=')) console.log(line);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error || result.status !== 0) { console.error(`v2 test runner failed: status=${result.status}, signal=${result.signal}, error=${result.error?.code || 'none'}`); process.exitCode = 1; return; }
    const line = output.split('\n').find(entry => entry.startsWith('V2_COVERAGE='));
    if (!line) { console.error('Coverage report missing'); process.exitCode = 1; return; }
    const files = JSON.parse(line.slice('V2_COVERAGE='.length));
    const problems = coverageProblems(files);
    for (const file of files.filter(entry => entry.path.startsWith(path.join(root, 'src/v2') + path.sep))) {
        console.log(`${path.relative(root, file.path)}: lines ${file.lines}%, branches ${file.branches}%, functions ${file.functions}%`);
    }
    for (const problem of problems) console.error(problem);
    console.log(`Coverage gates (foundations and all implemented pipeline/policies): ${problems.length ? 'OPEN' : 'PASS'}`);
    process.exitCode = problems.length ? 1 : 0;
}
if (require.main === module) main();
module.exports = { coverageProblems };
