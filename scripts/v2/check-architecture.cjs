'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');
const ts = require('typescript');

function javascriptFiles(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(directory, entry.name);
        return entry.isDirectory() ? javascriptFiles(full) : entry.isFile() && /\.(?:js|cjs)$/.test(entry.name) ? [full] : [];
    }).sort();
}
function imports(source, filename) {
    const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const found = [];
    function visit(node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            if (node.moduleSpecifier) found.push(ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null);
        }
        if (ts.isVariableDeclaration(node) && node.initializer && ((ts.isIdentifier(node.initializer) && node.initializer.text === 'require')
            || (ts.isPropertyAccessExpression(node.initializer) && node.initializer.name.text === 'require'))) found.push(null);
        if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === 'require')
            || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'require')
            || (ts.isElementAccessExpression(node.expression) && ts.isStringLiteralLike(node.expression.argumentExpression) && node.expression.argumentExpression.text === 'require')
            || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
            const argument = node.arguments[0];
            found.push(argument && ts.isStringLiteralLike(argument) ? argument.text : null);
        }
        ts.forEachChild(node, visit);
    }
    visit(tree);
    return found;
}
function readsEnvironment(source, filename) {
    const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    let found = false;
    function visit(node) {
        const access = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
        if (access && ts.isIdentifier(node.expression) && node.expression.text === 'process') {
            const name = ts.isPropertyAccessExpression(node) ? node.name.text
                : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : '';
            if (name === 'env') found = true;
        }
        if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.initializer)
            && node.initializer.text === 'process' && ts.isObjectBindingPattern(node.name)) {
            for (const element of node.name.elements) {
                const name = element.propertyName || element.name;
                if (ts.isIdentifier(name) && name.text === 'env') found = true;
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(tree); return found;
}
function auditArchitecture(directory) {
    const root = path.resolve(directory);
    const files = javascriptFiles(root);
    const graph = new Map();
    const problems = [];
    const layer = file => path.relative(root, file).split(path.sep)[0];
    for (const file of files) {
        const label = path.relative(root, file);
        const dependencies = [];
        graph.set(file, dependencies);
        const source = fs.readFileSync(file, 'utf8');
        if (layer(file) !== 'config' && readsEnvironment(source, file)) {
            problems.push(`${label}: process.env must be read through config`);
        }
        for (const specifier of imports(source, file)) {
            if (specifier === null) { problems.push(`${label}: dynamic import cannot be audited`); continue; }
            if (!specifier.startsWith('.')) {
                if (['config', 'domain', 'platform', 'pipeline', 'policies', 'features'].includes(layer(file))
                    && !builtinModules.includes(specifier.replace(/^node:/, ''))) problems.push(`${label}: external implementation ${specifier} requires an adapter`);
                continue;
            }
            const base = path.resolve(path.dirname(file), specifier);
            const target = [base, base + '.js', base + '.cjs', path.join(base, 'index.js')]
                .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
            if (!target) { problems.push(`${label}: unresolved ${specifier}`); continue; }
            const real = fs.realpathSync(target);
            if (!real.startsWith(root + path.sep)) { problems.push(`${label}: import outside v2 (${specifier})`); continue; }
            dependencies.push(real);
            const from = layer(file); const to = layer(real);
            const denied = from === 'domain' ? to !== 'domain'
                : from === 'config' ? to !== 'config'
                    : from === 'platform' ? ['adapters', 'pipeline', 'policies', 'features'].includes(to)
                        : ['pipeline', 'policies'].includes(from) ? ['features', 'adapters'].includes(to)
                            : from === 'features' ? to === 'adapters' : false;
            if (denied) problems.push(`${label}: forbidden dependency ${from} -> ${to}`);
            if (from === 'adapters' && to === 'adapters'
                && path.relative(root, file).split(path.sep)[1] !== path.relative(root, real).split(path.sep)[1]) {
                problems.push(`${label}: adapters cannot import another adapter family`);
            }
        }
    }
    const active = new Set(); const done = new Set();
    function visit(file) {
        if (active.has(file)) { problems.push(`dependency cycle at ${path.relative(root, file)}`); return; }
        if (done.has(file)) return;
        active.add(file);
        for (const next of graph.get(file) || []) visit(next);
        active.delete(file); done.add(file);
    }
    for (const file of files) visit(file);
    return { files: files.length, problems };
}
if (require.main === module) {
    const result = auditArchitecture(path.resolve(__dirname, '../../src/v2'));
    for (const problem of result.problems) console.error(problem);
    console.log(`Architecture: ${result.files} v2 modules, ${result.problems.length} violations.`);
    process.exitCode = result.problems.length || !result.files ? 1 : 0;
}
module.exports = { auditArchitecture, javascriptFiles, imports };
