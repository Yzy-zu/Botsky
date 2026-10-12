'use strict';

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../services/logger');
const history = require('./history');
const { formatWhatsAppText, splitWhatsAppText, planWhatsAppMessages, buildNativeTableMessage, extractNativeTableText, formatNativeTableFallback } = require('../utils/whatsappText');

const BASE_URL = process.env.EVOLUTION_API_URL?.replace(/\/$/, '');
const API_KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE;

if (!BASE_URL || !API_KEY || !INSTANCE) {
    throw new Error('Faltan variables de entorno: EVOLUTION_API_URL, EVOLUTION_API_KEY o EVOLUTION_INSTANCE');
}

// ─── Cliente HTTP base ─────────────────────────────────────────────────────────
const http = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
    },
    timeout: 60_000,
});

// Webhook echoes can arrive before the HTTP acknowledgement. Correlate actual
// outbound messages without suppressing unrelated messages sent manually.
const OUTBOUND_ECHO_TTL = 5 * 60 * 1000;
const OUTBOUND_ECHO_CAP = 1000;
const outboundMessages = new Set();
const outboundIds = new Map();
const pendingOutboundTexts = new Map();

function echoChatId(value) {
    return normalizeJid(value).replace(/:[0-9]+@/, '@');
}

function forgetOutbound(entry) {
    outboundMessages.delete(entry);
    for (const id of entry.ids) outboundIds.delete(`${entry.jid}\u0000${id}`);
    const pending = pendingOutboundTexts.get(entry.textKey);
    if (pending) {
        pending.delete(entry);
        if (!pending.size) pendingOutboundTexts.delete(entry.textKey);
    }
}

function pruneOutbound() {
    const cutoff = Date.now() - OUTBOUND_ECHO_TTL;
    for (const entry of outboundMessages) {
        if (entry.createdAt <= cutoff || outboundMessages.size > OUTBOUND_ECHO_CAP) forgetOutbound(entry);
        else break;
    }
}

function beginOutbound(jid, text) {
    pruneOutbound();
    const chatId = echoChatId(jid);
    const textKey = `${chatId}\u0000${text}`;
    const entry = { jid: chatId, text, textKey, createdAt: Date.now(), ids: new Set(), pending: true, echoed: false, recorded: false };
    outboundMessages.add(entry);
    if (!pendingOutboundTexts.has(textKey)) pendingOutboundTexts.set(textKey, new Set());
    pendingOutboundTexts.get(textKey).add(entry);
    pruneOutbound();
    return entry;
}

function associateOutboundId(entry, id) {
    if (!id || !outboundMessages.has(entry)) return;
    const messageId = String(id);
    entry.ids.add(messageId);
    outboundIds.set(`${entry.jid}\u0000${messageId}`, entry);
}

function finishOutbound(entry, response) {
    entry.pending = false;
    const pending = pendingOutboundTexts.get(entry.textKey);
    if (pending) {
        pending.delete(entry);
        if (!pending.size) pendingOutboundTexts.delete(entry.textKey);
    }
    associateOutboundId(entry, response?.data?.key?.id);
}

function recordOutbound(entry) {
    if (entry.recorded) return;
    entry.recorded = true;
    try { history.addMessage(entry.jid, 'assistant', entry.text); } catch (_) {}
}

function consumeOutboundEcho({ chatId, messageId, text } = {}) {
    if (!chatId || !messageId) return false;
    pruneOutbound();
    const jid = echoChatId(chatId);
    const known = outboundIds.get(`${jid}\u0000${messageId}`);
    if (known) { known.echoed = true; return true; }
    if (typeof text !== 'string') return false;
    const pending = pendingOutboundTexts.get(`${jid}\u0000${text}`);
    const entry = pending && [...pending].find(candidate => candidate.pending && !candidate.echoed);
    if (!entry) return false;
    entry.echoed = true;
    associateOutboundId(entry, messageId);
    return true;
}

function failOutbound(entry, err) {
    finishOutbound(entry, null);
    // A webhook echo is delivery evidence even if the HTTP acknowledgement failed.
    if (entry.echoed) recordOutbound(entry);
    if ([400, 401, 403, 404, 413, 422, 429].includes(err.response?.status) && !entry.echoed) forgetOutbound(entry);
}

// ─── Utilidades ────────────────────────────────────────────────────────────────

/**
 * Normaliza un número de WhatsApp al formato JID.
 * Acepta: "5521999999999" o "5521999999999@s.whatsapp.net"
 */
function normalizeJid(number) {
    if (!number) return '';
    const str = String(number).trim();
    if (str.includes('@')) return str;
    return `${str}@s.whatsapp.net`;
}

/**
 * Convierte un archivo local a base64.
 */
async function fileToBase64(filePath) {
    const buffer = await fs.promises.readFile(filePath);
    return buffer.toString('base64');
}

/**
 * Detecta el mediatype de WhatsApp a partir de la extensión del archivo.
 */
function detectMediaType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        '.mp4': 'video',
        '.webm': 'video',
        '.mov': 'video',
        '.avi': 'video',
        '.mkv': 'video',
        '.mp3': 'audio',
        '.ogg': 'audio',
        '.opus': 'audio',
        '.wav': 'audio',
        '.m4a': 'audio',
        '.jpg': 'image',
        '.jpeg': 'image',
        '.png': 'image',
        '.gif': 'image',
        '.webp': 'image',
    };
    return map[ext] ?? 'document';
}

// ─── Función helper para reintentos ───────────────────────────────────────────
async function withRetry(fn, retries = 2, delay = 1500) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (err.code === 'MEDIA_TOO_LARGE') throw err;
            // PERF-MEM: Desvincular datos gigantes retenidos por Axios en el objeto de error antes de reintentar
            if (err.config && err.config.data) {
                err.config.data = null;
            }
            const status = err.response?.status;
            if (status === 400 || status === 401 || status === 403 || status === 404) {
                throw err;
            }
            if (i === retries) throw err;
            logger.warn(`Reintentando (${i + 1}/${retries})...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

// ─── API pública ───────────────────────────────────────────────────────────────

/**
 * Envía una encuesta de WhatsApp (solo 1 opción seleccionable).
 * @param {string} to - JID destino
 * @param {string} name - Título de la encuesta
 * @param {string[]} options - Array de opciones
 */
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
async function sendText(to, text, options = {}) {
    const jid = normalizeJid(to);
    if (!jid) {
        logger.warn('[EVOLUTION] sendText abortado: JID de destino inválido o vacío');
        return null;
    }
    logger.info(`Enviando texto a ${jid}`);

    const finalDelay = typeof options.delay === 'number' ? options.delay : 1000;
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
        ? splitWhatsAppText(String(text ?? ''), { maxLength }).map(text => ({ type: 'text', text }))
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
                delay: finalDelay,
                presence: 'composing',
                options: requestOptions
            });
        } catch (err) {
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
                    .map(text => ({ type: 'text', text }));
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

/**
 * Envía un archivo multimedia (imagen, video, audio, documento).
 * @param {string} to       - JID o número destino
 * @param {string} filePath - Ruta absoluta al archivo local
 * @param {string} caption  - Subtítulo (opcional)
 * @param {boolean} forceDocument - Forzar el envío como documento
 * @param {boolean} isHd          - Forzar envío en HD (para imágenes/videos)
 * @param {number|null} delayMs   - Retraso en ms (0 para envíos instantáneos / álbum)
 * @param {string|null} customFileName - Nombre personalizado para el archivo enviado
 */
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
    const stats = fs.statSync(filePath);
    const sizeMB = stats.size / (1024 * 1024);
    const maxMB = finalForceDocument
        ? Math.max(parseFloat(process.env.MAX_DOCUMENT_SIZE_MB ?? '200'), 200)
        : parseFloat(process.env.MAX_FILE_SIZE_MB ?? '64');

    if (sizeMB > maxMB) {
        throw new Error(`El archivo pesa ${sizeMB.toFixed(1)} MB y supera el límite de ${maxMB} MB.`);
    }

    let media = await fileToBase64(filePath);
    logger.info(`Enviando ${mediatype} (${sizeMB.toFixed(2)} MB) a ${jid}`);

    const finalDelay = finalDelayMs !== null ? finalDelayMs : 1000;
    const isViewOnce = Boolean(finalOpts.viewOnce || finalOpts.options?.viewOnce);
    const captionChunks = finalOpts.raw
        ? splitWhatsAppText(String(finalCaption ?? ''), { maxLength: 1024 }).map(text => ({ type: 'text', text }))
        : planWhatsAppMessages(finalCaption, { maxLength: 1024 });
    // WhatsApp captions cannot carry native tables. Send those after the file.
    const firstCaption = captionChunks[0]?.type === 'text' ? captionChunks.shift().text : '';
    const payload = {
        number: jid,
        mediatype,
        media,
        fileName,
        caption: firstCaption,
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
            } catch (err) {
                err.sentMedia = true;
                err.partialDelivery = true;
                throw err;
            }
        }
        return res;
    } catch (err) {
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
        if (sizeMB > 15 && typeof global.gc === 'function') {
            try { global.gc(); } catch (_) {}
        }
    }
}

/**
 * Envía un sticker (WebP estático o animado).
 * @param {string} to       - JID o número destino
 * @param {string} filePath - Ruta al .webp local
 */
async function sendSticker(to, filePath) {
    const jid = normalizeJid(to);
    let image = await fileToBase64(filePath);
    logger.info(`Enviando sticker a ${jid}`);

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
async function sendAnimatedSticker(to, filePath) {
    const jid = normalizeJid(to);
    let image = await fileToBase64(filePath);
    logger.info(`Enviando sticker animado (notConvertSticker) a ${jid}`);

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

/**
 * Descarga el contenido multimedia de un mensaje de WhatsApp recibido
 * y lo retorna como Buffer.
 * @param {object} messageData - Objeto `data` del webhook
 * @returns {Promise<{ buffer: Buffer, extension: string }>}
 */
async function downloadMedia(messageData, { maxBytes } = {}) {
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) {
        throw new RangeError('maxBytes debe ser un entero positivo');
    }
    const tooLarge = () => Object.assign(new Error('El archivo es demasiado grande para leerlo aquí. Mándame las páginas o imágenes que necesitas resolver.'), {
        code: 'MEDIA_TOO_LARGE',
        userMessage: 'El archivo es demasiado grande para leerlo aquí. Mándame las páginas o imágenes que necesitas resolver.'
    });
    // Si es un mensaje citado, necesitamos la key del mensaje original.
    // messageData.quotedStanzaId se rellena en server.js cuando detectamos un quote.
    let keyToUse = messageData.key;
    if (messageData.quotedStanzaId) {
        keyToUse = {
            ...messageData.key,
            id: messageData.quotedStanzaId,
            remoteJid: messageData.quotedRemoteJid || messageData.key?.remoteJid,
            participant: messageData.quotedParticipant || messageData.key?.participant,
            // Preserve ownership for downloads of Botsky's own sent media.
            fromMe: Boolean(messageData.quotedFromMe),
        };
        logger.info(`downloadMedia: usando key del mensaje citado id=${messageData.quotedStanzaId}`);
    }

    let res;
    const mediaInfo = Object.entries(messageData.message || {}).find(([type]) => /^(?:image|video|audio|document|sticker|ptv)Message$/.test(type))?.[1] ||
        messageData.message?.documentWithCaptionMessage?.message?.documentMessage;
    // The API supports key-only lookup. A partial quote without a decryption
    // key must be hydrated from the provider's original, not passed as complete.
    const hasMediaKey = typeof mediaInfo?.mediaKey === 'string' ? Boolean(mediaInfo.mediaKey.length)
        : Boolean(mediaInfo?.mediaKey && Object.keys(mediaInfo.mediaKey).length);
    const sourceMessage = { key: keyToUse, ...(hasMediaKey ? { message: messageData.message } : {}) };
    try {
        res = await withRetry(async () => {
            try { return await http.post(`/chat/getBase64FromMediaMessage/${INSTANCE}`, {
                message: sourceMessage,
                convertToMp4: false,
            }, maxBytes === undefined ? {} : { maxContentLength: Math.ceil(maxBytes * 4 / 3) + 64 * 1024 });
            } catch (err) {
                if (maxBytes !== undefined && (/maxContentLength|response.*too.*large/i.test(err.message || '') || err.response?.status === 413)) throw tooLarge();
                throw err;
            }
        });
    } catch (err) {
        const errorMsg = err.response?.data?.response?.message || err.response?.data?.message || err.message;
        const isMmgError = typeof errorMsg === "string" && (
            errorMsg.includes("Failed to fetch stream") ||
            errorMsg.includes("mmg.whatsapp.net") ||
            errorMsg.includes("Download Media failed") ||
            errorMsg.includes("Message not found")
        );
        if (isMmgError || err.response?.status === 400) {
            const expired = typeof errorMsg === 'string' && /expired|expir|Message not found/i.test(errorMsg);
            throw Object.assign(new Error(expired ? 'WhatsApp ya no tiene ese archivo disponible. Reenvíamelo directamente.'
                : 'No pude descargar el archivo de WhatsApp. Intenta de nuevo o reenvíamelo directamente.'), {
                code: expired ? 'MEDIA_UNAVAILABLE' : 'MEDIA_DOWNLOAD_FAILED'
            });
        }
        throw err;
    }

    const mediaType = String(res.data?.mediaType || 'document');
    const encoded = res.data?.base64;
    if (typeof encoded !== 'string' || !encoded) throw new Error('WhatsApp no devolvió el contenido del archivo. Reenvíamelo directamente.');
    const dataUri = encoded.match(/^data:([^;,]+);base64,/i);
    const base64 = encoded.slice(dataUri?.[0]?.length || 0).replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 === 1) {
        throw new Error('El contenido del archivo no se pudo leer. Reenvíamelo directamente.');
    }
    if (maxBytes !== undefined && Buffer.byteLength(base64, 'base64') > maxBytes) {
        res.data = null;
        throw tooLarge();
    }
    const documentMessage = messageData?.message?.documentMessage || messageData?.message?.documentWithCaptionMessage?.message?.documentMessage;
    const mimeType = res.data?.mimetype || res.data?.mimeType || dataUri?.[1] || documentMessage?.mimetype || messageData?.message?.imageMessage?.mimetype || null;

    // Extensión por defecto según tipo
    const extMap = {
        image: 'jpg',
        imageMessage: 'jpg',
        video: 'mp4',
        videoMessage: 'mp4',
        audio: 'ogg',
        audioMessage: 'ogg',
        document: 'bin',
        documentMessage: 'bin',
        sticker: 'webp',
        stickerMessage: 'webp',
    };

    let extension = extMap[mediaType] ?? 'bin';
    let originalFileName = null;
    
    // Mejorar la detección de extensión para documentos
    if (extension === 'bin' || mediaType.includes('document')) {
        const docMsg = messageData?.message?.documentMessage || messageData?.message?.documentWithCaptionMessage?.message?.documentMessage;
        if (docMsg) {
            if (docMsg.fileName) {
                originalFileName = docMsg.fileName;
                const match = docMsg.fileName.match(/\.([a-zA-Z0-9]+)$/);
                if (match) extension = match[1].toLowerCase();
            }
            // Fallback por mimetype si no tiene nombre de archivo
            if (extension === 'bin' && docMsg.mimetype) {
                if (docMsg.mimetype.includes('pdf')) extension = 'pdf';
                else if (docMsg.mimetype.includes('wordprocessingml')) extension = 'docx';
                else if (docMsg.mimetype.includes('msword')) extension = 'doc';
                else if (docMsg.mimetype.includes('spreadsheetml')) extension = 'xlsx';
                else if (docMsg.mimetype.includes('presentationml')) extension = 'pptx';
            }
        }
    }

    const buffer = Buffer.from(base64, 'base64');
    // Liberar referencia en memoria del payload crudo de axios
    if (res?.data) {
        res.data.base64 = null;
        res.data = null;
    }

    // Para imágenes: detectar el tipo real por magic bytes del buffer.
    // WhatsApp envía GIFs como imageMessage con extensión por defecto .jpg,
    // lo que hace que ffmpeg los trate como JPEG estático.
    if (extension === 'jpg') {
        // GIF: empieza con "GIF8" (GIF87a o GIF89a)
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
            extension = 'gif';
        }
        // PNG: magic bytes 89 50 4E 47
        else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
            extension = 'png';
        }
        // WebP: RIFF....WEBP
        else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[8] === 0x57 && buffer[9] === 0x45) {
            extension = 'webp';
        }
        // Fallback: revisar mimetype del imageMessage
        else {
            const imgMsg = messageData?.message?.imageMessage;
            if (imgMsg?.mimetype) {
                if (imgMsg.mimetype.includes('gif'))  extension = 'gif';
                else if (imgMsg.mimetype.includes('png'))  extension = 'png';
                else if (imgMsg.mimetype.includes('webp')) extension = 'webp';
            }
        }
    }

    return { buffer, extension, mediaType, mimeType, originalFileName };
}

/**
 * Envía un audio como nota de voz (PTT).
 * @param {string} to       - JID o número destino
 * @param {string} filePath - Ruta absoluta al archivo local
 */
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

// ─── Funciones de Grupo ────────────────────────────────────────────────────────

async function getGroupInfo(groupJid) {
    return withRetry(() =>
        http.get(`/group/findGroupInfos/${INSTANCE}?groupJid=${groupJid}`)
    );
}

async function getGroupInviteCode(groupJid) {
    return withRetry(() =>
        http.get(`/group/inviteCode/${INSTANCE}?groupJid=${groupJid}`)
    );
}

async function updateParticipant(groupJid, action, participants) {
    const list = Array.isArray(participants) ? participants : [participants];
    const cleanParticipants = list.map(p => {
        if (typeof p !== 'string') return String(p);
        p = p.trim();
        // Si ya incluye @lid o @s.whatsapp.net, preservarlo íntegro para grupos con LID
        if (p.includes('@')) return p;
        return p.replace(/[^0-9]/g, '');
    }).filter(p => p && p.length >= 10);

    logger.info(`Participant ${action} en ${groupJid} -> [${cleanParticipants.join(", ")}]`);
    return withRetry(() =>
        http.post(`/group/updateParticipant/${INSTANCE}?groupJid=${groupJid}`, {
            action,
            participants: cleanParticipants
        })
    );
}

async function updateGroupSetting(groupJid, action) {
    // action: 'announcement' (mute) o 'not_announcement' (unmute)
    return withRetry(() =>
        http.post(`/group/updateSetting/${INSTANCE}?groupJid=${groupJid}`, {
            action
        })
    );
}

async function deleteMessage(jid, messageKey) {
    return withRetry(() =>
        http.post(`/chat/deleteMessage/${INSTANCE}`, {
            number: jid,
            key: messageKey
        })
    );
}

/**
 * Edita un mensaje ya enviado (para feedback en tiempo real).
 * @param {string} to          - JID destino
 * @param {string} newText     - Nuevo contenido del mensaje
 * @param {object} messageKey  - Key del mensaje original (retornada por sendText)
 */
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

module.exports = {
    client: http,
    sendText,
    sendMedia,
    sendVoiceNote,
    sendSticker,
    sendAnimatedSticker,
    sendTyping,
    sendRecording,
    downloadMedia,
    normalizeJid,
    getGroupInfo,
    getGroupInviteCode,
    updateParticipant,
    updateGroupSetting,
    deleteMessage,
    sendPoll,
    editMessage,
    sendReaction,
    consumeOutboundEcho,
};
