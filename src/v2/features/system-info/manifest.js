// @ts-check
'use strict';
const { createSystemInfoHandler } = require('./handler');
/** @param {{getStatus:(signal:AbortSignal)=>import('./handler').StatusSnapshot|Promise<import('./handler').StatusSnapshot>}} options
 * @returns {import('../../pipeline/contracts').Feature} */
function createSystemInfoFeature(options) {
    const argsSchema = { type: 'object', properties: { detail: { type: 'boolean' } }, additionalProperties: false };
    return { id: 'system-info', commands: [{ name: 'estado', aliases: ['estadobot', 'status'],
        scope: ['private', 'group'], access: 'public', tier: 'light', allowLong: false,
        argsSchema,
        parseExplicit,
        help: { short: 'Estado actual del bot.', examples: ['¿Cómo estás?', 'Dame el estado detallado.'] },
        handler: createSystemInfoHandler(options) }], intents: [{ id: 'system-info.status',
        description: 'Consultar estado del bot; detail true únicamente si se pide el informe detallado.',
        schema: argsSchema, command: 'estado' }] };
}
/** @param {string[]} tokens @returns {Record<string,unknown>} */
function parseExplicit(tokens) {
    if (tokens.some(token => token !== '--detail' && token !== 'detallado')) throw new TypeError('Invalid explicit status arguments');
    return tokens.length ? { detail: true } : {};
}
module.exports = { createSystemInfoFeature };
