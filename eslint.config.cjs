'use strict';
const noGlobalState = require('./scripts/v2/no-global-state.cjs');
module.exports = [
    { ignores: ['node_modules/**'] },
    {
        files: ['src/v2/**/*.js', 'scripts/v2/**/*.cjs', 'tests/unit/v2/**/*.js', 'tests/unit/tooling/**/*.js', 'tests/contract/**/*.js', 'tests/scenario/**/*.js', 'tests/helpers/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022, sourceType: 'commonjs',
            globals: Object.fromEntries(['process', 'Buffer', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'URL', 'AbortController', 'Response', 'structuredClone', '__dirname', '__filename', 'global', 'globalThis'].map(name => [name, 'readonly']))
        },
        linterOptions: { reportUnusedDisableDirectives: 'error' },
        rules: { 'no-undef': 'error', 'no-unreachable': 'error', 'no-dupe-keys': 'error', 'no-constant-condition': ['error', { checkLoops: false }] }
    },
    {
        files: ['src/v2/**/*.js'],
        plugins: { architecture: { rules: { 'no-global-state': noGlobalState } } },
        rules: { 'architecture/no-global-state': 'error' }
    }
];
