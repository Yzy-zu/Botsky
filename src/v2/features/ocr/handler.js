// @ts-check
'use strict';
const { AppError } = require('../../domain/errors');

const MAX_OCR_TEXT_CHARS = 32 * 1024;
const OCR_TRUNCATION_NOTICE = '\n\n[Texto OCR recortado por límite de tamaño.]';

/** @param {string} value */
function boundedOcrText(value) {
    if (value.length <= MAX_OCR_TEXT_CHARS) return value;
    const budget = MAX_OCR_TEXT_CHARS - OCR_TRUNCATION_NOTICE.length;
    let used = 0, prefix = '';
    for (const char of value) { if (used + char.length > budget) break; prefix += char; used += char.length; }
    return `${prefix}${OCR_TRUNCATION_NOTICE}`;
}

/** @param {{readText:(attachment:import('../../pipeline/contracts').Attachment,options:{language:'spa+eng',signal:AbortSignal})=>Promise<string>}} ports */
function createOcrHandler({ readText }) {
    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} _args @param {AbortSignal} signal
     * @returns {Promise<import('../../domain/types').Reply>} */
    return async function ocr(ctx, _args, signal) {
        signal.throwIfAborted();
        const attachment = ctx.attachment;
        const isReadable = Boolean(attachment && (attachment.kind === 'image' || attachment.kind === 'document' ||
            attachment.mime.toLowerCase().startsWith('image/') || attachment.mime.toLowerCase() === 'application/pdf'));
        if (!isReadable || !attachment) {
            return { parts: [{ type: 'text', text: 'Responde a la imagen con `leer` y saco el texto.' }], replyTo: ctx.event.id };
        }
        try {
            const extracted = await readText(attachment, { language: 'spa+eng', signal });
            signal.throwIfAborted();
            const text = typeof extracted === 'string' ? boundedOcrText(extracted.trim()) : '';
            return { parts: [{ type: 'text', text: text
                ? `Esto alcancé a leer:\n\n${text}`
                : 'No alcancé a leer texto. Prueba con una foto más nítida, de frente y con buena luz.' }], replyTo: ctx.event.id };
        } catch (error) {
            signal.throwIfAborted();
            if (error instanceof AppError) throw error;
            return { parts: [{ type: 'text', text: 'No pude leer esa imagen. Intenta de nuevo con una foto más nítida.' }], replyTo: ctx.event.id };
        }
    };
}

module.exports = { createOcrHandler, boundedOcrText, MAX_OCR_TEXT_CHARS };
