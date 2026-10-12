'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const evolution = require('../services/evolution');
const logger = require('../services/logger');
const { generateRelayedMessage } = require('./mensaje');
const { deliverSemantic } = require('../services/outboundDelivery');
const MEDIA_TYPES = new Set(['audioMessage', 'imageMessage', 'videoMessage', 'documentMessage', 'stickerMessage']);

async function handleEnviarMedia(parsed = {}, from, messageData = {}) {
    let args = parsed.aiArgs || parsed.semanticDecision?.args;
    if (!args) {
        const { routeWithAI } = require('../services/ai');
        const { getSenderJid } = require('../core/auth');
        const type = MEDIA_TYPES.has(messageData.messageType) ? messageData.messageType : Object.keys(messageData.message || {}).find(key => MEDIA_TYPES.has(key));
        const item = require('../services/attachmentContext').rememberAttachment({ from, participant: getSenderJid(from, messageData), messageData, messageType: type });
        const metadata = item ? require('../services/semanticRouting').publicAttachment(item) : null;
        const decision = await routeWithAI(parsed.raw || '', messageData.pushName, from.endsWith('@g.us'),
            [], metadata ? { type, attachmentId: metadata.id, fileName: metadata.fileName, mimetype: metadata.mime } : null,
            null, getSenderJid(from, messageData), from, { attachments: metadata ? [metadata] : [] });
        if (!decision || decision.needs_clarification || decision.action !== 'enviarmedia') {
            const question = decision?.question || 'Adjunta o cita el archivo y dime a qué chat va.';
            await evolution.sendText(from, question);
            return { success: false, needs_clarification: true, question, enviado_al_chat: true };
        }
        args = decision.args;
    }
    const request = args.instruccion || parsed.raw || '';
    const type = MEDIA_TYPES.has(messageData.messageType) ? messageData.messageType : Object.keys(messageData.message || {}).find(key => MEDIA_TYPES.has(key));
    const media = messageData.message?.[type];
    const wanted = args.tipo_archivo;
    const documentImage = type === 'documentMessage' && media?.mimetype?.startsWith('image/');
    if (!media || (wanted && (!MEDIA_TYPES.has(wanted) || (wanted !== type && !(wanted === 'imageMessage' && documentImage))))) {
        const question = wanted === 'audioMessage' ? 'Cita o adjunta el audio que quieres mandar; así envío ese mismo.'
            : 'Adjunta o cita el archivo que quieres mandar y dime a quién.';
        await evolution.sendText(from, question);
        return { success: false, needs_clarification: true, question, enviado_al_chat: true };
    }
    const captionMode = args.caption_mode || 'none';
    if (!['none', 'original', 'compose', 'literal'].includes(captionMode) ||
        (['compose', 'literal'].includes(captionMode) && (typeof args.caption !== 'string' || !args.caption.trim()))) {
        const question = '¿Qué texto quieres que acompañe el archivo?';
        await evolution.sendText(from, question);
        return { success: false, needs_clarification: true, question, enviado_al_chat: true };
    }
    const execute = async target => {
        let directory;
        try {
            let caption = '';
            if (captionMode === 'original') caption = media.caption || '';
            else if (captionMode === 'literal') caption = args.caption;
            else if (captionMode === 'compose') caption = await generateRelayedMessage(
                messageData.pushName || 'tu compa', target.user_name, args.caption,
                { isGroup: Boolean(target.is_group), rawInstruction: request });
            // Download the actual current/quoted payload; no model sees its bytes.
            const downloaded = await evolution.downloadMedia(messageData, { maxBytes: 64 * 1024 * 1024 });
            if (!Buffer.isBuffer(downloaded.buffer) || !downloaded.buffer.length) throw Error('Archivo vacío');
            const defaults = { audioMessage: 'ogg', imageMessage: 'jpg', videoMessage: 'mp4', documentMessage: 'bin', stickerMessage: 'webp' };
            const extension = /^[a-z0-9]{1,8}$/i.test(downloaded.extension || '') ? downloaded.extension : defaults[type];
            directory = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-send-'));
            const file = path.join(directory, `media.${extension}`);
            await fs.writeFile(file, downloaded.buffer, { mode: 0o600 });
            if (type === 'audioMessage') await evolution.sendVoiceNote(target.jid, file);
            else if (type === 'stickerMessage') await evolution.sendSticker(target.jid, file);
            else {
                await evolution.sendMedia(target.jid, file, caption, type === 'documentMessage', false, null,
                media.fileName ? path.basename(media.fileName) : null);
            }
            logger.info(`[ENVIO-MEDIA] ${type} entregado a ${target.jid}`);
            return { success: true, status: 'sent', jid: target.jid, destinatario: target.user_name,
                confirmacion: `Va, ya mandé ${type === 'audioMessage' ? 'el audio' : 'el archivo'} ${target.is_group ? 'al grupo' : `a ${target.user_name}`}.` };
        } catch (err) {
            logger.warn(`[ENVIO-MEDIA] Falló envío: ${err.message}`);
            return { success: false, status: 'send_failed', error: err.sentMedia
                ? 'El archivo se entregó, pero falló parte del texto. No lo vuelvas a mandar sin revisar.'
                : ['MEDIA_UNAVAILABLE', 'MEDIA_DOWNLOAD_FAILED'].includes(err.code) ? 'No pude recuperar ese archivo. Reenvíamelo directamente.' : 'No pude mandar el archivo. No tengo confirmación de entrega; revisa el chat antes de reintentarlo.' };
        } finally {
            if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(error => logger.warn(`[ENVIO-MEDIA] Limpieza: ${error.message}`));
        }
    };
    return deliverSemantic({ args, from, messageData, execute, payloadLabel: 'archivo' });
}

module.exports = { handleEnviarMedia };
