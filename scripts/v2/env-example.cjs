'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { javascriptFiles } = require('./check-architecture.cjs');
const root = path.resolve(__dirname, '../..');
function referencedEnv(source, filename) {
    const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const names = new Set();
    const aliases = new Set();
    const isProcessEnv = node => (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        && ts.isIdentifier(node.expression) && node.expression.text === 'process'
        && (ts.isPropertyAccessExpression(node) ? node.name.text === 'env'
            : ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'env');
    const isEnv = node => isProcessEnv(node) || (ts.isIdentifier(node) && aliases.has(node.text));
    function collect(node) {
        if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.initializer && isEnv(node.initializer)) {
            if (ts.isIdentifier(node.name)) aliases.add(node.name.text);
            if (ts.isObjectBindingPattern(node.name)) {
                for (const element of node.name.elements) {
                    const name = element.propertyName || element.name;
                    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) names.add(name.text);
                }
            }
        }
        ts.forEachChild(node, collect);
    }
    collect(tree); collect(tree);
    function visit(node) {
        if (ts.isPropertyAccessExpression(node) && isEnv(node.expression)) names.add(node.name.text);
        if (ts.isElementAccessExpression(node) && isEnv(node.expression)
            && ts.isStringLiteralLike(node.argumentExpression)) names.add(node.argumentExpression.text);
        ts.forEachChild(node, visit);
    }
    visit(tree);
    return [...names];
}
function referencedPythonEnv(source) {
    const code = source.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
    return [...code.matchAll(/\bos\.(?:getenv\(\s*|environ(?:\.get\(\s*|\[\s*))['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g)].map(match => match[1]);
}
function pythonFiles(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? pythonFiles(file) : entry.isFile() && entry.name.endsWith('.py') ? [file] : [];
    });
}
function undocumentedEnv(schema, infrastructure, patterns) {
    const used = new Set();
    const files = ['src', 'scripts'].flatMap(directory => javascriptFiles(path.join(root, directory)));
    files.push(path.join(root, 'ecosystem.config.js'));
    for (const file of files) if (fs.existsSync(file)) {
        for (const name of referencedEnv(fs.readFileSync(file, 'utf8'), file)) used.add(name);
    }
    for (const file of pythonFiles(path.join(root, 'src'))) {
        for (const name of referencedPythonEnv(fs.readFileSync(file, 'utf8'))) used.add(name);
    }
    return [...used].filter(name => !Object.hasOwn(schema, name) && !infrastructure.includes(name)
        && !patterns.some(entry => entry.pattern.test(name))).sort();
}
function main() {
    if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--write')) throw new Error('Usage: env-example.cjs [--write]');
    const { generateEnvExample } = require('../../src/v2/config');
    const { ENV_SCHEMA, INFRASTRUCTURE_ENV, DYNAMIC_ENV_PATTERNS } = require('../../src/v2/config/schema');
    const missing = undocumentedEnv(ENV_SCHEMA, INFRASTRUCTURE_ENV, DYNAMIC_ENV_PATTERNS);
    if (missing.length) throw new Error('Undocumented environment names: ' + missing.join(', '));
    const expected = generateEnvExample();
    const filename = path.join(root, '.env.example');
    if (process.argv[2] === '--write') fs.writeFileSync(filename, expected);
    else if (fs.readFileSync(filename, 'utf8') !== expected) throw new Error('.env.example differs from schema; run npm run env:generate');
    console.log(`Environment: ${Object.keys(ENV_SCHEMA).length} documented settings; generated template matches schema.`);
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { referencedEnv, referencedPythonEnv, undocumentedEnv };
