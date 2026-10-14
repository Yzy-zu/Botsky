// @ts-check
'use strict';
const { AppError } = require('../../domain/errors');

const SESSION_NS = 'feature.documents';
const SESSION_TTL_MS = 20 * 60_000;
const MAX_COLLECTED_FILES = 20;
const PDF_FORMATS = Object.freeze(['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp']);
const MEDIA_FORMATS = Object.freeze(['mp3', 'm4a', 'ogg', 'wav', 'opus', 'mp4', 'webm', 'avi', 'gif', 'webp', 'pdf']);

/** @typedef {{attachment:import('../../pipeline/contracts').Attachment,raw:object}} DocumentSource */
/** @typedef {{process:(request:{operation:string,source?:DocumentSource,sources?:DocumentSource[],args:Record<string,unknown>,signal:AbortSignal})=>Promise<import('../../domain/types').Reply>,readContent:(source:DocumentSource,options:{signal:AbortSignal})=>Promise<string|null|undefined>,readWeb?:(url:string,options:{signal:AbortSignal})=>Promise<string|null>,clock:import('../../platform/clock').Clock,store:import('../../platform/ttlStore').TtlStore}} DocumentPorts */
/** @typedef {ReturnType<typeof createDocumentHandlers>['convert']} Handler */

/** @param {DocumentPorts} ports */
function createDocumentHandlers(ports) {
    const { process, readContent, readWeb, clock, store } = ports;
    if (typeof process !== 'function' || typeof readContent !== 'function' || !clock || !store) throw new TypeError('Document feature requires process, readContent, clock and store ports');

    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {string} operation @param {Record<string,unknown>} args @param {AbortSignal} signal @param {DocumentSource[]} [sources]
     * @returns {Promise<import('../../domain/types').Reply>} */
    async function run(ctx, operation, args, signal, sources) {
        signal.throwIfAborted();
        const attachment = ctx.attachment;
        if (!attachment && !sources?.length && typeof args.url !== 'string') return text(ctx, missingAttachment(operation));
        try {
            const reply = await process({ operation, ...(attachment ? { source: sourceOf(ctx) } : {}), ...(sources ? { sources } : {}), args, signal });
            signal.throwIfAborted();
            return validReply(reply) ? { ...reply, replyTo: ctx.event.id } : text(ctx, 'No pude procesar el archivo. Revisa que abra correctamente y prueba de nuevo.');
        } catch (error) {
            signal.throwIfAborted();
            const pageSelection = safePageSelection(error);
            if (pageSelection) return text(ctx, pageSelection);
            if (error instanceof AppError) throw error;
            return text(ctx, safeFailure(operation));
        }
    }

    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} args @param {AbortSignal} signal */
    async function convert(ctx, args, signal) {
        const format = normalizedString(args.format, 'mp3');
        if (!MEDIA_FORMATS.includes(format)) return text(ctx, `Ese formato no lo manejo. Usa: ${MEDIA_FORMATS.join(', ')}.`);
        const quality = normalizedString(args.quality, 'media');
        if (!['alta', 'media', 'baja'].includes(quality)) return text(ctx, 'La calidad puede ser alta, media o baja.');
        const speed = args.speed === undefined ? 1 : Number(args.speed);
        if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) return text(ctx, 'La velocidad debe estar entre 0.25x y 4x. Por ejemplo: 1.5x.');
        const bitrate = args.bitrate === undefined ? undefined : parseBitrate(args.bitrate);
        if (args.bitrate !== undefined && (!bitrate || bitrate < 8000 || bitrate > 100_000_000)) return text(ctx, 'Dime un bitrate válido para el formato elegido.');
        const url = args.url;
        if (url !== undefined && !validHttpUrl(url)) return text(ctx, 'Mándame un enlace HTTP o HTTPS válido y dime a qué formato convertirlo.');
        if (!ctx.attachment && typeof url !== 'string') return text(ctx, 'Mándame el archivo o su enlace y dime a qué formato lo quieres.');
        if (format === 'pdf' && typeof url === 'string') return text(ctx, 'Para crear un PDF, mándame una imagen o un documento.');
        return run(ctx, 'convert-media', { ...args, format, quality, speed, ...(bitrate ? { bitrate } : {}) }, signal);
    }

    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} args @param {AbortSignal} signal */
    async function document(ctx, args, signal) {
        const format = normalizedString(args.format, 'pdf');
        if (!PDF_FORMATS.includes(format)) return text(ctx, `Formato inválido. Soportados: ${PDF_FORMATS.join(', ')}.`);
        const stateKey = ownerKey(ctx);
        const current = /** @type {{kind:'images'|'pdfs',items:DocumentSource[]}|undefined} */ (store.get(SESSION_NS, stateKey));
        const intent = normalizedString(args.action, '');
        if (intent === 'cancel' || args.cancel === true) return cancel(ctx, stateKey, current);
        if (intent === 'finish' || args.finish === true) return finish(ctx, stateKey, current, signal);
        const attachment = ctx.attachment;
        if (attachment && isPdf(attachment) && args.pages !== undefined) {
            if (typeof args.pages !== 'string' || !args.pages.trim()) return text(ctx, 'Indica qué páginas recortar. Ejemplos: `2-4`, `3-` o `1,3`.');
            return run(ctx, 'crop-pdf', { pages: args.pages }, signal);
        }
        if (attachment && isImage(attachment) && format === 'pdf') {
            const source = sourceOf(ctx);
            const items = current?.kind === 'images' ? [...current.items, source] : [source];
            if (items.length > MAX_COLLECTED_FILES) return text(ctx, `Puedo reunir hasta ${MAX_COLLECTED_FILES} imágenes por PDF. Escribe \`pdf terminar\` o \`pdf cancelar\`.`);
            store.set(SESSION_NS, stateKey, { kind: 'images', items }, SESSION_TTL_MS);
            return text(ctx, `Va, imagen ${items.length} agregada.\nEnvía otra o escribe \`pdf terminar\`.`);
        }
        if (!attachment) {
            if (current?.kind === 'images') return text(ctx, `Ya tengo ${current.items.length} imágenes para tu PDF. Envía más o escribe \`pdf terminar\` para recibirlo.`);
            if (format === 'pdf') {
                store.set(SESSION_NS, stateKey, { kind: 'images', items: [] }, SESSION_TTL_MS);
                return text(ctx, 'Va, armamos un PDF. Envía las imágenes en el orden que quieres y escribe `pdf terminar` cuando acabes.\nPara cancelar: `pdf cancelar`.');
            }
            return text(ctx, 'Responde al archivo con `doc -f pdf`, por ejemplo.');
        }
        return run(ctx, 'convert-document', { ...args, format }, signal);
    }

    /** Pure selector for an addressed user's active PDF collection. @param {import('../../pipeline/contracts').Ctx} ctx */
    function attachmentContinuation(ctx) {
        const attachment=ctx.attachment;
        if (!attachment || ctx.event.text.trim() || attachment.ownerJid!==ctx.event.sender.jid || attachment.chatId!==ctx.event.chatId) return undefined;
        const current=/** @type {{kind:'images'|'pdfs',items:DocumentSource[]}|undefined} */(store.get(SESSION_NS,ownerKey(ctx)));
        if (current?.kind==='images' && isImage(attachment)) return {name:'doc',args:{format:'pdf'}};
        if (current?.kind==='pdfs' && isPdf(attachment)) return {name:'unirpdf',args:{}};
        return undefined;
    }

    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} args @param {AbortSignal} signal */
    async function collectPdfs(ctx, args, signal) {
        const stateKey = ownerKey(ctx);
        const current = /** @type {{kind:'images'|'pdfs',items:DocumentSource[]}|undefined} */ (store.get(SESSION_NS, stateKey));
        if (args.cancel === true || args.action === 'cancel') return cancel(ctx, stateKey, current);
        if (args.finish === true || args.action === 'finish') return finish(ctx, stateKey, current, signal);
        const attachment = ctx.attachment;
        if (!attachment) return text(ctx, 'Adjunta un PDF; cuando termines manda `unir terminar`.');
        if (!isPdf(attachment)) return text(ctx, 'Solo admite `pdf`.');
        const source = sourceOf(ctx);
        const items = current?.kind === 'pdfs' ? [...current.items, source] : [source];
        if (items.length > MAX_COLLECTED_FILES) return text(ctx, `Puedo unir hasta ${MAX_COLLECTED_FILES} PDFs por lista. Escribe \`unir terminar\` o \`unir cancelar\`.`);
        store.set(SESSION_NS, stateKey, { kind: 'pdfs', items }, SESSION_TTL_MS);
        return text(ctx, `PDF ${items.length} en cola.\nEnvía otro o manda \`unir terminar\`.`);
    }

    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} args @param {AbortSignal} signal */
    async function compress(ctx, args, signal) { return run(ctx, 'compress-pdf', args, signal); }
    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} args @param {AbortSignal} signal */
    async function crop(ctx, args, signal) {
        if (typeof args.pages !== 'string' || !args.pages.trim()) return text(ctx, 'Indica qué páginas recortar. Ejemplos: `2-4`, `3-` o `1,3`.');
        return run(ctx, 'crop-pdf', args, signal);
    }
    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} args @param {AbortSignal} signal */
    async function pdfImages(ctx, args, signal) { return run(ctx, 'pdf-to-images', args, signal); }

    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {Record<string,unknown>} args @param {AbortSignal} signal */
    async function read(ctx, args, signal) {
        signal.throwIfAborted();
        const attachment = ctx.attachment;
        const url=typeof args.url==='string'?args.url.trim():'';
        if(url&&(!validHttpUrl(url)||!readWeb))return text(ctx,'Mándame un enlace HTTP o HTTPS válido para leerlo.');
        if (!url&&(!attachment || !isReadable(attachment))) return text(ctx, 'Responde al archivo con `leer` y saco el texto de imágenes, PDF, texto u Office.');
        try {
            const value = url&&readWeb?await readWeb(url,{signal}):await readContent(sourceOf(ctx), { signal });
            signal.throwIfAborted();
            const extracted = typeof value === 'string' ? value.trim() : '';
            return text(ctx, extracted ? `Esto alcancé a leer:\n\n${extracted}` : 'No alcancé a leer texto. Prueba con una foto más nítida, de frente y con buena luz.');
        } catch (error) {
            signal.throwIfAborted();
            const specific=safeReadFeedback(error);
            if(specific)return text(ctx,specific);
            if (error instanceof AppError) throw error;
            return text(ctx, 'No pude leer ese archivo. Prueba con una copia legible o una foto más nítida.');
        }
    }

    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {string} key @param {{kind:'images'|'pdfs',items:DocumentSource[]}|undefined} session */
    function cancel(ctx, key, session) {
        if (!session) return text(ctx, 'No hay ningún PDF en preparación aquí.');
        store.delete(SESSION_NS, key);
        return text(ctx, session.kind === 'images' ? 'Listo, cancelé el PDF y quité las imágenes de la lista.' : 'Listo, cancelé la unión de PDFs y vacié la lista.');
    }

    /** @param {import('../../pipeline/contracts').Ctx} ctx @param {string} key @param {{kind:'images'|'pdfs',items:DocumentSource[]}|undefined} session @param {AbortSignal} signal */
    async function finish(ctx, key, session, signal) {
        if (!session) return text(ctx, 'Todavía no hay archivos en la lista. Inicia con `pdf` o `unir` y envíame los archivos.');
        store.delete(SESSION_NS, key);
        if (!session.items.length) return text(ctx, 'Faltan las imágenes. Envía la primera con `pdf`.');
        return run(ctx, session.kind === 'images' ? 'images-to-pdf' : 'merge-pdfs', { count: session.items.length }, signal, session.items);
    }

    return { convert, document, collectPdfs, compress, crop, pdfImages, read, attachmentContinuation };
}

/** @param {import('../../pipeline/contracts').Ctx} ctx */
function ownerKey(ctx) { return JSON.stringify([ctx.event.chatId, ctx.event.sender.jid]); }
/** @param {import('../../pipeline/contracts').Ctx} ctx @returns {DocumentSource} */
function sourceOf(ctx) { if (!ctx.attachment) throw new TypeError('Attachment required'); return { attachment: ctx.attachment, raw: ctx.event.raw }; }
/** @param {import('../../pipeline/contracts').Attachment} attachment */
function isImage(attachment) { return attachment.kind === 'image' || attachment.mime.toLowerCase().startsWith('image/'); }
/** @param {import('../../pipeline/contracts').Attachment} attachment */
function isPdf(attachment) { return attachment.mime.toLowerCase() === 'application/pdf' || attachment.ref.toLowerCase().split(/[?#]/, 1)[0].endsWith('.pdf'); }
/** @param {import('../../pipeline/contracts').Attachment} attachment */
function isReadable(attachment) {
    if(isImage(attachment)||isPdf(attachment))return true;
    const mime=attachment.mime.toLowerCase().split(';',1)[0].trim();
    const extension=String(attachment.ref).toLowerCase().split(/[?#]/,1)[0].split('.').pop()||'';
    return mime.startsWith('text/')||mime==='application/json'||mime==='application/xhtml+xml'||
        ['txt','md','csv','json','log','text','html','htm','docx','xlsx','pptx','odt','ods','odp','doc','xls','ppt'].includes(extension);
}
/** @param {unknown} value @param {string} fallback */
function normalizedString(value, fallback) { return typeof value === 'string' ? value.trim().toLowerCase() || fallback : fallback; }
/** @param {unknown} value @returns {value is string} */
function validHttpUrl(value) { try { const url = new URL(/** @type {string} */ (value)); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } }
/** @param {unknown} value @returns {number|undefined} */
function parseBitrate(value) {
    const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*([km])?(?:b(?:ps|\/s)?)?$/i);
    if (!match) return undefined;
    const bits = Number(match[1]) * ({ k: 1000, m: 1_000_000 }[String(match[2] || '').toLowerCase()] || 1);
    return Number.isSafeInteger(bits) && bits > 0 ? bits : undefined;
}
/** @param {import('../../pipeline/contracts').Ctx} ctx @param {string} message @returns {import('../../domain/types').Reply} */
function text(ctx, message) { return { parts: [{ type: 'text', text: message }], replyTo: ctx.event.id }; }
/** @param {unknown} value @returns {value is import('../../domain/types').Reply} */
function validReply(value) { return Boolean(value && typeof value === 'object' && Array.isArray(/** @type {{parts?:unknown}} */ (value).parts)); }
/** @param {string} operation */
function missingAttachment(operation) { return operation === 'convert-media' ? 'Mándame el archivo o su enlace y dime a qué formato lo quieres.' : 'Responde al archivo con el comando que quieres usar.'; }
/** @param {string} operation */
function safeFailure(operation) { return operation === 'convert-media' ? 'No pude convertirlo. Prueba con otro archivo o formato.' : 'No pude procesar el archivo. Revisa que abra correctamente y prueba de nuevo.'; }
/** @param {unknown} error @returns {string|undefined} */
function safePageSelection(error) {
    if (!error || typeof error !== 'object') return undefined;
    const value=/** @type {{name?:unknown,code?:unknown,reason?:unknown,totalPages?:unknown}} */(error);
    if(value.name!=='PageSelectionError'||value.code!=='INVALID_PDF_PAGES'||!Number.isSafeInteger(value.totalPages)||/** @type {number} */(value.totalPages)<1||/** @type {number} */(value.totalPages)>100_000) return undefined;
    if(value.reason==='required')return 'Indica qué páginas recortar. Ejemplos: `2-4`, `3-` o `1,3`.';
    if(value.reason==='positive')return 'Las páginas deben ser mayores a 0. Ejemplo: `2-4`.';
    if(value.reason==='format')return 'Formato de páginas inválido. Ejemplo: `1-5`, `3-` o `1,3`.';
    if(value.reason==='range')return `La selección supera el total de páginas (${value.totalPages}).`;
    return undefined;
}
/** @param {unknown} error @returns {string|undefined} */
function safeReadFeedback(error) {
    if(!(error instanceof AppError))return undefined;
    if(error.reason==='media_unavailable')return 'WhatsApp ya no tiene disponible ese archivo. Reenvíalo directamente y dime qué necesitas leer.';
    if(error.reason==='media_download_failed')return 'No pude descargar el archivo. Reenvíalo directamente y vuelve a pedir que lo lea.';
    if(error.reason==='media_too_large')return 'Ese archivo supera el límite de tamaño para lectura. Envíame uno más pequeño o solo las páginas que necesitas.';
    if(error.reason==='pdf_no_pages')return 'No encontré páginas legibles en ese PDF. Reenvíame una copia que abra correctamente.';
    if(error.reason==='pdf_page_limit')return 'Ese PDF supera el límite de páginas para lectura. Envíame solo las páginas o ejercicios que necesitas.';
    if(error.reason==='pdf_corrupt')return 'No pude abrir ese PDF. Reenvíame una copia que abra correctamente o conviértelo a imágenes claras.';
    if(error.reason==='pdf_encrypted')return 'Ese PDF está protegido con contraseña. Envíame una copia sin contraseña para poder leerlo.';
    if(error.reason==='pdf_reader_unavailable')return 'Ahora no está disponible el lector de PDF. Envíame las páginas como imágenes claras o inténtalo más tarde.';
    if(error.reason==='pdf_reader_timeout')return 'El PDF tardó demasiado en abrirse. Envíame menos páginas o una copia más pequeña.';
    if(error.reason==='temp_prepare_failed')return 'No pude preparar el archivo para leerlo. Reenvíalo o intenta con una copia más pequeña.';
    if(error.reason==='temp_cleanup_failed')return 'No pude terminar de procesar el archivo de forma segura. Reenvíalo y vuelve a intentarlo.';
    if(error.reason==='gif_requires_still_image')return 'No puedo leer un GIF animado. Envíame una foto fija, legible y de frente.';
    return undefined;
}
module.exports = { createDocumentHandlers, SESSION_NS, SESSION_TTL_MS, MAX_COLLECTED_FILES, parseBitrate, validHttpUrl };
