// @ts-check
'use strict';
const { AppError } = require('../../domain/errors');

const VOICES = Object.freeze(['hombre', 'mujer', 'colombiano', 'colombiana', 'argentino', 'argentina', 'loquendo',
    'chileno', 'venezolano', 'peruano', 'ardilla', 'demonio', 'robot', 'radio', 'dross', 'goku', 'donramon',
    'babidi', 'anime', 'daniel', 'narrador', 'adam', 'charlie', 'george', 'harry', 'liam', 'alice', 'lily',
    'jessica', 'bill', 'elevenlabs', 'realista']);
const MODES = Object.freeze(['compose', 'verbatim']);
const MAX_VOICE_DURATION_SECONDS = 600;
const MAX_VOICE_TEXT_CHARS = 20_000;

/** @typedef {{ref:string,mime:string,durationSeconds?:number}} VoiceMedia */
/** @typedef {{success?:boolean,text?:string,voice?:string,mode?:string,durationSeconds?:number|null,question?:string,error?:string,needsClarification?:boolean}} VoiceScript */
/** @typedef {{request:string,literalText:string,mode:string,voice:string,durationSeconds:number|null,history:ReadonlyArray<{role:string,content:string}>,quotedText:string,userName:string,isGroup:boolean}} VoiceScriptInput */
/** @typedef {{prepareScript:(input:VoiceScriptInput,signal:AbortSignal)=>Promise<VoiceScript>,synthesize:(text:string,options:{voice:string,signal:AbortSignal})=>Promise<VoiceMedia>,fitDuration:(media:VoiceMedia,targetSeconds:number,signal:AbortSignal)=>Promise<VoiceMedia>}} VoicePorts */

/** @param {VoicePorts} ports */
function createVoiceHandler({ prepareScript, synthesize, fitDuration }) {
    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} args @param {AbortSignal} signal @returns {Promise<import('../../domain/types').Reply>} */
    return async function voice(ctx, args, signal) {
        signal.throwIfAborted();
        const voice = typeof args.voice === 'string' ? args.voice.toLowerCase() : 'hombre';
        const mode = typeof args.mode === 'string' ? args.mode : 'compose';
        const literalText = typeof args.literalText === 'string' ? args.literalText.trim() : '';
        const request = typeof args.instruction === 'string' ? args.instruction.trim() : '';
        const rawDuration = args.durationSeconds;
        const durationSeconds = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : null;
        if (!VOICES.includes(voice) || !MODES.includes(mode) || (durationSeconds !== null && (durationSeconds < 1 || durationSeconds > MAX_VOICE_DURATION_SECONDS)) || literalText.length > MAX_VOICE_TEXT_CHARS) {
            return textReply(ctx, 'No pude interpretar la voz, el texto o la duración. Indica una voz conocida, hasta 20,000 caracteres de texto y una duración de 1 a 600 segundos.');
        }
        const quotedText = ctx.event.quoted?.text || '';
        let script;
        try {
            script = await prepareScript({ request, literalText, mode, voice, durationSeconds,
                history: ctx.history.map(message => ({ role: message.role, content: message.content })), quotedText,
                userName: ctx.event.sender.name || 'Compa', isGroup: ctx.event.isGroup }, signal);
            signal.throwIfAborted();
        } catch (error) {
            signal.throwIfAborted();
            if (error instanceof AppError) throw error;
            return textReply(ctx, 'No pude preparar el texto para el audio. Dime de nuevo qué quieres que comunique.');
        }
        if (!script || script.success === false || script.needsClarification || typeof script.text !== 'string' || !script.text.trim()) {
            return textReply(ctx, typeof script?.question === 'string' && script.question.trim()
                ? script.question.trim() : '¿Qué quieres que comunique el audio? Puedes decirme el tema, el tono y cuánto debe durar.');
        }
        if (script.durationSeconds !== undefined && script.durationSeconds !== null &&
            (typeof script.durationSeconds !== 'number' || !Number.isFinite(script.durationSeconds) || script.durationSeconds <= 0 || script.durationSeconds > MAX_VOICE_DURATION_SECONDS)) {
            return textReply(ctx, '¿Cuánto debe durar el audio? Indícalo en segundos o minutos, hasta 10 minutos.');
        }
        const target = typeof script.durationSeconds === 'number' ? script.durationSeconds : durationSeconds;
        const finalVoice = typeof script.voice === 'string' && VOICES.includes(script.voice.toLowerCase()) ? script.voice.toLowerCase() : voice;
        let media;
        try {
            media = await synthesize(script.text.trim(), { voice: finalVoice, signal });
            signal.throwIfAborted();
            if (!validVoiceMedia(media)) throw new Error('Invalid voice output');
            if (target !== null) {
                media = await fitDuration(media, target, signal);
                signal.throwIfAborted();
                if (!validVoiceMedia(media)) throw new Error('Invalid fitted voice output');
            }
            return { parts: [{ type: 'audio', ref: media.ref, mime: media.mime }], replyTo: ctx.event.id };
        } catch (error) {
            signal.throwIfAborted();
            if (error instanceof AppError) throw error;
            return textReply(ctx, 'No pude preparar o enviar el audio ahorita. Intenta de nuevo en un momento.');
        }
    };
}

/** @param {unknown} value @returns {value is VoiceMedia} */
function validVoiceMedia(value) {
    return Boolean(value && typeof value === 'object' && typeof /** @type {VoiceMedia} */(value).ref === 'string' &&
        /** @type {VoiceMedia} */(value).ref.trim() && typeof /** @type {VoiceMedia} */(value).mime === 'string' &&
        /** @type {VoiceMedia} */(value).mime.toLowerCase().startsWith('audio/'));
}

/** @param {import('../../pipeline/contracts').Ctx} ctx @param {string} text @returns {import('../../domain/types').Reply} */
function textReply(ctx, text) { return { parts: [{ type: 'text', text }], replyTo: ctx.event.id }; }

module.exports = { createVoiceHandler, VOICES, MODES, validVoiceMedia, MAX_VOICE_DURATION_SECONDS, MAX_VOICE_TEXT_CHARS };
