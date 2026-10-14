// @ts-check
'use strict';
const { AppError } = require('../../domain/errors');

const VOICES = Object.freeze(['hombre', 'mujer', 'colombiano', 'colombiana', 'argentino', 'argentina', 'loquendo',
    'chileno', 'venezolano', 'peruano', 'ardilla', 'demonio', 'robot', 'radio', 'dross', 'goku', 'donramon',
    'babidi', 'anime', 'daniel', 'narrador', 'adam', 'charlie', 'george', 'harry', 'liam', 'alice', 'lily',
    'jessica', 'bill', 'elevenlabs', 'realista', 'humana', 'luisito', 'colombia', 'paisa', 'parcero', 'che',
    'boludo', 'chile', 'weon', 'venezuela', 'chamo', 'peru', 'causa', 'espanol', 'espana', 'castellano',
    'alvin', 'monstruo', 'diablo', 'cyborg', 'ciborg', 'policia', 'walkietalkie', 'drossrotzank', 'ramon',
    'monchito', 'waifu', 'loli', 'monachina', 'cute', 'chica', 'morra', 'reels', 'female', 'f', 'm']);
const MODES = Object.freeze(['compose', 'verbatim']);
const MAX_VOICE_DURATION_SECONDS = 600;
const MAX_VOICE_TEXT_CHARS = 20_000;

/** @typedef {{ref:string,mime:string,durationSeconds?:number}} VoiceMedia */
/** @typedef {{success?:boolean,text?:string,voice?:string,mode?:string,durationSeconds?:number|null,question?:string,error?:string,needsClarification?:boolean}} VoiceScript */
/** @typedef {{previousText:string,measuredSeconds:number,wordTarget:number}} VoiceRevision */
/** @typedef {{extractedText?:string,inlineData?:{mimeType:string,data:string}}} VoiceScriptMediaContext */
/** @typedef {{request:string,literalText:string,mode:string,voice:string,durationSeconds:number|null,history:ReadonlyArray<{role:string,content:string}>,quotedText:string,userName:string,isGroup:boolean,mediaContext?:VoiceScriptMediaContext,revision?:VoiceRevision}} VoiceScriptInput */
/** @typedef {{prepareScript:(input:VoiceScriptInput,signal:AbortSignal)=>Promise<VoiceScript>,readScriptContext?:(attachment:import('../../pipeline/contracts').Attachment,signal:AbortSignal)=>Promise<VoiceScriptMediaContext|{question:string}|null>,synthesize:(text:string,options:{voice:string,signal:AbortSignal})=>Promise<VoiceMedia>,fitDuration:(media:VoiceMedia,targetSeconds:number,signal:AbortSignal)=>Promise<VoiceMedia>,release?:(ref:string)=>Promise<unknown>}} VoicePorts */

/** @param {VoicePorts} ports */
function createVoiceHandler({ prepareScript, readScriptContext, synthesize, fitDuration, release }) {
    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} args @param {AbortSignal} signal @returns {Promise<import('../../domain/types').Reply>} */
    return async function voice(ctx, args, signal) {
        signal.throwIfAborted();
        const voice = typeof args.voice === 'string' ? args.voice.toLowerCase() : 'hombre';
        const mode = typeof args.mode === 'string' ? args.mode : 'compose';
        const explicitLiteral = typeof args.literalText === 'string' ? args.literalText.trim() : '';
        const request = typeof args.instruction === 'string' ? args.instruction.trim() : '';
        const rawDuration = args.durationSeconds;
        const durationSeconds = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : null;
        if (!VOICES.includes(voice) || !MODES.includes(mode) || (durationSeconds !== null && (durationSeconds < 1 || durationSeconds > MAX_VOICE_DURATION_SECONDS)) || explicitLiteral.length > MAX_VOICE_TEXT_CHARS) {
            return textReply(ctx, 'No pude interpretar la voz, el texto o la duración. Indica una voz conocida, hasta 20,000 caracteres de texto y una duración de 1 a 600 segundos.');
        }
        const quotedText = ctx.event.quoted?.text || '';
        const literalText = explicitLiteral || (mode === 'verbatim' ? quotedText.trim() : '');
        /** @type {VoiceScriptMediaContext|undefined} */ let mediaContext;
        if(mode==='compose'&&ctx.attachment) {
            if(!readScriptContext)return textReply(ctx,'No pude leer el adjunto para preparar el audio. Intenta de nuevo con una imagen, PDF o texto legible.');
            try {
                const attachmentContext=await readScriptContext(ctx.attachment,signal);
                signal.throwIfAborted();
                if(attachmentContext&&'question' in attachmentContext)return textReply(ctx,attachmentContext.question);
                if(!attachmentContext)return textReply(ctx,'No tengo contenido legible de ese adjunto para preparar el audio. Intenta con una imagen, PDF o texto.');
                mediaContext=attachmentContext;
            } catch(error) {
                signal.throwIfAborted();
                if(error instanceof AppError)throw error;
                return textReply(ctx,'No pude leer el adjunto para preparar el audio. Intenta de nuevo con una imagen, PDF o texto legible.');
            }
        }
        let script;
        try {
            script = await prepareScript({ request, literalText, mode, voice, durationSeconds,
                history: ctx.history.map(message => ({ role: message.role, content: message.content })), quotedText,
                userName: ctx.event.sender.name || 'Compa', isGroup: ctx.event.isGroup,...(mediaContext?{mediaContext}:{}) }, signal);
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
        let transcript = script.text.trim();
        const measuredTarget = target === null ? null : target;
        const mismatchLimit = measuredTarget === null ? null : Math.max(1, measuredTarget * 0.05);
        /** @param {VoiceMedia} value */
        const releaseMedia = async value => {
            try { if (release) await release(value.ref); } catch { /* A discarded-media cleanup cannot replace the selected result. */ }
        };
        /** @param {VoiceMedia} value @returns {number|null} */
        const errorFromTarget = value => typeof value.durationSeconds === 'number' && Number.isFinite(value.durationSeconds)
            ? Math.abs(value.durationSeconds - /** @type {number} */ (measuredTarget)) : null;
        try {
            media = await synthesize(script.text.trim(), { voice: finalVoice, signal });
            signal.throwIfAborted();
            if (!validVoiceMedia(media)) throw new Error('Invalid voice output');
            if (target !== null) {
                media = await fitDuration(media, target, signal);
                signal.throwIfAborted();
                if (!validVoiceMedia(media)) throw new Error('Invalid fitted voice output');
            }
            const requestedVerbatim = mode === 'verbatim' || script.mode === 'verbatim';
            const initialError = errorFromTarget(media);
            if (!requestedVerbatim && measuredTarget !== null && mismatchLimit !== null &&
                initialError !== null && initialError > mismatchLimit) {
                const first = media;
                const measuredSeconds = /** @type {number} */ (first.durationSeconds);
                const revisionInput = { request, literalText, mode:'compose', voice:finalVoice, durationSeconds:measuredTarget,
                    history:ctx.history.map(message=>({role:message.role,content:message.content})), quotedText,
                    userName:ctx.event.sender.name||'Compa', isGroup:ctx.event.isGroup,...(mediaContext?{mediaContext}:{}),
                    revision:{previousText:transcript,measuredSeconds,wordTarget:Math.max(3,Math.round(transcript.split(/\s+/).length*measuredTarget/measuredSeconds))} };
                let revised;
                try { revised = await prepareScript(revisionInput,signal); signal.throwIfAborted(); }
                catch (error) { signal.throwIfAborted(); if(error instanceof AppError) throw error; revised=undefined; }
                if (revised?.success !== false && !revised?.needsClarification && typeof revised?.text === 'string' && revised.text.trim() && revised.text.trim() !== transcript) {
                    let candidate;
                    try {
                        candidate = await synthesize(revised.text.trim(),{voice:typeof revised.voice==='string'&&VOICES.includes(revised.voice.toLowerCase())?revised.voice.toLowerCase():finalVoice,signal});
                        signal.throwIfAborted();
                        if(!validVoiceMedia(candidate)) throw new Error('Invalid revised voice output');
                        candidate=await fitDuration(candidate,measuredTarget,signal);signal.throwIfAborted();
                        if(!validVoiceMedia(candidate)) throw new Error('Invalid revised fitted voice output');
                        const candidateError=errorFromTarget(candidate);
                        const firstError=errorFromTarget(first);
                        if(candidateError!==null&&firstError!==null&&candidateError<firstError) {
                            await releaseMedia(first);media=candidate;transcript=revised.text.trim();
                        } else await releaseMedia(candidate);
                    } catch(error) {
                        if(candidate&&validVoiceMedia(candidate)) await releaseMedia(candidate);
                        signal.throwIfAborted();
                        if(error instanceof AppError) { await releaseMedia(first); media=undefined; throw error; }
                        // Keep the first successful audio if its single revision attempt fails.
                        media=first;
                    }
                }
            }
            const actualDuration = typeof media.durationSeconds === 'number' && Number.isFinite(media.durationSeconds) ? media.durationSeconds : undefined;
            /** @type {import('../../domain/types').ReplyPart[]} */
            const parts = [{ type:'audio',ref:media.ref,mime:media.mime,transcript,
                ...(actualDuration === undefined ? {} : {durationSeconds:actualDuration}) }];
            if (measuredTarget !== null && actualDuration !== undefined && mismatchLimit !== null && Math.abs(actualDuration-measuredTarget)>mismatchLimit) {
                parts.push({type:'text',text:`La nota quedó en ${actualDuration.toFixed(1)} s; buscábamos ${measuredTarget} s.`});
            }
            return { parts, replyTo: ctx.event.id };
        } catch (error) {
            if (media && validVoiceMedia(media)) await releaseMedia(media);
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
