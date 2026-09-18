'use strict';

const fs = require('fs');
const path = require('path');
const { downloadMedia, sendText } = require('../services/evolution');
const { uploadFile, getQuota } = require('../services/drive');
const logger = require('../services/logger');

async function handleDrive(parsed, from, messageData) {
    const { args = [], flags = {} } = parsed || {};
    const isSpaceQuery = flags.accion === 'espacio' || flags.accion === 'quota' || flags.action === 'espacio' || args.includes('espacio') || args.includes('quota') || JSON.stringify(parsed).includes('espacio');
    
    if (isSpaceQuery) {
        try {
            const quota = await getQuota();
            const limit = parseInt(quota.limit, 10);
            const usage = parseInt(quota.usage, 10);
            const limitGB = (limit / (1024 ** 3)).toFixed(2);
            const usageGB = (usage / (1024 ** 3)).toFixed(2);
            const percent = ((usage / limit) * 100).toFixed(1);
            
            const msg = `> ☁️ *Google Drive*\nEspacio usado: \`${usageGB} GB\` de \`${limitGB} GB\` (${percent}%)\nLibre: \`${(limitGB - usageGB).toFixed(2)} GB\``;
            await sendText(from, msg);
            return msg;
        } catch (e) {
            throw e;
        }
        return;
    }

    let filePath = null;
    const msgKey = messageData.key; // Usamos la key completa para que fromMe esté correcto
    
        // 1. Verificar si hay multimedia (ya sea en el mensaje actual o citado)
        const mediaType = messageData.messageType;
        const msg = messageData.message || {};
        const isMedia = mediaType !== 'conversation' && mediaType !== 'extendedTextMessage' && mediaType !== 'protocolMessage';
        const isQuotedMedia = msg.extendedTextMessage?.contextInfo?.quotedMessage != null;

        if (!isMedia && !isQuotedMedia) {
            await sendText(from, '> ❌ debes adjuntar o responder a un archivo para subirlo a drive');
            return;
        }

        try {
            // 2. Descargar de WhatsApp
            const mimeType = msg[mediaType]?.mimetype || msg?.documentWithCaptionMessage?.message?.documentMessage?.mimetype || 'application/octet-stream';
        
        const downloaded = await downloadMedia(messageData);
        if (!downloaded || !downloaded.buffer) {
            throw new Error('No se pudo descargar el archivo de WhatsApp');
        }

        const buffer = downloaded.buffer;
        
        let ext = mimeType.split('/')[1] || 'bin';
        if (ext.includes(';')) ext = ext.split(';')[0];
        if (ext === 'jpeg') ext = 'jpg';
        // Usar la extensión que nos da downloadMedia si está disponible
        if (downloaded.extension) ext = downloaded.extension;

        let fileName = messageData.message[mediaType]?.fileName || messageData.message?.documentWithCaptionMessage?.message?.documentMessage?.fileName || `whatsapp_media_${Date.now()}.${ext}`;
        // Si downloadMedia logró extraer el nombre original, lo preferimos
        if (downloaded.originalFileName) fileName = downloaded.originalFileName;

        filePath = path.join(process.env.TMP_DIR || '/tmp/whatsapp-bot', `drive_${Date.now()}_${fileName}`);
        fs.writeFileSync(filePath, buffer);

        // 3. Subir a Google Drive
        await uploadFile(filePath, mimeType, fileName);

        // 4. (La reacción ✅ ahora la maneja el dispatcher central)
    } catch (error) {
        logger.error('Error en handleDrive:', error);
        throw error;
    } finally {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
}

module.exports = {
    handleDrive,
};
