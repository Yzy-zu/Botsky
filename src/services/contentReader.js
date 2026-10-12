'use strict';

// Prepare the bytes actually received, rather than describing an attachment the
// model cannot see. This module has no transport or configuration side effects.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { TextDecoder } = require('util');

const MAX_INLINE_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 100_000;
const MAX_PDF_PAGES = 1_000;
const OFFICE_EXTENSIONS = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'doc', 'xls', 'ppt']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'log']);
const OFFICE_MIMES = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.oasis.opendocument.text': 'odt',
    'application/vnd.oasis.opendocument.spreadsheet': 'ods',
    'application/vnd.oasis.opendocument.presentation': 'odp',
    'application/msword': 'doc',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.ms-powerpoint': 'ppt'
};

function fail(status, question) {
    return { success: false, status, needs_clarification: true, question, error: question };
}

function unwrapMessage(message) {
    for (let i = 0; message && i < 6; i++) {
        if (message.documentMessage || message.imageMessage) return message;
        const wrapper = message.documentWithCaptionMessage || message.ephemeralMessage ||
            message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension;
        if (!wrapper?.message) break;
        message = wrapper.message;
    }
    return message || {};
}

function attachmentMetadata(messageData, messageType) {
    const message = unwrapMessage(messageData?.message);
    const type = message.documentMessage ? 'documentMessage' :
        message.imageMessage ? 'imageMessage' : messageType;
    const attachment = message[type] || {};
    const size = attachment.fileLength;
    const declaredSize = typeof size === 'object' && typeof size?.toNumber === 'function'
        ? size.toNumber() : size && typeof size === 'object' && Number.isInteger(size.low)
            ? (Number(size.high || 0) >>> 0) * 0x100000000 + (size.low >>> 0) : Number(size);
    return { type, attachment, declaredSize,
        fileName: path.basename(String(attachment.fileName || '')),
        mimetype: String(attachment.mimetype || '').split(';')[0].trim().toLowerCase(),
        attachmentId: messageData?.quotedStanzaId || messageData?.key?.id || null };
}

function sniffMime(buffer) {
    if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
    if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
    if (buffer.length >= 16 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
    if (buffer.length >= 16 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
        const brand = buffer.subarray(8, 12).toString('ascii');
        if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return 'image/heic';
        if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
    }
    if (buffer.length >= 4 && buffer[0] === 80 && buffer[1] === 75 && [3, 5, 7].includes(buffer[2]) && [4, 6, 8].includes(buffer[3])) return 'application/zip';
    if (buffer.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]))) return 'application/x-ole-storage';
    return null;
}

function createContentReader(dependencies = {}) {
    const download = dependencies.downloadMedia || ((data, options) => require('./evolution').downloadMedia(data, options));
    const run = dependencies.execFile || promisify(execFile);
    const io = dependencies.fs || fs.promises;
    const tempRoot = dependencies.tempRoot || os.tmpdir();
    const reportCleanupError = dependencies.onCleanupError || (error => {
        console.warn('[CONTENT-READER] No se pudo limpiar un directorio temporal:', error.code || error.name);
    });

    async function withWorkspace(prefix, operation) {
        let dir;
        let result;
        try {
            dir = await io.mkdtemp(path.join(tempRoot, prefix));
            result = await operation(dir);
        } catch (_) {
            result = fail('preparation_failed', 'No pude preparar ese archivo para leerlo ahorita. Intenta de nuevo en un momento o manda foto de las páginas que necesitas.');
        } finally {
            if (dir) {
                try { await io.rm(dir, { recursive: true, force: true }); }
                catch (err) {
                    reportCleanupError(err);
                    // Preserve the original reading failure; cleanup must never
                    // turn an encrypted/corrupt file into an unrelated exception.
                    if (result?.success) result = fail('preparation_failed', 'No pude terminar de preparar ese archivo para leerlo. Intenta de nuevo en un momento.');
                }
            }
        }
        return result;
    }

    async function inspectPdf(buffer, fileName) {
        return withWorkspace('botsky-reading-pdf-', async dir => {
            const input = path.join(dir, 'input.pdf');
            await io.writeFile(input, buffer);
            try {
                const { stdout } = await run('pdfinfo', [input], { timeout: 15_000, maxBuffer: 256 * 1024 });
                if (/^Encrypted:\s+yes/im.test(stdout)) return fail('encrypted', 'Ese PDF tiene contraseña. Mándame una copia sin contraseña para poder leerlo.');
                const pageCount = Number(String(stdout).match(/^Pages:\s+(\d+)/im)?.[1]);
                if (!Number.isInteger(pageCount) || pageCount < 1) return fail('corrupt', 'No pude leer las páginas de ese PDF. ¿Puedes reenviar una copia que abra bien?');
                if (pageCount > MAX_PDF_PAGES) return fail('too_many_pages', 'Ese PDF tiene demasiadas páginas para leerlo completo. Mándame solo las páginas o ejercicios que necesitas.');
                return { success: true, pageCount };
            } catch (err) {
                if (/password|encrypted/i.test(`${err.message} ${err.stderr || ''}`)) return fail('encrypted', 'Ese PDF tiene contraseña. Mándame una copia sin contraseña para poder leerlo.');
                if (err.code === 'ENOENT') return fail('reader_unavailable', 'No pude preparar ese PDF para leerlo ahorita. Intenta en un momento o manda fotos de las páginas que necesitas.');
                if (err.killed || err.code === 'ETIMEDOUT') return fail('reading_timeout', 'No alcancé a abrir ese PDF a tiempo. Mándame solo las páginas o ejercicios que necesitas.');
                return fail('corrupt', `No pude abrir ${fileName || 'ese PDF'}. ¿Puedes reenviarlo o mandar foto de las páginas que necesitas?`);
            }
        });
    }

    async function convertOffice(buffer, extension) {
        return withWorkspace('botsky-reading-office-', async dir => {
            const input = path.join(dir, `input.${extension}`);
            const outdir = path.join(dir, 'out');
            await io.mkdir(outdir);
            await io.writeFile(input, buffer);
            // A separate profile prevents a running desktop LibreOffice session
            // from receiving the conversion and isolates simultaneous requests.
            try {
                await run('libreoffice', [
                    `-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`,
                    '--headless', '--nologo', '--nodefault', '--nofirststartwizard',
                    '--convert-to', 'pdf', '--outdir', outdir, input
                ], { timeout: 45_000, maxBuffer: 256 * 1024 });
                const output = path.join(outdir, 'input.pdf');
                const stat = await io.stat(output);
                if (stat.size > MAX_INLINE_BYTES) return fail('too_large', 'Al preparar el documento para leerlo quedó muy grande. Mándame solo las páginas o ejercicios que necesitas.');
                const pdf = await io.readFile(output);
                if (sniffMime(pdf) !== 'application/pdf') return fail('corrupt', 'No pude abrir ese documento. ¿Puedes mandarlo como PDF o enviar fotos de los ejercicios?');
                return { success: true, buffer: pdf };
            } catch (err) {
                if (['ENOSPC', 'EACCES', 'EROFS', 'EMFILE'].includes(err.code)) throw err;
                return fail(err.code === 'ENOENT' ? 'unsupported' : 'conversion_failed', 'No pude leer ese formato. Mándamelo como PDF o envía fotos de las páginas que necesitas.');
            }
        });
    }

    async function prepareContent({ messageData, messageType } = {}) {
        const meta = attachmentMetadata(messageData, messageType);
        if (!['imageMessage', 'documentMessage'].includes(meta.type)) {
            return fail('unsupported', 'Para resolverlo, mándame una imagen, un PDF o un documento con los ejercicios.');
        }
        if (Number.isFinite(meta.declaredSize) && meta.declaredSize > MAX_INLINE_BYTES) {
            return fail('too_large', 'Ese archivo supera los 12 MB que puedo leer de una vez. Divide el documento o mándame las páginas que necesitas.');
        }
        let downloaded;
        try {
            downloaded = await download(messageData, { maxBytes: MAX_INLINE_BYTES });
        } catch (err) {
            if (err.code === 'MEDIA_TOO_LARGE' || /maxContentLength|larger than|max.*size.*exceed/i.test(err.message || '')) {
                return fail('too_large', 'Ese archivo supera los 12 MB que puedo leer de una vez. Divide el documento o mándame las páginas que necesitas.');
            }
            return fail('download_failed', 'No pude descargar ese archivo de WhatsApp. Reenvíalo directamente y dime qué necesitas resolver.');
        }
        let buffer = downloaded?.buffer;
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
            return fail('empty', 'Ese archivo llegó vacío. ¿Puedes volver a mandarlo?');
        }
        if (buffer.length > MAX_INLINE_BYTES) {
            return fail('too_large', 'Ese archivo supera los 12 MB que puedo leer de una vez. Divide el documento o mándame las páginas que necesitas.');
        }
        let mime = sniffMime(buffer);
        let convertedForReading = false;
        let extension = path.extname(meta.fileName).slice(1).toLowerCase();
        if (!extension) extension = OFFICE_MIMES[meta.mimetype] || String(downloaded.extension || '').toLowerCase();
        const officeCandidates = [OFFICE_MIMES[meta.mimetype], extension, String(downloaded.extension || '').toLowerCase()];
        const officeExtension = officeCandidates.find(candidate => {
            if (!OFFICE_EXTENSIONS.has(candidate)) return false;
            const expected = ['doc', 'xls', 'ppt'].includes(candidate) ? 'application/x-ole-storage' : 'application/zip';
            return mime === expected;
        });
        // Metadata can recover .bin/.zip/missing names, but only after the
        // bytes match the relevant container. Every chosen suffix is allowlisted.
        if (officeExtension) extension = officeExtension;
        if (OFFICE_EXTENSIONS.has(extension) && mime !== 'application/pdf' && !mime?.startsWith('image/')) {
            const legacy = ['doc', 'xls', 'ppt'].includes(extension);
            if (mime !== (legacy ? 'application/x-ole-storage' : 'application/zip')) {
                return fail('corrupt', 'El contenido de ese archivo no coincide con su formato. ¿Puedes abrirlo y volver a guardarlo como PDF?');
            }
            const converted = await convertOffice(buffer, extension);
            if (!converted.success) return converted;
            buffer = converted.buffer;
            mime = 'application/pdf';
            convertedForReading = true;
        }
        const mediaContext = {
            type: meta.type, mimetype: mime || meta.mimetype,
            fileName: meta.fileName || downloaded.originalFileName || '',
            originalFileName: meta.fileName || downloaded.originalFileName || '',
            attachmentId: meta.attachmentId, byteLength: buffer.length,
            ...(convertedForReading ? { convertedForReading: true } : {})
        };
        if (mime === 'application/pdf') {
            const pdf = await inspectPdf(buffer, meta.fileName);
            if (!pdf.success) return pdf;
            mediaContext.pageCount = pdf.pageCount;
            mediaContext.base64 = buffer.toString('base64');
        } else if (mime?.startsWith('image/') && mime !== 'image/gif') {
            mediaContext.base64 = buffer.toString('base64');
        } else if (mime === 'image/gif') {
            return fail('unsupported', 'Para leer esa imagen, mándala como foto JPG o PNG. Si es una animación, envía una captura del ejercicio.');
        } else if (!mime && (TEXT_EXTENSIONS.has(extension) || /^text\//.test(meta.mimetype) || meta.mimetype === 'application/json')) {
            let text;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
            catch (_) { return fail('encoding', 'No pude leer la codificación de ese texto. Guárdalo como UTF-8 o mándamelo como PDF.'); }
            if (/[\x00-\x08\x0E-\x1F]/.test(text)) return fail('corrupt', 'Ese archivo parece binario, aunque dice ser texto. Mándame una copia en PDF o texto UTF-8.');
            if (!text.trim()) return fail('empty', 'Ese documento no tiene texto. ¿Puedes mandarme el archivo con los ejercicios?');
            if (text.length > MAX_TEXT_CHARACTERS) return fail('too_long', 'Ese texto es demasiado largo para leerlo completo de una vez. Mándame solo el apartado o los ejercicios que necesitas.');
            mediaContext.mimetype = meta.mimetype || 'text/plain';
            mediaContext.extractedText = text;
        } else {
            return fail('unsupported', 'No puedo leer ese formato aquí. Mándamelo como PDF, imagen JPG/PNG o texto, y dime qué necesitas resolver.');
        }
        return { success: true, mediaContext };
    }

    return { prepareContent };
}

module.exports = {
    prepareContent: (...args) => createContentReader().prepareContent(...args),
    createContentReader, sniffMime, attachmentMetadata,
    MAX_INLINE_BYTES, MAX_TEXT_CHARACTERS, MAX_PDF_PAGES
};
