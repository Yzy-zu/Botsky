'use strict';

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../services/logger');
const history = require('./history');

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

// ─── Utilidades ────────────────────────────────────────────────────────────────

/**
 * Normaliza un número de WhatsApp al formato JID.
 * Acepta: "5521999999999" o "5521999999999@s.whatsapp.net"
 */
function normalizeJid(number) {
    if (number.includes('@')) return number;
    return `${number}@s.whatsapp.net`;
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
async function sendText(to, text) {
    const jid = normalizeJid(to);
    logger.info(`Enviando texto a ${jid}`);

    try {
        history.addMessage(to, 'assistant', text);
        if (to !== jid) history.addMessage(jid, 'assistant', text);
    } catch (_) {}

    return withRetry(() =>
        http.post(`/message/sendText/${INSTANCE}`, {
            number: jid,
            text,
            delay: 1000,
            presence: 'composing',
            options: { delay: 1000, presence: 'composing' }
        })
    );
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
async function sendMedia(to, filePath, caption = '', forceDocument = false, isHd = false, delayMs = null, customFileName = null) {
    const jid = normalizeJid(to);
    const mediatype = forceDocument ? 'document' : detectMediaType(filePath);
    const fileName = customFileName || path.basename(filePath);

    // Verificar tamaño
    const stats = fs.statSync(filePath);
    const sizeMB = stats.size / (1024 * 1024);
    const maxMB = forceDocument
        ? Math.max(parseFloat(process.env.MAX_DOCUMENT_SIZE_MB ?? '200'), 200)
        : parseFloat(process.env.MAX_FILE_SIZE_MB ?? '64');

    if (sizeMB > maxMB) {
        throw new Error(`El archivo pesa ${sizeMB.toFixed(1)} MB y supera el límite de ${maxMB} MB.`);
    }

    let media = await fileToBase64(filePath);
    logger.info(`Enviando ${mediatype} (${sizeMB.toFixed(2)} MB) a ${jid}`);

    const finalDelay = delayMs !== null ? delayMs : 1000;
    const payload = {
        number: jid,
        mediatype,
        media,
        fileName,
        caption,
        isHd,
        delay: finalDelay,
        presence: 'composing',
        options: { delay: finalDelay, presence: 'composing' }
    };

    try {
        const res = await withRetry(() => http.post(`/message/sendMedia/${INSTANCE}`, payload));
        return res;
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
async function sendTyping(to) {
    const jid = normalizeJid(to);
    try {
        await http.post(`/chat/sendPresence/${INSTANCE}`, {
            number: jid,
            presence: 'composing',
            delay: 0
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
async function downloadMedia(messageData) {
    // Si es un mensaje citado, necesitamos la key del mensaje original.
    // messageData.quotedStanzaId se rellena en server.js cuando detectamos un quote.
    let keyToUse = messageData.key;
    if (messageData.quotedStanzaId) {
        keyToUse = {
            ...messageData.key,
            id: messageData.quotedStanzaId,
            participant: messageData.quotedParticipant || messageData.key?.participant,
            // El mensaje citado NO es nuestro
            fromMe: false,
        };
        logger.info(`downloadMedia: usando key del mensaje citado id=${messageData.quotedStanzaId}`);
    }

    let res;
    try {
        res = await withRetry(() =>
            http.post(`/chat/getBase64FromMediaMessage/${INSTANCE}`, {
                message: {
                    key: keyToUse,
                    message: messageData.message,
                },
                convertToMp4: false,
            })
        );
    } catch (err) {
        const errorMsg = err.response?.data?.response?.message || err.response?.data?.message || err.message;
        const isMmgError = typeof errorMsg === "string" && (
            errorMsg.includes("Failed to fetch stream") ||
            errorMsg.includes("mmg.whatsapp.net") ||
            errorMsg.includes("Download Media failed") ||
            errorMsg.includes("Message not found")
        );
        if (isMmgError || err.response?.status === 400) {
            throw new Error("El archivo multimedia ya expiró en WhatsApp o no se pudo descargar. Por favor reenvía el archivo directamente.");
        }
        throw err;
    }

    const { base64, mediaType } = res.data;

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

    return { buffer, extension, mediaType, originalFileName };
}

/**
 * Envía un audio como nota de voz (PTT).
 * @param {string} to       - JID o número destino
 * @param {string} filePath - Ruta absoluta al archivo local
 */
async function sendVoiceNote(to, filePath) {
    const jid = normalizeJid(to);
    const media = await fileToBase64(filePath);
    logger.info(`Enviando nota de voz a ${jid}`);

    return withRetry(() =>
        http.post(`/message/sendWhatsAppAudio/${INSTANCE}`, {
            number: jid,
            audio: media,
            delay: 1500,
            presence: 'recording',
            encoding: true,
            options: { delay: 1500, presence: 'recording', encoding: true }
        })
    );
}

// ─── Funciones de Grupo ────────────────────────────────────────────────────────

async function getGroupInfo(groupJid) {
    return withRetry(() =>
        http.get(`/group/findGroupInfos/${INSTANCE}?groupJid=${groupJid}`)
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
    sendText,
    sendMedia,
    sendVoiceNote,
    sendSticker,
    sendAnimatedSticker,
    sendTyping,
    downloadMedia,
    normalizeJid,
    getGroupInfo,
    updateParticipant,
    updateGroupSetting,
    deleteMessage,
    sendPoll,
    editMessage,
    sendReaction,
};
