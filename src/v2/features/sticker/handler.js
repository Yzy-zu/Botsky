// @ts-check
'use strict';

const EFFECTS = Object.freeze(['ardilla', 'robot', 'lento', 'rapido', 'grave', 'eco', 'reversa']);
const IMAGE_MIMES = Object.freeze(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff']);
const ANIMATED_MIMES = Object.freeze(['image/gif', 'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm']);

/** @typedef {{ref:string,mime:string}} MediaRef */
/** @typedef {{ref:string,mime:string,kind?:string,id?:string,chatId?:string,ownerJid?:string}} InputMedia */
/** @typedef {{download?:(media:InputMedia,signal:AbortSignal)=>Promise<{buffer:Buffer,extension:string}>,downloadUrl?:(url:string,signal:AbortSignal)=>Promise<InputMedia>,createSticker:(media:InputMedia,options:{crop:boolean,forceAnimated:boolean,maxDurationSeconds:6,signal:AbortSignal})=>Promise<MediaRef>,applyEffect:(media:InputMedia,effect:string,signal:AbortSignal)=>Promise<MediaRef>}} StickerPorts */

/** @param {unknown} value @returns {value is InputMedia} */
function isMedia(value) {
    return Boolean(value && typeof value === 'object' && typeof /** @type {InputMedia} */(value).ref === 'string' &&
        /** @type {InputMedia} */(value).ref.trim() && typeof /** @type {InputMedia} */(value).mime === 'string');
}

/** @param {unknown} value @returns {value is MediaRef} */
function isOutput(value) {
    return Boolean(isMedia(value) && ['image/webp', 'audio/ogg', 'audio/webm'].includes(value.mime.toLowerCase()));
}

/** @param {string} value */
function normalizeHttpUrl(value) {
    if (!value) return '';
    let url;
    try { url = new URL(value); } catch { throw new TypeError('Invalid media URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Invalid media URL');
    return url.href;
}

/** @param {StickerPorts} ports */
function createStickerHandler(ports) {
    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} args @param {AbortSignal} signal @returns {Promise<import('../../domain/types').Reply>} */
    return async function sticker(ctx, args, signal) {
        signal.throwIfAborted();
        const url = typeof args.url === 'string' ? args.url : '';
        const attachment = ctx.attachment;
        let media;
        try {
            if (url) {
                if (!ports.downloadUrl) return textReply(ctx, 'Crear un sticker desde URL no está disponible. Adjunta una imagen o video.');
                media = await ports.downloadUrl(normalizeHttpUrl(url), signal);
                signal.throwIfAborted();
            } else if (attachment && (attachment.kind === 'image' || attachment.kind === 'video' ||
                attachment.mime.toLowerCase().startsWith('image/') || attachment.mime.toLowerCase().startsWith('video/'))) {
                media = { ref: attachment.ref, mime: attachment.mime, kind: attachment.kind,
                    id: attachment.id, chatId: attachment.chatId, ownerJid: attachment.ownerJid };
            } else {
                return textReply(ctx, 'No encontré una imagen o video. Adjunta uno y usa `sticker`, o pasa una URL.');
            }
            if (!isMedia(media) || !IMAGE_MIMES.includes(media.mime.toLowerCase()) && !media.mime.toLowerCase().startsWith('video/')) throw new Error('Invalid sticker input');
            const mime = media.mime.toLowerCase();
            const output = await ports.createSticker(media, { crop: args.crop === true,
                forceAnimated: args.animated === true && ANIMATED_MIMES.includes(mime), maxDurationSeconds: 6, signal });
            signal.throwIfAborted();
            if (!isOutput(output) || output.mime.toLowerCase() !== 'image/webp') throw new Error('Invalid sticker output');
            return { parts: [{ type: 'sticker', ref: output.ref, mime: output.mime }], replyTo: ctx.event.id };
        } catch (error) {
            signal.throwIfAborted();
            return textReply(ctx, url ? 'No pude crear el sticker desde esa URL. Revisa el enlace o adjunta el archivo.' : 'No pude crear el sticker. Prueba con una imagen o video más claro y corto.');
        }
    };
}

/** @param {StickerPorts} ports */
function createEffectHandler(ports) {
    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} args @param {AbortSignal} signal @returns {Promise<import('../../domain/types').Reply>} */
    return async function effect(ctx, args, signal) {
        signal.throwIfAborted();
        const effect = typeof args.effect === 'string' ? args.effect.toLowerCase() : '';
        if (!EFFECTS.includes(effect)) return textReply(ctx, `¿Qué efecto le ponemos? Usa efecto ardilla. También hay: ${EFFECTS.join(', ')}.`);
        const attachment = ctx.attachment;
        if (!attachment || !(attachment.kind === 'audio' || attachment.kind === 'video' ||
            attachment.mime.toLowerCase().startsWith('audio/') || attachment.mime.toLowerCase().startsWith('video/'))) {
            return textReply(ctx, `Responde a un audio o video con efecto ${effect}.`);
        }
        try {
            const output = await ports.applyEffect({ ref: attachment.ref, mime: attachment.mime, kind: attachment.kind,
                id: attachment.id, chatId: attachment.chatId, ownerJid: attachment.ownerJid }, effect, signal);
            signal.throwIfAborted();
            if (!isOutput(output) || !output.mime.toLowerCase().startsWith('audio/')) throw new Error('Invalid effect output');
            return { parts: [{ type: 'audio', ref: output.ref, mime: output.mime }], replyTo: ctx.event.id };
        } catch (error) {
            signal.throwIfAborted();
            return textReply(ctx, 'No pude aplicar el efecto. Prueba de nuevo con otro audio.');
        }
    };
}

/** @param {import('../../pipeline/contracts').Ctx} ctx @param {string} text @returns {import('../../domain/types').Reply} */
function textReply(ctx, text) { return { parts: [{ type: 'text', text }], replyTo: ctx.event.id }; }

module.exports = { createStickerHandler, createEffectHandler, normalizeHttpUrl, EFFECTS };
