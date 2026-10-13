'use strict';

const fs = require('fs');
const path = require('path');
const evolution = require('../services/evolution');
const sendText = (to, text, opts) => evolution.sendText(to, text, opts);
const downloadMedia = (messageData) => evolution.downloadMedia(messageData);
const drive = require('../services/drive');
const logger = require('../services/logger');

async function handleDrive(parsed = {}, from, messageData = {}) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    // Si se pasa messageData como primer argumento o parsed contiene datos de mensaje
    if (parsed && (parsed.key || parsed.message) && (!messageData || typeof messageData === "string")) {
        messageData = parsed;
        parsed = { args: [], flags: {} };
    }
    const safeParsed = (parsed && typeof parsed === 'object') ? parsed : {};
    const safeMsgData = (messageData && typeof messageData === 'object') ? messageData : {};
    const params = safeParsed.aiArgs || safeParsed;
    const { args = [], flags = {} } = safeParsed;
    const accion = String(params.accion || params.action || flags.accion || flags.action || '').toLowerCase();
    let isSpaceQuery = accion === 'espacio' || accion === 'quota' || (Array.isArray(args) && (args.includes('espacio') || args.includes('quota')));
    try {
        if (!isSpaceQuery && JSON.stringify(safeParsed).includes('espacio')) {
            isSpaceQuery = true;
        }
    } catch {
        // Ignorar error de serialización
    }
    
    if (isSpaceQuery) {
        try {
            const quota = await drive.getQuota();
            const limit = parseInt(quota?.limit, 10);
            const usage = parseInt(quota?.usage, 10);
            const limitGB = (!isNaN(limit) && limit > 0) ? (limit / (1024 ** 3)).toFixed(2) : '0';
            const usageGB = (!isNaN(usage) && usage >= 0) ? (usage / (1024 ** 3)).toFixed(2) : '0';
            const percent = (!isNaN(limit) && limit > 0 && !isNaN(usage)) ? ((usage / limit) * 100).toFixed(1) : '0';
            
            const msg = `> ☁️ *Google Drive*\nEspacio usado: \`${usageGB} GB\` de \`${limitGB} GB\` (${percent}%)\nLibre: \`${(limitGB - usageGB).toFixed(2)} GB\``;
            if (from) await sendText(from, msg);
            return msg;
        } catch (e) {
            throw e;
        }
    }

    let filePath = null;
    const msgKey = safeMsgData.key;
    
    // 1. Verificar si hay multimedia (ya sea en el mensaje actual o citado)
    const mediaType = safeMsgData.messageType;
    const msg = safeMsgData.message || {};
    const isMedia = mediaType && mediaType !== 'conversation' && mediaType !== 'extendedTextMessage' && mediaType !== 'protocolMessage';
    const isQuotedMedia = msg.extendedTextMessage?.contextInfo?.quotedMessage != null;

    if (!isMedia && !isQuotedMedia) {
        if (from) await sendText(from, '> ❌ debes adjuntar o responder a un archivo para subirlo a drive');
        return;
    }

    try {
        // 2. Descargar de WhatsApp
        const mimeType = msg[mediaType]?.mimetype || msg?.documentWithCaptionMessage?.message?.documentMessage?.mimetype || 'application/octet-stream';
        
        const downloaded = await downloadMedia(safeMsgData);
        if (!downloaded || !downloaded.buffer) {
            throw new Error('No se pudo descargar el archivo de WhatsApp');
        }

        const buffer = downloaded.buffer;
        
        let ext = mimeType.split('/')[1] || 'bin';
        if (ext.includes(';')) ext = ext.split(';')[0];
        if (ext === 'jpeg') ext = 'jpg';
        // Usar la extensión que nos da downloadMedia si está disponible
        if (downloaded.extension) ext = downloaded.extension;

        let fileName = msg[mediaType]?.fileName || msg?.documentWithCaptionMessage?.message?.documentMessage?.fileName || `whatsapp_media_${Date.now()}.${ext}`;
        // Si downloadMedia logró extraer el nombre original, lo preferimos
        if (downloaded.originalFileName) fileName = downloaded.originalFileName;

        filePath = path.join(process.env.TMP_DIR || '/tmp/whatsapp-bot', `drive_${Date.now()}_${fileName}`);
        fs.writeFileSync(filePath, buffer);

        // 3. Subir a Google Drive
        await drive.uploadFile(filePath, mimeType, fileName);

        // 4. (La reacción ✅ ahora la maneja el dispatcher central)
    } catch (error) {
        logger.error('Error en handleDrive:', error);
        throw error;
    } finally {
        if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch {}
        }
    }
}

module.exports = {
    handleDrive,
};
