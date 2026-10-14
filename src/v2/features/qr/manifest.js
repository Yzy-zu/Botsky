// @ts-check
'use strict';
const { createQrHandler } = require('./handler');

/** @param {Parameters<typeof createQrHandler>[0]} ports @returns {import('../../pipeline/contracts').Feature} */
function createQrFeature(ports) {
    const argsSchema = { type: 'object', properties: { text: { type: 'string', maxLength: 2048 } }, additionalProperties: false };
    return { id: 'qr', commands: [{ name: 'qr', scope: ['private', 'group'], access: 'public', tier: 'heavy', timeoutMs: 30_000,
        argsSchema, parseExplicit, help: { short: 'Crea un código QR o lee uno de una imagen.', examples: ['qr https://ejemplo.com', 'qr (responde a una imagen)'] },
        handler: createQrHandler(ports) }], intents: [
        { id: 'qr.create', description: 'Crear un código QR para el texto indicado.', schema: argsSchema, command: 'qr' },
        { id: 'qr.read', description: 'Leer un código QR de la imagen adjunta o citada.', schema: argsSchema, command: 'qr' }
    ] };
}

/** @param {string[]} tokens @returns {Record<string,unknown>} */
function parseExplicit(tokens) {
    const text = tokens.join(' ').trim();
    if (text.length > 2048) throw new TypeError('Invalid explicit QR arguments');
    return text ? { text } : {};
}

module.exports = { createQrFeature, parseExplicit };
