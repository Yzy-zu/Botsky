'use strict';

const logger = require('../services/logger');
const evolution = require('../services/evolution');
const sendText = (to, text, opts) => evolution.sendText(to, text, opts);
const sendRecording = (to) => evolution.sendRecording(to);
const tts = require('../services/tts');
const generateVoiceNote = (...args) => tts.generateVoiceNote(...args);
const { prepareVoiceScript, wordCount } = require('../services/voiceScript');
const { fitAudioDuration } = require('../services/audioDuration');
const { getHistory } = require('../services/history');

const KNOWN_VOICES = new Set([
    'hombre', 'mujer', 'colombiano', 'colombiana', 'argentino', 'argentina',
    'loquendo', 'chileno', 'venezolano', 'peruano', 'ardilla', 'demonio',
    'robot', 'radio', 'dross', 'goku', 'donramon', 'babidi', 'anime',
    'daniel', 'narrador', 'adam', 'charlie', 'george', 'harry', 'liam',
    'alice', 'lily', 'jessica', 'bill', 'elevenlabs', 'realista'
]);

/**
 * Comando para generar notas de voz TTS con personajes, acentos y ElevenLabs.
 * 
 * @param {object} parsed - Objeto devuelto por el parser
 * @param {string} from - JID del remitente o grupo
 * @param {object} messageData - Datos crudos del mensaje
 */
function cleanVoice(value) {
    let name = String(value || '').toLowerCase().trim();
    while (name.startsWith('-') || name.startsWith('_')) name = name.slice(1);
    return name;
}

// This is the explicit terminal grammar only. Natural requests are interpreted
// once by the semantic router; flags and words never override that decision.
function explicitVoiceArgs(parsed) {
    const flags = parsed.flags || {};
    const args = [...(parsed.args || [])];
    let voice = cleanVoice(flags.voz || flags.voice) || 'hombre';
    if (!flags.voz && !flags.voice) {
        for (const [name, value] of Object.entries(flags)) {
            const candidate = cleanVoice(name);
            if (!KNOWN_VOICES.has(candidate)) continue;
            voice = candidate;
            if (typeof value === 'string' && value.trim() && !args.includes(value)) args.unshift(value);
            break;
        }
        if (args.length && KNOWN_VOICES.has(cleanVoice(args[0]))) voice = cleanVoice(args.shift());
    }
    if (flags.m) {
        voice = 'mujer';
        if (typeof flags.m === 'string' && !args.includes(flags.m)) args.unshift(flags.m);
    }
    return { destino_scope: 'current_chat', modo: 'verbatim', voz: voice,
        texto_literal: args.join(' ') || flags.texto || flags.t || '',
        durationSeconds: flags.duracion ?? flags.segundos ?? null };
}

async function handleVoz(parsed = {}, from, messageData = {}) {
    const hasStructuredArgs = parsed.aiArgs && typeof parsed.aiArgs === 'object' && !Array.isArray(parsed.aiArgs);
    if (!parsed.semanticDecision && !hasStructuredArgs) {
        if (parsed.hasPrefix === true && new Set(['voz', 'tts', 'audio', 'habla', 'hablar', 'notadevoz']).has(parsed.command)) {
            parsed = { ...parsed, aiArgs: explicitVoiceArgs(parsed) };
        } else {
            const { routeWithAI } = require('../services/ai');
            const decision = await routeWithAI(parsed.raw || '', messageData.pushName || 'Compa', from.endsWith('@g.us'),
                parsed.voiceContext?.history || getHistory(from, 8), parsed.voiceContext?.mediaContext || null,
                null, messageData.key?.participant || messageData.participant || from, from);
            if (!decision || decision.needs_clarification || !new Set(['voz', 'enviarmedia']).has(decision.action)) {
                const question = decision?.question || 'No quedó claro qué quieres hacer con el audio. ¿Lo preparo o reenvío uno que ya existe?';
                await sendText(from, question);
                return { success: false, needs_clarification: true, question, enviado_al_chat: true };
            }
            parsed = { ...parsed, semanticDecision: decision, aiArgs: decision.args || {} };
        }
    }
    if (parsed.semanticDecision?.action === 'enviarmedia') return require('./enviarmedia').handleEnviarMedia(parsed, from, messageData);
    if (parsed.semanticDecision && parsed.semanticDecision.action !== 'voz') {
        const question = 'Esa petición no es para crear un audio. Dime qué quieres que comunique.';
        await sendText(from, question);
        return { success: false, needs_clarification: true, question, enviado_al_chat: true };
    }
    const params = parsed.aiArgs || parsed.semanticDecision?.args || {};
    if (params.modo !== undefined && !new Set(['compose', 'verbatim']).has(params.modo)) {
        const question = 'No pude interpretar cómo preparar ese audio. Intenta decirme qué quieres comunicar.';
        await sendText(from, question);
        return { success: false, needs_clarification: true, question, enviado_al_chat: true };
    }
    return require('../services/outboundDelivery').deliverSemantic({ args: params, from, messageData, payloadLabel: 'audio',
        execute: target => generateAndSendVoice({ ...parsed, aiArgs: params }, from, messageData, target) });
}

async function generateAndSendVoice(parsed, from, messageData, target) {
    const destination = target.jid;
    const params = parsed.aiArgs || parsed || {};
    const requestedVoice = cleanVoice(params.voz || params.voice) || 'hombre';
    const candidateText = params.texto_literal ?? params.texto ?? params.mensaje ?? params.text ?? '';
    const text = typeof candidateText === 'string' ? candidateText.trim() : '';
    const request = String(params.instruccion || parsed.raw || '').trim();
    const mode = params.modo || 'compose';

    // 3. Si no hay texto directo, verificar si vino de un mensaje citado
    const contextInfo = messageData?.contextInfo || messageData?.message?.extendedTextMessage?.contextInfo ||
        Object.values(messageData?.message || {}).find(value => value?.contextInfo)?.contextInfo;
    const quoted = contextInfo?.quotedMessage;
    const quotedText = quoted?.conversation || quoted?.extendedTextMessage?.text || quoted?.imageMessage?.caption || quoted?.documentMessage?.caption || '';
    const literalText = text || (mode === 'verbatim' ? quotedText : '');
    if (!request && !literalText && !quotedText) {
        const question = '¿Qué quieres que comunique el audio? Puedes decirme el tema, el tono y cuánto debe durar.';
        await sendText(from, question);
        return { success: false, needs_clarification: true, question, enviado_al_chat: true };
    }
    sendRecording(from).catch(() => {});
    let ttsResult = null;
    let delivered = false;
    try {
        let mediaContext = parsed.voiceContext?.mediaContext || null;
        if (parsed.semanticDecision?.uses_attachment === false) mediaContext = null;
        const readableTypes = new Set(['imageMessage', 'documentMessage']);
        const mediaType = messageData?.messageType || Object.keys(messageData?.message || {}).find(type => readableTypes.has(type));
        const useAttachment = parsed.semanticDecision?.uses_attachment !== false;
        if (useAttachment && !mediaContext?.base64 && !mediaContext?.extractedText && readableTypes.has(mediaType) && mode !== 'verbatim') {
            const { prepareContent } = require('../services/contentReader');
            const prepared = await prepareContent({ messageData, messageType: mediaType });
            if (!prepared.success) {
                await sendText(from, prepared.question || prepared.error);
                return { ...prepared, enviado_al_chat: true };
            }
            mediaContext = prepared.mediaContext;
        }
        if (useAttachment && mediaType === 'videoMessage' && !mediaContext && mode !== 'verbatim') mediaContext = { type: 'videoMessage' };
        const scriptRequest = { request: request || params.instruccion || '', literalText,
            mode,
            voice: requestedVoice, durationSeconds: params.durationSeconds ?? params.duracion ?? null,
            history: parsed.voiceContext?.history || getHistory(from, 8), quotedText, userName: messageData?.pushName || 'Compa',
            isGroup: destination.endsWith('@g.us'), mediaContext };
        let script = await prepareVoiceScript(scriptRequest);
        if (!script.success) {
            await sendText(from, script.question || script.error);
            return { ...script, enviado_al_chat: true };
        }
        const options = { voiceProfile: script.voice, voz: script.voice };
        logger.info(`[VOZ] Preparando ${wordCount(script.text)} palabras; voz=${script.voice}; objetivo=${script.durationSeconds || 'natural'} para ${destination}`);
        ttsResult = await generateVoiceNote(script.text, options);
        if (script.durationSeconds) {
            ttsResult = await fitAudioDuration(ttsResult, script.durationSeconds);
            if (script.mode === 'compose' && Math.abs(ttsResult.durationSeconds - script.durationSeconds) > Math.max(1, script.durationSeconds * 0.05)) {
                const revised = await prepareVoiceScript({ ...scriptRequest, durationSeconds: script.durationSeconds,
                    revision: { previousText: script.text, measuredSeconds: ttsResult.durationSeconds,
                        wordTarget: Math.max(3, Math.round(wordCount(script.text) * script.durationSeconds / ttsResult.durationSeconds)) } });
                if (revised.success) {
                    let replacement = null;
                    try {
                        replacement = await generateVoiceNote(revised.text, options);
                        replacement = await fitAudioDuration(replacement, script.durationSeconds);
                        if (Math.abs(replacement.durationSeconds - script.durationSeconds) < Math.abs(ttsResult.durationSeconds - script.durationSeconds)) {
                            await ttsResult.cleanup?.();
                            ttsResult = replacement;
                            script = { ...revised, voice: script.voice, durationSeconds: script.durationSeconds };
                            replacement = null;
                        }
                    } catch (error) { logger.warn(`[VOZ] No se pudo ajustar el borrador: ${error.message}`); }
                    finally { await replacement?.cleanup?.(); }
                }
            }
        }
        const response = await evolution.sendVoiceNote(destination, ttsResult.filePath, { transcript: script.text, durationSeconds: ttsResult.durationSeconds });
        delivered = true;
        // Keep only confirmed WhatsApp metadata, so a later 'mándalo' can use the
        // actual audio after the local TTS temporary has been deleted.
        if (response?.data?.key?.id && response?.data?.message?.audioMessage) try {
            const { rememberAttachment } = require('../services/attachmentContext');
            rememberAttachment({ from, participant: messageData.key?.participant || messageData.participant || from, messageType: 'audioMessage', source: 'sent',
                messageData: { ...response.data, messageType: 'audioMessage', quotedStanzaId: response.data.key.id,
                    quotedRemoteJid: destination, quotedFromMe: true } });
        } catch (error) { logger.warn(`[VOZ] Audio entregado; no se pudo guardar referencia: ${error.message}`); }
        if (destination !== from) {
            await sendText(from, `Va, ya mandé el audio ${target.is_group ? 'al grupo' : `a ${target.user_name}`}.`)
                .catch(error => logger.warn(`[VOZ] Audio entregado; falló confirmación: ${error.message}`));
        }
        if (script.durationSeconds && Math.abs(ttsResult.durationSeconds - script.durationSeconds) > Math.max(1, script.durationSeconds * 0.05)) {
            const notice = script.mode === 'verbatim'
                ? `El texto literal dura ${Math.round(ttsResult.durationSeconds)} s. Lo conservé completo; para llegar a ${script.durationSeconds} s habría que cambiarlo o alterar mucho el ritmo.`
                : `El audio quedó de unos ${Math.round(ttsResult.durationSeconds)} s; no logré ajustarlo a ${script.durationSeconds} s sin forzar el ritmo.`;
            await sendText(from, notice).catch(error => logger.warn(`[VOZ] Audio entregado; no se pudo enviar aviso de duración: ${error.message}`));
        }
        return { success: true, voz_utilizada: script.voice, durationSeconds: ttsResult.durationSeconds || null,
            requestedDurationSeconds: script.durationSeconds, jid: destination, enviado_al_chat: true, mensaje: 'Nota de voz enviada.' };
    } catch (err) {
        logger.error(`[VOZ] Error al preparar/generar/enviar nota de voz: ${err.message}`);
        const error = delivered ? 'El audio se envió, pero falló un paso posterior.' : 'No pude preparar o enviar el audio ahorita. Intenta de nuevo en un momento.';
        if (!delivered) await sendText(from, error);
        return { success: delivered, enviado_al_chat: true, error };
    } finally {
        if (ttsResult && typeof ttsResult.cleanup === 'function') {
            try { await ttsResult.cleanup(); } catch (error) { logger.warn(`[VOZ] No se pudo limpiar temporal: ${error.message}`); }
        }
    }
}

module.exports = { handleVoz, KNOWN_VOICES };
