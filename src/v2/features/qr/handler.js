// @ts-check
'use strict';

const MAX_QR_TEXT_CHARS = 8 * 1024;
const QR_TRUNCATION_NOTICE = '\n\n[Lectura QR recortada por límite de tamaño.]';

/** @param {string} value */
function boundedQrText(value) {
    if (value.length <= MAX_QR_TEXT_CHARS) return value;
    const budget = MAX_QR_TEXT_CHARS - QR_TRUNCATION_NOTICE.length;
    let used = 0, prefix = '';
    for (const char of value) { if (used + char.length > budget) break; prefix += char; used += char.length; }
    return `${prefix}${QR_TRUNCATION_NOTICE}`;
}

/** @typedef {{create:(text:string,signal:AbortSignal)=>Promise<{ref:string,mime?:string}>,read:(attachment:import('../../pipeline/contracts').Attachment,signal:AbortSignal)=>Promise<string|null|undefined>}} QrPorts */
/** @param {QrPorts} ports */
function createQrHandler({ create, read }) {
    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} args @param {AbortSignal} signal
     * @returns {Promise<import('../../domain/types').Reply>} */
    return async function qr(ctx, args, signal) {
        signal.throwIfAborted();
        const text = typeof args.text === 'string' ? args.text.trim() : '';
        if (text) {
            try {
                const image = await create(text, signal);
                signal.throwIfAborted();
                if (!image || typeof image.ref !== 'string' || !image.ref.trim() ||
                    (typeof image.mime === 'string' && !image.mime.toLowerCase().startsWith('image/'))) throw new Error('Invalid QR output');
                return { parts: [{ type: 'image', ref: image.ref, mime: typeof image.mime === 'string' ? image.mime : 'image/png', caption: 'Listo, aquí está tu QR.' }], replyTo: ctx.event.id };
            } catch (error) {
                signal.throwIfAborted();
                return { parts: [{ type: 'text', text: 'No pude generar el QR. Prueba con un texto más corto o un enlace.' }], replyTo: ctx.event.id };
            }
        }

        const attachment = ctx.attachment;
        if (!attachment || !(attachment.kind === 'image' || attachment.mime.toLowerCase().startsWith('image/'))) {
            return { parts: [{ type: 'text', text: '¿Lo creamos o lo leemos?\nCrear: `qr [texto o enlace]`.\nLeer: responde a la imagen con `qr`.' }], replyTo: ctx.event.id };
        }
        try {
            const result = await read(attachment, signal);
            signal.throwIfAborted();
            const decoded = typeof result === 'string' ? boundedQrText(result.trim()) : '';
            return { parts: [{ type: 'text', text: decoded
                ? `El QR dice:\n\`\`\`\n${decoded}\n\`\`\``
                : 'No encontré un QR en esa imagen. Prueba con una foto de frente y sin recortar el código.' }], replyTo: ctx.event.id };
        } catch (error) {
            signal.throwIfAborted();
            return { parts: [{ type: 'text', text: 'No pude leer el QR. Prueba con una foto más nítida y con el código completo.' }], replyTo: ctx.event.id };
        }
    };
}

module.exports = { createQrHandler, boundedQrText, MAX_QR_TEXT_CHARS };
