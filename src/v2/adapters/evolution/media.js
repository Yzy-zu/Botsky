// @ts-check
'use strict';
const path=require('node:path');
const {withRetry:retry}=require('./client');
/** @param {any} filePath */
function detectMediaType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    /** @type {Record<string,string>} */
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


/** @param {{client:import('./client').HttpClient,instance:string,clock:import('../../platform/clock').Clock,logger?:{info:(message:string)=>void},maxDownloadBytes?:number}} dependencies */
function createMedia({client:http,instance:INSTANCE,clock,logger={info(){}},maxDownloadBytes=64*1024*1024}) {
    if (!Number.isSafeInteger(maxDownloadBytes)||maxDownloadBytes<1) throw new RangeError('Invalid download limit');
    /** @param {()=>Promise<any>} fn */
    const withRetry=fn=>retry(fn,clock);
/** @param {any} messageData @param {any} options1 */
async function downloadMedia(messageData, { maxBytes = maxDownloadBytes } = {}) {
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
            } catch (error) {
            const err = /** @type {any} */ (error);
                if (maxBytes !== undefined && (/maxContentLength|response.*too.*large/i.test(err.message || '') || err.response?.status === 413)) throw tooLarge();
                throw err;
            }
        });
    } catch (error) {
            const err = /** @type {any} */ (error);
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
    /** @type {Record<string,string>} */
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


    return {downloadMedia};
}
module.exports={createMedia,detectMediaType};
