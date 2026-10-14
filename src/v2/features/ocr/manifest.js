// @ts-check
'use strict';
const { createOcrHandler } = require('./handler');

/** @param {Parameters<typeof createOcrHandler>[0]} ports @returns {import('../../pipeline/contracts').Feature} */
function createOcrFeature(ports) {
    const argsSchema = { type: 'object', properties: {}, additionalProperties: false };
    return { id: 'ocr', commands: [{ name: 'leer', aliases: ['ocr'], scope: ['private', 'group'], access: 'public', tier: 'heavy', timeoutMs: 65_000,
        argsSchema, parseExplicit, allowLong: true,
        help: { short: 'Extrae texto de una imagen o documento adjunto.', examples: ['leer (responde a una imagen)', 'ocr (responde a un PDF)'] },
        handler: createOcrHandler(ports) }], intents: [{ id: 'ocr.read', description: 'Leer el texto de una imagen o documento adjunto.', schema: argsSchema, command: 'leer' }] };
}

/** @param {string[]} tokens @returns {Record<string,unknown>} */
function parseExplicit(tokens) {
    if (tokens.length) throw new TypeError('Invalid explicit OCR arguments');
    return {};
}

module.exports = { createOcrFeature, parseExplicit };
