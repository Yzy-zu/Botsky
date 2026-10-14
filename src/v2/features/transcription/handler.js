// @ts-check
'use strict';
const { AppError } = require('../../domain/errors');

/** @type {Readonly<Record<string,string>>} */
const MODELS = Object.freeze({
    turbo: 'whisper-large-v3-turbo', fast: 'whisper-large-v3-turbo', large: 'whisper-large-v3',
    'large-v3': 'whisper-large-v3', 'whisper-large-v3-turbo': 'whisper-large-v3-turbo',
    'whisper-large-v3': 'whisper-large-v3', small: 'whisper-large-v3-turbo', base: 'whisper-large-v3-turbo', tiny: 'whisper-large-v3-turbo'
});
const LANGUAGES = Object.freeze(['auto', 'es', 'en', 'fr', 'de', 'pt', 'it', 'zh', 'ja', 'ko', 'ru', 'ar', 'nl', 'pl', 'tr']);
const DEFAULT_MODEL = 'whisper-large-v3-turbo';
const MAX_TRANSCRIPT_CHARS = 32 * 1024;
const MAX_SUMMARY_CHARS = 4 * 1024;
const MAX_CONTENT_CHUNKS = 11;
const TRANSCRIPT_TRUNCATION_NOTICE = '[Transcripción recortada por límite de tamaño.]';
const SUMMARY_TRUNCATION_NOTICE = '[Resumen recortado por límite de tamaño.]';

/** @param {string} text @param {number} limit @param {string} notice */
function boundedText(text, limit, notice) {
    if (text.length <= limit) return text;
    const suffix = `\n\n${notice}`;
    const budget = Math.max(0, limit - suffix.length);
    let used = 0, prefix = '';
    for (const char of text) { if (used + char.length > budget) break; prefix += char; used += char.length; }
    return `${prefix}${suffix}`;
}

/** @typedef {{ref:string,mime:string,id?:string,chatId?:string,ownerJid?:string,url?:boolean}} MediaRef */
/** @typedef {{text:string,duration?:number|null,language?:string|null}} Transcription */
/** @typedef {{transcribe:(media:MediaRef,options:{model:string,language:string,signal:AbortSignal})=>Promise<Transcription>,downloadUrl?:(url:string,signal:AbortSignal)=>Promise<MediaRef>,summarize?:(text:string,signal:AbortSignal)=>Promise<string|null|undefined>,defaultLanguage?:string}} TranscriptionPorts */

/** @param {unknown} value @returns {value is MediaRef} */
function isMediaRef(value) {
    return Boolean(value && typeof value === 'object' && typeof /** @type {MediaRef} */ (value).ref === 'string' &&
        /** @type {MediaRef} */ (value).ref.trim() && typeof /** @type {MediaRef} */ (value).mime === 'string' &&
        /** @type {MediaRef} */ (value).mime.trim());
}

/** @param {unknown} value @returns {string|undefined} */
function normalizeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    let parsed;
    try { parsed = new URL(value.trim()); } catch { throw new TypeError('Invalid audio URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new TypeError('Invalid audio URL');
    return parsed.href;
}

/** @param {string} text @param {number} [maxLength] */
function splitText(text, maxLength = 3500) {
    let chars = Array.from(text);
    const maxTotal = maxLength * MAX_CONTENT_CHUNKS;
    if (text.length > maxTotal) {
        const suffix = '\n\n[Respuesta recortada por límite de partes.]';
        const budget = maxTotal - suffix.length;
        let used = 0; const prefix = [];
        for (const char of chars) { if (used + char.length > budget) break; prefix.push(char); used += char.length; }
        chars = [...prefix, ...Array.from(suffix)];
    }
    const parts = [];
    let start = 0;
    while (start < chars.length && parts.length < MAX_CONTENT_CHUNKS) {
        let end = start, units = 0;
        while (end < chars.length && units + chars[end].length <= maxLength) { units += chars[end].length; end++; }
        if (end < chars.length) {
            const newline = chars.lastIndexOf('\n', end - 1);
            if (newline > start + Math.floor(maxLength * 0.75)) end = newline + 1;
        }
        const part = chars.slice(start, end).join('').trim();
        if (part) parts.push(part);
        start = end;
    }
    return parts;
}

/** @param {TranscriptionPorts} ports */
function createTranscriptionHandler({ transcribe, downloadUrl, summarize, defaultLanguage = 'auto' }) {
    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} args @param {AbortSignal} signal
     * @returns {Promise<import('../../domain/types').Reply>} */
    return async function transcription(ctx, args, signal) {
        signal.throwIfAborted();
        const language = typeof args.language === 'string' ? args.language : defaultLanguage;
        if (!LANGUAGES.includes(language)) return textReply(ctx, `idioma inválido · usa: ${LANGUAGES.join(' ')}`);
        const rawModel = typeof args.model === 'string' ? args.model : DEFAULT_MODEL;
        const model = MODELS[rawModel];
        if (!model) return textReply(ctx, 'Modelo inválido · usa: turbo o large.');

        let media;
        try {
            const url = normalizeUrl(args.url);
            if (url) {
                if (!downloadUrl) return textReply(ctx, 'La transcripción desde URL no está disponible por ahora. Adjunta un audio.');
                media = await downloadUrl(url, signal);
                signal.throwIfAborted();
            } else if (ctx.attachment && (ctx.attachment.kind === 'audio' || ctx.attachment.mime.toLowerCase().startsWith('audio/'))) {
                media = { ...ctx.attachment };
            } else {
                return textReply(ctx, 'No se encontró audio · adjunta un audio, responde a uno o pasa una URL.');
            }
            if (!isMediaRef(media)) throw new Error('Invalid media adapter result');

            const result = await transcribe(media, { model, language, signal });
            signal.throwIfAborted();
            const transcript = typeof result?.text === 'string' ? boundedText(result.text.trim(), MAX_TRANSCRIPT_CHARS, TRANSCRIPT_TRUNCATION_NOTICE) : '';
            if (!transcript) return textReply(ctx, 'No alcancé a distinguir lo que se dice. Prueba con un audio más claro o con menos ruido.');

            const wordCount = transcript.split(/\s+/).length;
            let summary = null;
            if ((args.summarize === true || wordCount >= 60) && summarize) {
                try {
                    const rawSummary = await summarize(transcript, signal);
                    summary = typeof rawSummary === 'string'
                        ? boundedText(rawSummary.trim(), MAX_SUMMARY_CHARS, SUMMARY_TRUNCATION_NOTICE) : rawSummary;
                    signal.throwIfAborted();
                } catch (error) {
                    signal.throwIfAborted();
                    if (error instanceof AppError) throw error;
                    summary = null;
                }
            }
            const duration = typeof result.duration === 'number' && Number.isFinite(result.duration) && result.duration > 0
                ? ` · ${Math.round(result.duration * 10) / 10}s` : '';
            let message = `🎙️ *Esto dice el audio*${duration}\n\n"${transcript}"`;
            if (typeof summary === 'string' && summary.trim()) message += `\n\n*Lo principal:*\n${summary.trim()}`;
            const chunks = splitText(message);
            const parts = /** @type {import('../../domain/types').Reply['parts']} */ (chunks.length > 1
                ? [{ type: 'text', text: `El audio salió largo. Te lo paso en ${chunks.length} partes:` }, ...chunks.map((text, index) => ({ type: 'text', text: `*Parte ${index + 1} de ${chunks.length}*\n\n${text}` }))]
                : [{ type: 'text', text: message }]);
            return { parts, replyTo: ctx.event.id };
        } catch (error) {
            signal.throwIfAborted();
            if (error instanceof AppError) throw error;
            return textReply(ctx, 'No pude transcribir el audio. Intenta de nuevo con un audio más claro.');
        }
    };
}

/** @param {import('../../pipeline/contracts').Ctx} ctx @param {string} text
 * @returns {import('../../domain/types').Reply} */
function textReply(ctx, text) { return { parts: [{ type: 'text', text }], replyTo: ctx.event.id }; }

module.exports = { createTranscriptionHandler, MODELS, LANGUAGES, normalizeUrl, splitText, boundedText,
    MAX_TRANSCRIPT_CHARS, MAX_SUMMARY_CHARS, MAX_CONTENT_CHUNKS };
