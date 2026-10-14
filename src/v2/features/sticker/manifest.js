// @ts-check
'use strict';

const { createStickerHandler, createEffectHandler, normalizeHttpUrl, EFFECTS } = require('./handler');

/** @param {Parameters<typeof createStickerHandler>[0]} ports @returns {import('../../pipeline/contracts').Feature} */
function createStickerFeature(ports) {
    const stickerSchema = { type: 'object', properties: { url: { type: 'string', maxLength: 2048 }, crop: { type: 'boolean' }, animated: { type: 'boolean' } }, additionalProperties: false };
    const effectSchema = { type: 'object', properties: { effect: { type: 'string', enum: [...EFFECTS] } }, additionalProperties: false };
    return { id: 'sticker', commands: [
        { name: 'sticker', aliases: ['s', 'stickers', 'calca', 'calcas', 'pegatina', 'pegatinas'], scope: ['private', 'group'],
            access: 'public', tier: 'heavy', timeoutMs: 120_000, argsSchema: stickerSchema, parseExplicit: parseSticker,
            help: { short: 'Crea un sticker de una imagen o video.', examples: ['sticker (responde a una imagen)', 'sticker -r', 'sticker -a'] },
            handler: createStickerHandler(ports) },
        { name: 'efecto', scope: ['private', 'group'], access: 'public', tier: 'heavy', timeoutMs: 120_000, argsSchema: effectSchema,
            parseExplicit: parseEffect, help: { short: 'Aplica un efecto a un audio o video citado.', examples: ['efecto ardilla', 'efecto reversa'] },
            handler: createEffectHandler(ports) }
    ], intents: [
        { id: 'sticker.create', description: 'Crear un sticker desde una imagen o video adjunto.', schema: stickerSchema, command: 'sticker' },
        { id: 'sticker.effect', description: 'Aplicar un efecto de audio a un audio o video adjunto.', schema: effectSchema, command: 'efecto' }
    ] };
}

/** @param {string[]} tokens @returns {Record<string,unknown>} */
function parseSticker(tokens) {
    let crop = false, animated = false;
    const source = [];
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index].toLowerCase();
        if (['-r', '--r', '--crop', '--recortar'].includes(token)) crop = true;
        else if (['-a', '--a', '--animated', '--animado'].includes(token)) animated = true;
        else if (token.startsWith('-')) throw new TypeError('Invalid explicit sticker arguments');
        else source.push(tokens[index]);
    }
    const result = { crop, animated };
    if (!source.length) return result;
    try {
        const url = normalizeHttpUrl(source.join(' '));
        if (url.length > 2048) throw new TypeError('Invalid explicit sticker arguments');
        return { ...result, url };
    } catch { throw new TypeError('Invalid explicit sticker arguments'); }
}

/** @param {string[]} tokens @returns {Record<string,unknown>} */
function parseEffect(tokens) {
    if (tokens.length === 0) return {};
    if (tokens.length !== 1 || !EFFECTS.includes(tokens[0].toLowerCase())) throw new TypeError('Invalid explicit effect arguments');
    return { effect: tokens[0].toLowerCase() };
}

module.exports = { createStickerFeature, parseSticker, parseEffect };
