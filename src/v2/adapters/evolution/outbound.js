// @ts-check
'use strict';
const path = require('node:path');
const { normalizeJid, withRetry: retry } = require('./client');
const { splitWhatsAppText, planWhatsAppMessages, buildNativeTableMessage, extractNativeTableText, formatNativeTableFallback } = require('./whatsappText');
const { detectMediaType } = require('./media');
/** @typedef {import('../../domain/ports').TextOptions & {delay?:number,raw?:boolean,maxLength?:number}} SendTextOptions */
/** @param {{client:import('./client').HttpClient,instance:string,clock:import('../../platform/clock').Clock,echoGuard:import('./echoGuard').EchoGuard,io:{readFile:(path:string)=>Promise<Buffer>,stat:(path:string)=>Promise<{size:number}>},history?:{addMessage:(jid:string,role:string,text:string,name?:string)=>void},logger?:{info:(message:string)=>void,warn:(message:string)=>void},maxFileSizeMb?:number,maxDocumentSizeMb?:number}} dependencies */
function createOutbound({client:http,instance:INSTANCE,clock,echoGuard,io,history={addMessage(){}},logger={info(){},warn(){}},maxFileSizeMb=64,maxDocumentSizeMb=200}) {
    if (![maxFileSizeMb,maxDocumentSizeMb].every(value=>Number.isFinite(value)&&value>0)) throw new RangeError('Invalid media limits');
    const beginOutbound = echoGuard.begin.bind(echoGuard);
    const finishOutbound = echoGuard.finish.bind(echoGuard);
    const failOutbound = echoGuard.fail.bind(echoGuard);
    const recordOutbound = echoGuard.record.bind(echoGuard);
    /** @param {()=>Promise<any>} fn */
    const withRetry = fn => retry(fn,clock);
    /** @param {string} filePath */
    /** @param {string} filePath @param {number} [maxBytes] */
async function fileToBase64(filePath,maxBytes=maxFileSizeMb*1024*1024) {
        const metadata = await io.stat(filePath);
        if (metadata.size > maxBytes) throw Object.assign(new Error('Media exceeds size limit'),{code:'MEDIA_TOO_LARGE'});
        const buffer=await io.readFile(filePath);
        if (buffer.length > maxBytes) throw Object.assign(new Error('Media exceeds size limit'),{code:'MEDIA_TOO_LARGE'});
        return buffer.toString('base64');
    }
/** @param {string} to @param {string} name @param {string[]} options */
async function sendPoll(to, name, options) {
    const jid = normalizeJid(to);
    logger.info(`Enviando encuesta a ${jid}`);

    try {
        history.addMessage(to, 'assistant', `[Encuesta enviada: "${name}"]`);
        if (to !== jid) history.addMessage(jid, 'assistant', `[Encuesta enviada: "${name}"]`);
    } catch (_) {}

    return withRetry(() =>
        http.post(`/message/sendPoll/${INSTANCE}`, {
            number: jid,
            name,
            values: options,
            selectableCount: 1,
            options: { delay: 1200, presence: 'composing' }
        })
    );
}

/**
 * Envía un mensaje de texto.
 * @param {string} to   - JID o número destino
 * @param {string} text - Texto a enviar
 */
/** @param {string} to @param {unknown} text @param {SendTextOptions} [options] */
async function sendText(to, text, options = {}) {
    const jid = normalizeJid(to);
    if (!jid) {
        logger.warn('[EVOLUTION] sendText abortado: JID de destino inválido o vacío');
        return null;
    }
    logger.info(`Enviando texto a ${jid}`);

    const finalDelay = typeof options.delay === 'number' ? options.delay : typeof options.delayMs === 'number' ? options.delayMs : 1000;
    /** @type {{delay:number,presence:string,mentions?:{everyOne:boolean,mentioned:string[]}}} */
    const requestOptions = {
        delay: finalDelay,
        presence: 'composing'
    };

    if (Array.isArray(options.mentions) && options.mentions.length > 0) {
        requestOptions.mentions = {
            everyOne: false,
            mentioned: options.mentions.map(normalizeJid).filter(Boolean)
        };
    }

    const maxLength = options.maxLength ?? 3500;
    const chunks = options.raw
        ? splitWhatsAppText(String(text ?? ''), { maxLength }).map(text => ({ type: /** @type {'text'} */ ('text'), text }))
        : planWhatsAppMessages(text, { maxLength });
    let result = null;
    let sentChunks = 0;
    for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        const nativeTable = chunk.type === 'table';
        const historyText = nativeTable ? extractNativeTableText(buildNativeTableMessage(chunk)) : chunk.text;
        const outbound = beginOutbound(jid, historyText);
        try {
            // POST is not idempotent: a timeout can mean the message was delivered.
            // Never replay accepted chunks or automatically repeat an uncertain send.
            result = await http.post(`/message/${nativeTable ? 'sendNativeTable' : 'sendText'}/${INSTANCE}`, nativeTable ? {
                number: jid,
                table: { headers: chunk.headers, rows: chunk.rows, title: chunk.title },
                delay: finalDelay,
                mentions: requestOptions.mentions?.mentioned || []
            } : {
                number: jid,
                text: chunk.text,
                ...(options.quoted ? {quoted:options.quoted} : {}),
                delay: finalDelay,
                presence: 'composing',
                options: requestOptions
            });
        } catch (error) {
            const err = /** @type {any} */ (error);
            failOutbound(outbound, err);
            // Fall back only after a definitive rejection before transmission.
            // Evolution can report 400 after sending; that is not safe to replay.
            const status = err.response?.status;
            const code = err.response?.data?.code;
            const rejectedBeforeSend = (status === 404 && code !== 'INSTANCE_NOT_FOUND') ||
                (status === 400 && ['NATIVE_TABLE_INVALID', 'NATIVE_TABLE_UNSUPPORTED'].includes(code));
            if (nativeTable && !outbound.echoed && rejectedBeforeSend) {
                logger.warn('[EVOLUTION] Tabla nativa no disponible; enviando sus datos como texto');
                const fallback = splitWhatsAppText(formatNativeTableFallback(chunk), { maxLength })
                    .map(text => ({ type: /** @type {'text'} */ ('text'), text }));
                chunks.splice(index, 1, ...fallback);
                index--;
                continue;
            }
            err.sentChunks = sentChunks + (outbound.echoed ? 1 : 0);
            err.totalChunks = chunks.length;
            err.partialDelivery = err.sentChunks > 0;
            throw err;
        }
        finishOutbound(outbound, result);
        sentChunks++;
        recordOutbound(outbound);
    }
    return result;
}

/** @param {any} to @param {any} filePath @param {any} caption @param {any} forceDocument @param {any} isHd @param {any} delayMs @param {any} customFileName @param {any} textOptions */
async function sendMedia(to, filePath, caption = '', forceDocument = false, isHd = false, delayMs = null, customFileName = null, textOptions = {}) {
    let finalCaption = caption;
    let finalForceDocument = forceDocument;
    let finalIsHd = isHd;
    let finalDelayMs = delayMs;
    let finalCustomFileName = customFileName;
    let finalOpts = textOptions || {};

    if (caption && typeof caption === 'object' && !Array.isArray(caption)) {
        finalOpts = caption;
        finalCaption = finalOpts.caption || '';
        finalForceDocument = finalOpts.forceDocument ?? false;
        finalIsHd = finalOpts.isHd ?? false;
        finalDelayMs = finalOpts.delayMs ?? null;
        finalCustomFileName = finalOpts.customFileName ?? finalOpts.fileName ?? null;
    } else if (forceDocument && typeof forceDocument === 'object' && !Array.isArray(forceDocument)) {
        finalOpts = forceDocument;
        finalForceDocument = finalOpts.forceDocument ?? false;
        finalIsHd = finalOpts.isHd ?? false;
        finalDelayMs = finalOpts.delayMs ?? null;
        finalCustomFileName = finalOpts.customFileName ?? finalOpts.fileName ?? null;
    }

    const jid = normalizeJid(to);
    const ext = path.extname(filePath).toLowerCase();
    /** @type {Record<string,string>} */
    const mimeMap = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp'
    };
    const resolvedMime = finalOpts.mimetype || finalOpts.mime || mimeMap[ext] || undefined;
    const mediatype = finalForceDocument ? 'document' : (finalOpts.mediatype || (resolvedMime?.startsWith('video/') ? 'video' : detectMediaType(filePath)));
    const fileName = finalCustomFileName || path.basename(filePath);

    // Verificar tamaño
    const stats = await io.stat(filePath);
    const sizeMB = stats.size / (1024 * 1024);
    const maxMB = finalForceDocument
        ? Math.max(maxDocumentSizeMb, 200)
        : maxFileSizeMb;

    if (sizeMB > maxMB) {
        throw new Error(`El archivo pesa ${sizeMB.toFixed(1)} MB y supera el límite de ${maxMB} MB.`);
    }

    /** @type {string|null} */ let media = await fileToBase64(filePath,maxMB*1024*1024);
    logger.info(`Enviando ${mediatype} (${sizeMB.toFixed(2)} MB) a ${jid}`);

    const finalDelay = finalDelayMs !== null ? finalDelayMs : 1000;
    const isViewOnce = Boolean(finalOpts.viewOnce || finalOpts.options?.viewOnce);
    const captionChunks = finalOpts.raw
        ? splitWhatsAppText(String(finalCaption ?? ''), { maxLength: 1024 }).map(text => ({ type: /** @type {'text'} */ ('text'), text }))
        : planWhatsAppMessages(finalCaption, { maxLength: 1024 });
    // WhatsApp captions cannot carry native tables. Send those after the file.
    const firstCaption = captionChunks[0]?.type === 'text' ? /** @type {import('./whatsappText').MessageChunk} */ (captionChunks.shift()).text : '';
    /** @type {Record<string,any>} */
    const payload = {
        number: jid,
        mediatype,
        media,
        fileName,
        caption: firstCaption,
        ...(finalOpts.quoted ? {quoted:finalOpts.quoted} : {}),
        isHd: finalIsHd,
        viewOnce: isViewOnce,
        ...(resolvedMime ? { mimetype: resolvedMime } : {}),
        delay: finalDelay,
        presence: 'composing',
        options: {
            delay: finalDelay,
            presence: 'composing',
            viewOnce: isViewOnce,
            ...(resolvedMime ? { mimetype: resolvedMime } : {})
        }
    };

    const outbound = payload.caption ? beginOutbound(jid, payload.caption) : null;
    let mediaAccepted = false;
    try {
        const res = await http.post(`/message/sendMedia/${INSTANCE}`, payload);
        mediaAccepted = true;
        if (outbound) {
            finishOutbound(outbound, res);
            recordOutbound(outbound);
        }
        for (const extraCaption of captionChunks) {
            try {
                await sendText(jid, extraCaption.text, { ...textOptions, raw: extraCaption.type !== 'table', delay: finalDelay });
            } catch (error) {
            const err = /** @type {any} */ (error);
                err.sentMedia = true;
                err.partialDelivery = true;
                throw err;
            }
        }
        return res;
    } catch (error) {
            const err = /** @type {any} */ (error);
        if (outbound && !mediaAccepted) failOutbound(outbound, err);
        if (mediaAccepted || outbound?.echoed) {
            err.sentMedia = true;
            err.partialDelivery = true;
        }
        throw err;
    } finally {
        // Liberar referencia del string Base64 inmediatamente
        media = null;
        payload.media = null;

    }
}

/** @param {string} to @param {string} filePath */
async function sendSticker(to, filePath) {
    const jid = normalizeJid(to);
    /** @type {string|null} */ let image = await fileToBase64(filePath);
    logger.info(`Enviando sticker a ${jid}`);

    /** @type {Record<string,any>} */
    const payload = {
        number: jid,
        sticker: image,
        delay: 0,
        options: { delay: 0 }
    };

    try {
        return await withRetry(() => http.post(`/message/sendSticker/${INSTANCE}`, payload));
    } finally {
        image = null;
        payload.sticker = null;
    }
}

/**
 * Envía un sticker animado WebP sin que Evolution API lo re-procese.
 * Usa el parámetro secreto notConvertSticker para evitar que sharp aplane la animación.
 * @param {string} to       - JID o número destino
 * @param {string} filePath - Ruta al .webp animado local
 */
/** @param {string} to @param {string} filePath */
async function sendAnimatedSticker(to, filePath) {
    const jid = normalizeJid(to);
    /** @type {string|null} */ let image = await fileToBase64(filePath);
    logger.info(`Enviando sticker animado (notConvertSticker) a ${jid}`);

    /** @type {Record<string,any>} */
    const payload = {
        number: jid,
        sticker: image,
        notConvertSticker: true,
        delay: 0,
        options: { delay: 0 }
    };

    try {
        return await withRetry(() => http.post(`/message/sendSticker/${INSTANCE}`, payload));
    } finally {
        image = null;
        payload.sticker = null;
    }
}

/**
 * Indica al chat que el bot está "escribiendo".
 * @param {string} to - JID o número destino
 */
/** @param {string} to @param {number} [delay] */
async function sendTyping(to, delay = 12000) {
    const jid = normalizeJid(to);
    try {
        await http.post(`/chat/sendPresence/${INSTANCE}`, {
            number: jid,
            presence: 'composing',
            delay
        });
    } catch {
        // No crítico, ignorar si falla
    }
}

/**
 * Envía presencia 'recording' (Grabando audio...) al chat.
 * @param {string} to - JID o número destino
 * @param {number} delay - Duración en ms (por defecto 12000ms)
 */
/** @param {string} to @param {number} [delay] */
async function sendRecording(to, delay = 12000) {
    const jid = normalizeJid(to);
    try {
        await http.post(`/chat/sendPresence/${INSTANCE}`, {
            number: jid,
            presence: 'recording',
            delay
        });
    } catch {
        // No crítico, ignorar si falla
    }
}

/** @param {string} to @param {string} filePath @param {{transcript?:string,durationSeconds?:number|null}} [options] */
async function sendVoiceNote(to, filePath, { transcript = '', durationSeconds = null } = {}) {
    const jid = normalizeJid(to);
    const media = await fileToBase64(filePath);
    logger.info(`Enviando nota de voz a ${jid}`);

    const result = await http.post(`/message/sendWhatsAppAudio/${INSTANCE}`, {
            number: jid,
            audio: media,
            delay: 1500,
            presence: 'recording',
            encoding: true,
            options: { delay: 1500, presence: 'recording', encoding: true }
        });
    const description = `[Nota de voz${durationSeconds ? ` de ${Math.round(durationSeconds)} s` : ''}${transcript ? `: ${transcript}` : ' enviada'}]`;
    try { history.addMessage(jid, 'assistant', description, 'Botsky'); } catch (_) {}
    return result;
}

/** @param {string} to @param {string} newText @param {import("../../domain/ports").MessageKey} messageKey */
async function editMessage(to, newText, messageKey) {
    if (!messageKey?.id) throw new Error('messageKey inválida para editar');
    const jid = normalizeJid(to);

    return http.put(`/message/editMessage/${INSTANCE}`, {
        number: jid,
        text: newText,
        key: messageKey,
    });
}

/**
 * Reacciona a un mensaje.
 * @param {string} to          - JID destino
 * @param {string} reaction    - Emoji de la reacción
 * @param {string} messageId   - ID del mensaje a reaccionar
 */
/** @param {string} to @param {string} reaction @param {import("../../domain/ports").MessageKey|string} messageKey */
async function sendReaction(to, reaction, messageKey) {
    const jid = normalizeJid(to);
    let key;

    if (typeof messageKey === 'object' && messageKey !== null) {
        key = {
            remoteJid: messageKey.remoteJid || jid,
            fromMe: messageKey.fromMe ?? false,
            id: messageKey.id,
            ...(messageKey.participant ? { participant: messageKey.participant } : {})
        };
    } else {
        key = {
            remoteJid: jid,
            fromMe: false,
            id: messageKey
        };
    }

    return withRetry(() =>
        http.post(`/message/sendReaction/${INSTANCE}`, {
            key,
            reaction,
        })
    );
}


    return {client:http,sendText,sendMedia,sendVoiceNote,sendVoice:sendVoiceNote,sendSticker,sendAnimatedSticker,sendTyping,typing:sendTyping,sendRecording,sendPoll,editMessage,edit:editMessage,sendReaction,react:sendReaction,consumeOutboundEcho:echoGuard.consume.bind(echoGuard)};
}
module.exports={createOutbound};
