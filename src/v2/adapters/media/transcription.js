// @ts-check
'use strict';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TRANSCRIPTION_TIMEOUT_MS = 90_000;
const SUMMARY_TIMEOUT_MS = 30_000;
const MAX_TRANSCRIPT_CHARS = 32 * 1024;
const MAX_SUMMARY_CHARS = 4 * 1024;
const TRANSCRIPT_TRUNCATION_NOTICE = '[Transcripción recortada por límite de tamaño.]';
const SUMMARY_TRUNCATION_NOTICE = '[Resumen recortado por límite de tamaño.]';
const { AppError } = require('../../domain/errors');

/** @param {string} text @param {number} limit @param {string} notice */
function capText(text, limit, notice) {
    if (text.length <= limit) return text;
    const suffix = `\n\n${notice}`;
    const budget = Math.max(0, limit - suffix.length);
    let used = 0, prefix = '';
    for (const char of text) { if (used + char.length > budget) break; prefix += char; used += char.length; }
    return `${prefix}${suffix}`;
}

/** @typedef {{buffer:Buffer,extension:string,mime:string}} AudioBlob */
/** @typedef {{ref:string,mime:string,id?:string,chatId?:string,ownerJid?:string,url?:boolean}} MediaSource */
/** @typedef {{downloadMedia:(source:MediaSource,options:{maxBytes:number,signal:AbortSignal})=>Promise<AudioBlob>,downloadUrl?:(url:string,options:{maxBytes:number,signal:AbortSignal})=>Promise<AudioBlob>,http:{post:(url:string,form:unknown,options:{headers:Record<string,string>,timeout:number,signal:AbortSignal,maxContentLength:number})=>Promise<{data?:unknown}>},formData:()=>{append:(name:string,value:string|Buffer,options?:{filename:string,contentType:string})=>void,getHeaders:()=>Record<string,string>},config:{groqApiKey:string,groqEndpoint?:string},fallbackTranscribe?:(input:{buffer:Buffer,mime:string,model:string,language:string,signal:AbortSignal})=>Promise<{text:string,duration?:number|null,language?:string|null}>,summarizeText?:(text:string,options:{signal:AbortSignal})=>Promise<string|null|undefined>,maxAudioBytes?:number,timeoutMs?:number,summaryTimeoutMs?:number}} TranscriptionAdapterOptions */

function abortError() { return Object.assign(new Error('Operation aborted'), { name: 'AbortError' }); }

/** @template T @param {(signal:AbortSignal)=>Promise<T>} operation @param {AbortSignal} parent @param {number} timeoutMs */
async function bounded(operation, parent, timeoutMs) {
    parent.throwIfAborted();
    const controller = new AbortController();
    /** @type {(reason?:unknown)=>void} */ let rejectAbort = () => {};
    const aborted = new Promise((resolve, reject) => { rejectAbort = reject; });
    /** @param {unknown} reason */
    const stop = reason => {
        if (!controller.signal.aborted) controller.abort(reason);
        rejectAbort(reason || abortError());
    };
    const onAbort = () => stop(parent.reason || abortError());
    parent.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => stop(Object.assign(new Error('Operation timed out'), { name: 'TimeoutError' })), timeoutMs);
    try {
        const result = await Promise.race([operation(controller.signal), aborted]);
        parent.throwIfAborted();
        if (controller.signal.aborted) throw controller.signal.reason || abortError();
        return result;
    } finally {
        clearTimeout(timer);
        parent.removeEventListener('abort', onAbort);
    }
}

/** @param {unknown} value @param {number} maxBytes @returns {asserts value is AudioBlob} */
function assertAudio(value, maxBytes) {
    if (!value || typeof value !== 'object' || !Buffer.isBuffer(/** @type {AudioBlob} */ (value).buffer) ||
        /** @type {AudioBlob} */ (value).buffer.length < 1 || /** @type {AudioBlob} */ (value).buffer.length > maxBytes) {
        throw new Error('Audio is invalid or exceeds the configured limit');
    }
    const ext = String(/** @type {AudioBlob} */ (value).extension || '').replace(/^\./, '').toLowerCase();
    if (!['mp3', 'wav', 'm4a', 'mp4', 'ogg', 'opus', 'webm', 'mpeg', 'flac'].includes(ext)) throw new Error('Unsupported audio format');
    if (!/^audio\//i.test(/** @type {AudioBlob} */ (value).mime) && ext !== 'mp4' && ext !== 'webm') throw new Error('Invalid audio MIME type');
}

/** @param {TranscriptionAdapterOptions} options */
function createTranscriptionMedia({ downloadMedia, downloadUrl, http, formData, config, fallbackTranscribe, summarizeText,
    maxAudioBytes = MAX_AUDIO_BYTES, timeoutMs = TRANSCRIPTION_TIMEOUT_MS, summaryTimeoutMs = SUMMARY_TIMEOUT_MS }) {
    if (typeof downloadMedia !== 'function' || !http || typeof http.post !== 'function' || typeof formData !== 'function') throw new TypeError('Audio download, HTTP, and multipart ports are required');
    if (typeof config?.groqApiKey !== 'string' || (!config.groqApiKey && !fallbackTranscribe)) throw new TypeError('Groq API key or fallback is required');
    if (![maxAudioBytes, timeoutMs, summaryTimeoutMs].every(Number.isSafeInteger) || maxAudioBytes < 1 || timeoutMs < 1 || summaryTimeoutMs < 1) throw new RangeError('Invalid transcription resource limits');
    const endpoint = config.groqEndpoint || 'https://api.groq.com/openai/v1/audio/transcriptions';

    /** @param {MediaSource} source @param {{model:string,language:string,signal:AbortSignal}} request */
    async function transcribe(source, { model, language, signal }) {
        if (!source || typeof source.ref !== 'string' || !source.ref) throw new TypeError('Audio source required');
        signal.throwIfAborted();
        let audio;
        try {
            if (source.url) {
                if (!downloadUrl) throw new Error('URL audio download is unavailable');
                audio = await bounded(inner => downloadUrl(source.ref, { maxBytes: maxAudioBytes, signal: inner }), signal, timeoutMs);
            } else {
                if (!source.id || !source.chatId) throw new Error('Audio message identity is incomplete');
                audio = await bounded(inner => downloadMedia(source, { maxBytes: maxAudioBytes, signal: inner }), signal, timeoutMs);
            }
            assertAudio(audio, maxAudioBytes);
        } catch (error) {
            signal.throwIfAborted();
            if (error instanceof AppError) throw error;
            throw new Error('Audio download failed');
        }

        try {
            if (!config.groqApiKey) throw new Error('Groq is not configured');
            const result = await bounded(async inner => {
                const form = formData();
                form.append('file', audio.buffer, { filename: `audio.${audio.extension.replace(/^\./, '')}`, contentType: audio.mime });
                form.append('model', model);
                form.append('response_format', 'verbose_json');
                if (language !== 'auto') form.append('language', language);
                const response = await http.post(endpoint, form, {
                    headers: { ...form.getHeaders(), Authorization: `Bearer ${config.groqApiKey}` },
                    timeout: timeoutMs,
                    signal: inner,
                    maxContentLength: 1024 * 1024
                });
                const data = response?.data;
                if (!data || typeof data !== 'object' || typeof /** @type {{text?:unknown}} */ (data).text !== 'string') throw new Error('Invalid transcription response');
                const payload = /** @type {{text:string,duration?:number,language?:string}} */ (data);
                return { text: capText(payload.text, MAX_TRANSCRIPT_CHARS, TRANSCRIPT_TRUNCATION_NOTICE), ...(Number.isFinite(payload.duration) ? { duration: payload.duration } : {}), ...(typeof payload.language === 'string' ? { language: payload.language } : {}) };
            }, signal, timeoutMs);
            return result;
        } catch (error) {
            signal.throwIfAborted();
            if (error instanceof AppError) throw error;
            if (!fallbackTranscribe) throw new Error('Transcription providers failed');
            try {
                const fallback = await bounded(inner => fallbackTranscribe({ buffer: audio.buffer, mime: audio.mime, model, language, signal: inner }), signal, timeoutMs);
                if (!fallback || typeof fallback.text !== 'string') throw new Error('Invalid fallback transcription');
                return { ...fallback, text: capText(fallback.text, MAX_TRANSCRIPT_CHARS, TRANSCRIPT_TRUNCATION_NOTICE) };
            } catch (fallbackError) {
                signal.throwIfAborted();
                if (fallbackError instanceof AppError) throw fallbackError;
                throw new Error('Transcription providers failed');
            }
        }
    }

    /** @param {string} url @param {AbortSignal} signal */
    async function downloadAudioUrl(url, signal) {
        if (!downloadUrl) throw new Error('URL audio download is unavailable');
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new TypeError('Invalid audio URL');
        signal.throwIfAborted();
        return { ref: parsed.href, mime: 'audio/*', url: true };
    }

    /** @param {string} text @param {AbortSignal} signal */
    async function summarize(text, signal) {
        if (!summarizeText) return null;
        const boundedInput = capText(text, MAX_TRANSCRIPT_CHARS, TRANSCRIPT_TRUNCATION_NOTICE);
        const summary = await bounded(inner => summarizeText(boundedInput, { signal: inner }), signal, summaryTimeoutMs);
        return typeof summary === 'string' ? capText(summary, MAX_SUMMARY_CHARS, SUMMARY_TRUNCATION_NOTICE) : summary;
    }

    return { transcribe, downloadUrl: downloadAudioUrl, summarize };
}

module.exports = { createTranscriptionMedia, assertAudio, capText, MAX_AUDIO_BYTES, MAX_TRANSCRIPT_CHARS, MAX_SUMMARY_CHARS, TRANSCRIPTION_TIMEOUT_MS };
