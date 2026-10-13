// @ts-check
'use strict';
const { createHelpHandler } = require('./handler');
/** @param {{features:import('../../pipeline/contracts').Feature[]|(()=>import('../../pipeline/contracts').Feature[])}} options
 * @returns {import('../../pipeline/contracts').Feature} */
function createHelpFeature(options) {
    const argsSchema = { type: 'object', properties: { command: { type: 'string', maxLength: 80 }, detail: { type: 'boolean' } }, additionalProperties: false };
    return { id: 'help', commands: [{ name: 'ayuda', aliases: ['help'],
        scope: ['private', 'group'], access: 'public', tier: 'none', allowLong: true,
        argsSchema,
        parseExplicit,
        help: { short: 'Acciones disponibles y ejemplos.', examples: ['¿Qué puedes hacer?', 'Explícame cómo pedir el estado.'] },
        handler: createHelpHandler(options) }], intents: [{ id: 'help.show',
        description: 'Mostrar acciones disponibles o explicar una acción concreta y sus ejemplos.',
        schema: argsSchema, command: 'ayuda' }] };
}
/** Explicit CLI compatibility, never classification of natural conversation.
 * @param {string[]} tokens @returns {Record<string,unknown>} */
function parseExplicit(tokens) {
    /** @type {Record<string,unknown>} */
    const args = {};
    for (const token of tokens) {
        if (token === '--detail' || token === 'detallado') args.detail = true;
        else if (!token.startsWith('-') && !args.command && token.length <= 80) args.command = token.toLowerCase();
        else throw new TypeError('Invalid explicit help arguments');
    }
    return args;
}
module.exports = { createHelpFeature };
