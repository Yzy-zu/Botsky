'use strict';

const { cleanup } = require('../utils/cleanup');
const { getSessionKey } = require('../utils/session');

const fs = require('fs');
const path = require('path');
const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const evolution = require('../services/evolution');
const sendText = (...args) => evolution.sendText(...args);
const sendMedia = (...args) => evolution.sendMedia(...args);
const downloadMedia = (...args) => evolution.downloadMedia(...args);
const logger = require('../services/logger');
const { registerTask } = require('../services/scheduler');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';



const userPdfs = new Map(); // sessionKey -> { id, count, lastActive }
const userImagePdfs = new Map(); // sessionKey -> { id, files: [], lastActive }

const getDocSessionKey = (from, participant) => getSessionKey(from, participant ? { participant } : null);

// Limpiar sesiones inactivas de más de 20 minutos
function cleanExpiredSessions() {
    const now = Date.now();
    const timeout = 20 * 60 * 1000; // 20 minutos
    for (const [key, session] of userImagePdfs.entries()) {
        if (now - session.lastActive > timeout) {
            for (const file of session.files) {
                cleanup(file);
            }
            userImagePdfs.delete(key);
            logger.info(`Sesión de imágenes PDF expirada y limpiada para ${key}`);
        }
    }
    for (const [key, session] of userPdfs.entries()) {
        if (now - session.lastActive > timeout) {
            for (let i = 1; i <= session.count; i++) {
                cleanup(path.join(TMP_DIR, `${session.id}-part-${String(i).padStart(3, '0')}.pdf`));
            }
            userPdfs.delete(key);
            logger.info(`Sesión de unión de PDFs expirada y limpiada para ${key}`);
        }
    }
}

// Limpiar periódicamente en segundo plano de forma coordinada (PERF-2)
registerTask('documentos-sessions', 5, cleanExpiredSessions);

function hasActiveSession(from, participant = null) {
    cleanExpiredSessions();
    const key = getDocSessionKey(from, participant);
    if (userImagePdfs.has(key)) {
        return 'pdf';
    }
    if (userPdfs.has(key)) {
        return 'unir';
    }
    return null;
}

async function handleDoc(parsed = {}, from, messageData = {}) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    if (!from) return;
    cleanExpiredSessions();
    const participant = messageData?.key?.participant || messageData?.participant || from;
    const sessionKey = getDocSessionKey(from, participant);
    const safeParsed = (parsed && typeof parsed === 'object') ? parsed : {};
    const args = Array.isArray(safeParsed.args) ? safeParsed.args : [];
    const flags = safeParsed.flags || {};

    const isTerminar = args[0] === 'terminar' || !!flags.terminar;
    const isCancelar = args[0] === 'cancelar' || !!flags.cancelar;

    if (isTerminar) {
        if (!userImagePdfs.has(sessionKey)) {
            return sendText(from, 'Todavía no hay imágenes para el PDF. Inicia con `pdf` y envíame las fotos.');
        }

        const session = userImagePdfs.get(sessionKey);
        userImagePdfs.delete(sessionKey);

        if (session.files.length === 0) {
            return sendText(from, 'Faltan las imágenes. Envía la primera con `pdf`.');
        }

        const outputPath = path.join(TMP_DIR, `${session.id}-merged.pdf`);
        // Mensaje de carga eliminado

        try {
            const sortedFiles = [...session.files].sort();
            logger.cmd(`convert ${sortedFiles.join(' ')} "${outputPath}"`);
            await execFileAsync('convert', [...sortedFiles, outputPath], { timeout: 120_000 });

            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                throw new Error('error al generar PDF final');
            }

            await sendMedia(from, outputPath, 'Listo, aquí está tu PDF.', false, false, null, `imagenes-${Date.now()}.pdf`);
        } catch (err) {
            logger.error('doc merge:', err.message);
            await sendText(from, 'No pude armar el PDF. Inicia de nuevo con pdf y vuelve a enviar las imágenes.');
        } finally {
            cleanup(outputPath);
            for (const file of session.files) {
                cleanup(file);
            }
        }
        return;
    }

    if (isCancelar) {
        if (userImagePdfs.has(sessionKey)) {
            const session = userImagePdfs.get(sessionKey);
            userImagePdfs.delete(sessionKey);
            for (const file of session.files) {
                cleanup(file);
            }
            return sendText(from, 'Listo, cancelé el PDF y quité las imágenes de la lista.');
        }
        if (userPdfs.has(sessionKey)) {
            const session = userPdfs.get(sessionKey);
            userPdfs.delete(sessionKey);
            for (let i = 1; i <= session.count; i++) {
                cleanup(path.join(TMP_DIR, `${session.id}-part-${String(i).padStart(3, '0')}.pdf`));
            }
            return sendText(from, 'Listo, cancelé la unión de PDFs y vacié la lista.');
        }
        return sendText(from, 'No hay ningún PDF en preparación aquí.');
    }

    const isNativeImage = messageData?.messageType?.toLowerCase().includes('image');
    const isDocumentImage = messageData?.messageType?.toLowerCase().includes('document') && 
        (messageData.message?.documentMessage?.mimetype?.startsWith('image/') || 
         messageData.message?.documentMessage?.fileName?.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/i));
    const isImage = isNativeImage || isDocumentImage;
    const isDocument = messageData?.messageType?.toLowerCase().includes('document') && !isDocumentImage;
    const format = (parsed.flags.f ?? parsed.flags.formato ?? 'pdf').toLowerCase();

    if (!isDocument && !isImage) {
        if (format === 'pdf') {
            if (!userImagePdfs.has(sessionKey)) {
                const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                userImagePdfs.set(sessionKey, { id: sessionId, files: [], lastActive: Date.now() });
                return sendText(from, 'Va, armamos un PDF. Envía las imágenes en el orden que quieres y escribe `pdf terminar` cuando acabes.\nPara cancelar: `pdf cancelar`.');
            } else {
                const session = userImagePdfs.get(sessionKey);
                return sendText(from, `Ya tengo ${session.files.length} imágenes para tu PDF. Envía más o escribe \`pdf terminar\` para recibirlo.`);
            }
        }
        return sendText(from, 'Responde al archivo con `doc -f pdf`, por ejemplo.');
    }

    const validFormats = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp'];

    if (!validFormats.includes(format)) {
        return sendText(from, `> formato invalido\nsoportados: \`${validFormats.join('\` \`')}\``);
    }

    // sessionId siempre generado: se usa tanto en el path de imagen (cuando no hay sesión activa)
    // como en el path de documento. Nunca puede quedar null.
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let inputPath = null;
    let outputPath = null;

    try {
        if (isImage) {
            if (format !== 'pdf') {
                return sendText(from, '> las imagenes solo se convierten a `pdf` con este comando');
            }

            const { buffer, extension } = await downloadMedia(messageData);
            
            let session;
            if (!userImagePdfs.has(sessionKey)) {
                session = { id: sessionId, files: [], lastActive: Date.now() };
                userImagePdfs.set(sessionKey, session);
            } else {
                session = userImagePdfs.get(sessionKey);
                session.lastActive = Date.now();
            }

            const imgIndex = session.files.length + 1;
            const imgPath = path.join(TMP_DIR, `${session.id}-img-${String(imgIndex).padStart(3, '0')}.${extension}`);
            fs.writeFileSync(imgPath, buffer);
            session.files.push(imgPath);

            await sendText(from, `Va, imagen ${imgIndex} agregada.\nEnvía otra o escribe \`pdf terminar\`.`);
        } else {
            // Mensaje eliminado
            const { buffer, extension, originalFileName } = await downloadMedia(messageData);
            inputPath = path.join(TMP_DIR, `${sessionId}-input.${extension}`);
            fs.writeFileSync(inputPath, buffer);

            if (extension === format) {
                const hasPages = parsed.flags.pages || parsed.flags.p || parsed.flags.paginas || parsed.aiArgs?.paginas || (parsed.args[0] && /^[0-9,-]+$/.test(parsed.args[0]));
                if (format === 'pdf' && hasPages) {
                    cleanup(inputPath);
                    return handleRecortarPdf(parsed, from, messageData);
                }
                cleanup(inputPath);
                return sendText(from, `El archivo ya está en \`${format}\`. Puedes usarlo tal cual.`);
            }

            // Mensaje eliminado

            outputPath = path.join(TMP_DIR, `${sessionId}-input.${format}`);

            let infilter = '';
            if (extension === 'pdf') {
                if (['docx', 'doc', 'odt'].includes(format)) infilter = '--infilter="writer_pdf_import"';
                else if (['pptx', 'ppt', 'odp'].includes(format)) infilter = '--infilter="impress_pdf_import"';
                else if (['xlsx', 'xls', 'ods'].includes(format)) {
                     cleanup(inputPath);
                     return sendText(from, 'No puedo pasar de PDF a Excel con este comando. Si tienes el archivo original de la hoja de cálculo, envíame ese.');
                }
            }
            const cmd = `libreoffice --headless "-env:UserInstallation=file:///tmp/libreoffice_profile" ${infilter} --convert-to ${format} "${inputPath}" --outdir "${TMP_DIR}"`;

            logger.cmd(cmd);
            await execAsync(cmd, { cwd: TMP_DIR, timeout: 120_000 });

            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                throw new Error(`el script no pudo generar el archivo ${format.toUpperCase()}.`);
            }

            let customFileName = null;
            if (originalFileName) {
                const baseName = path.parse(originalFileName).name;
                customFileName = `${baseName}.${format}`;
            }

            await sendMedia(from, outputPath, '> listo', false, false, null, customFileName);
        }
    } catch (err) {
        logger.error('doc:', err.message);
        await sendText(from, 'No pude procesar el archivo. Revisa que abra correctamente y prueba de nuevo.');
    } finally {
        cleanup(inputPath, outputPath);
    }
}

async function handleComprimir(parsed, from, messageData) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    if (!isDocumentMessage(messageData)) {
        return sendText(from, 'Responde al PDF con `comprimir` y trato de reducir su tamaño.');
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let inputPath = null;
    let outputPath = null;

    try {
        const { buffer, extension, originalFileName } = await downloadMedia(messageData);
        const msg = messageData?.message;
        const mimeType = msg?.documentMessage?.mimetype || msg?.documentWithCaptionMessage?.message?.documentMessage?.mimetype;

        if (extension !== 'pdf' || mimeType !== 'application/pdf') {
            return sendText(from, 'Para comprimir necesito un archivo PDF. Envíalo y usa `comprimir`.');
        }

        inputPath = path.join(TMP_DIR, `${sessionId}-input.pdf`);
        outputPath = path.join(TMP_DIR, `${sessionId}-output.pdf`);
        fs.writeFileSync(inputPath, buffer);

        const originalSizeMB = (fs.statSync(inputPath).size / (1024 * 1024)).toFixed(2);
        await sendText(from, `> comprimiendo \`${originalSizeMB}mb\``);

        const cmd = [
            'gs',
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.4',
            '-dPDFSETTINGS=/screen',
            '-dNOPAUSE',
            '-dQUIET',
            '-dBATCH',
            `-sOutputFile="${outputPath}"`,
            `"${inputPath}"`
        ].join(' ');

        logger.cmd(cmd);
        await execAsync(cmd, { timeout: 60_000 });

        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
            throw new Error('el skript fallo al comprimir');
        }

        const newSizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
        await sendMedia(from, outputPath, `> listo \`${originalSizeMB}mb\` -> \`${newSizeMB}mb\``, false, false, null, originalFileName);
    } catch (err) {
        logger.error('comprimir:', err.message);
        await sendText(from, 'No pude procesar el archivo. Revisa que abra correctamente y prueba de nuevo.');
    } finally {
        cleanup(inputPath, outputPath);
    }
}

async function getPdfPageCount(filePath) {
    try {
        const { stdout } = await execFileAsync('pdfinfo', [filePath], { timeout: 10_000 });
        const match = stdout.match(/^Pages:\s*(\d+)/m);
        return match ? parseInt(match[1], 10) : null;
    } catch {
        return null;
    }
}

function parsePageRange(raw) {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (value === 'ultima') return value;
    return value && value.split(',').every(part => /^\d+(?:-\d*)?$/.test(part)) ? value : null;
}

function normalizeAndClampPageList(raw, totalPages) {
    let parsed = parsePageRange(raw);
    if (parsed === 'ultima') {
        if (!totalPages) return { valid: false, error: 'no se pudo determinar la última página' };
        parsed = `${totalPages}`;
    }
    if (!parsed) return { valid: false, error: 'formato de páginas inválido (ej: 1-5, 68-, 2,4,6)' };

    if (!totalPages) return { valid: true, pageList: parsed };

    const parts = parsed.split(',');
    const adjusted = [];

    for (const part of parts) {
        if (part.endsWith('-')) {
            const start = parseInt(part.slice(0, -1), 10);
            if (start > totalPages) {
                return { valid: false, error: `la página inicial (${start}) supera el total de páginas (${totalPages})` };
            }
            if (start < 1) {
                return { valid: false, error: 'el número de página debe ser mayor a 0' };
            }
            adjusted.push(`${start}-${totalPages}`);
        } else if (part.includes('-')) {
            let [s, e] = part.split('-').map(n => parseInt(n, 10));
            if (s > e) [s, e] = [e, s];
            if (s > totalPages) {
                return { valid: false, error: `la página inicial (${s}) supera el total de páginas (${totalPages})` };
            }
            if (s < 1) s = 1;
            if (e > totalPages) e = totalPages;
            adjusted.push(s === e ? `${s}` : `${s}-${e}`);
        } else {
            const p = parseInt(part, 10);
            if (p > totalPages) {
                return { valid: false, error: `la página (${p}) supera el total de páginas (${totalPages})` };
            }
            if (p < 1) {
                return { valid: false, error: 'el número de página debe ser mayor a 0' };
            }
            adjusted.push(`${p}`);
        }
    }

    adjusted.sort((a, b) => parseInt(a.split('-')[0], 10) - parseInt(b.split('-')[0], 10));
    return { valid: true, pageList: adjusted.join(',') };
}

function isDocumentMessage(messageData) {
    if (messageData.actualMessageType?.toLowerCase().includes('document')) return true;
    if (messageData.messageType?.toLowerCase().includes('document')) return true;
    if (messageData.quotedStanzaId) return true;
    const msg = messageData.message;
    if (msg?.documentMessage || msg?.documentWithCaptionMessage) return true;
    const quoted = msg?.extendedTextMessage?.contextInfo?.quotedMessage || messageData.contextInfo?.quotedMessage;
    if (quoted?.documentMessage || quoted?.documentWithCaptionMessage) return true;
    return false;
}

async function handleRecortarPdf(parsed = {}, from, messageData = {}) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    if (!from) return;
    if (!isDocumentMessage(messageData)) {
        return sendText(from, '> adjunta o cita un pdf\nusa `recortar [páginas]` (ej: `recortar 1-5` o `recortar 68-`)');
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let inputPath = null;
    let outputPath = null;

    try {
        const { buffer, extension, originalFileName } = await downloadMedia(messageData);
        const msg = messageData?.message;
        const mimeType = msg?.documentMessage?.mimetype || msg?.documentWithCaptionMessage?.message?.documentMessage?.mimetype;

        if (extension !== 'pdf' || (mimeType && mimeType !== 'application/pdf')) {
            return sendText(from, 'Para comprimir necesito un archivo PDF. Envíalo y usa `comprimir`.');
        }

        inputPath = path.join(TMP_DIR, `${sessionId}-input.pdf`);
        outputPath = path.join(TMP_DIR, `${sessionId}-recortado.pdf`);
        fs.writeFileSync(inputPath, buffer);

        const totalPages = await getPdfPageCount(inputPath);

        const safeParsed = (parsed && typeof parsed === 'object') ? parsed : {};
        const flags = safeParsed.flags || {};
        const args = Array.isArray(safeParsed.args) ? safeParsed.args : [];

        const rawPages = (
            flags.pages ||
            flags.p ||
            flags.paginas ||
            safeParsed.aiArgs?.paginas ||
            (args.length > 0 ? args.join(' ') : null)
        );

        if (!rawPages) {
            const totalMsg = totalPages ? ` (el documento tiene \`${totalPages}\` páginas)` : '';
            return sendText(from, `> indica qué páginas recortar${totalMsg}\n> ej: \`recortar 1-5\`, \`recortar 68-\`, \`recortar 2,4,6\``);
        }

        const { valid, pageList, error } = normalizeAndClampPageList(String(rawPages), totalPages);
        if (!valid) {
            const totalMsg = totalPages ? ` (total: ${totalPages} páginas)` : '';
            return sendText(from, `> error en páginas: ${error}${totalMsg}`);
        }

        await sendText(from, `> recortando páginas \`${pageList}\`${totalPages ? ` de \`${totalPages}\`` : ''}...`);

        const gsArgs = [
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.4',
            '-dNOPAUSE',
            '-dQUIET',
            '-dBATCH',
            '-dSAFER',
            `-sPageList=${pageList}`,
            `-sOutputFile=${outputPath}`,
            inputPath
        ];

        logger.cmd(`gs ${gsArgs.join(' ')}`);
        await execFileAsync('gs', gsArgs, { timeout: 60_000 });

        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
            throw new Error('no se pudo generar el archivo pdf recortado');
        }

        const baseName = originalFileName ? path.parse(originalFileName).name : 'documento';
        const customFileName = `${baseName}-p${pageList.replace(/,/g, '_')}.pdf`;

        await sendMedia(from, outputPath, `> páginas extraídas: \`${pageList}\``, false, false, null, customFileName);
    } catch (err) {
        logger.error('recortarpdf:', err.message);
        await sendText(from, `> error al recortar pdf \`${err.message}\``);
    } finally {
        cleanup(inputPath, outputPath);
    }
}

async function handlePdf2Img(parsed = {}, from, messageData = {}) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    if (!from) return;
    if (!isDocumentMessage(messageData)) {
        return sendText(from, '> adjunta un pdf\nusa `pdf2img`');
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let inputPath = null;
    const outputPrefix = path.join(TMP_DIR, `${sessionId}-out`);
    const zipPath = path.join(TMP_DIR, `${sessionId}.zip`);

    try {
        const { buffer, extension, originalFileName } = await downloadMedia(messageData);
        if (extension !== 'pdf') {
            return sendText(from, '> solo funciona con `pdf`');
        }

        inputPath = path.join(TMP_DIR, `${sessionId}-input.pdf`);
        fs.writeFileSync(inputPath, buffer);

        const safeParsed = (parsed && typeof parsed === 'object') ? parsed : {};
        const flags = safeParsed.flags || {};
        const args = Array.isArray(safeParsed.args) ? safeParsed.args : [];

        let paginas = (flags.pages || flags.p) || (args[0] && /^[0-9,-]+$/.test(args[0]) ? args[0] : null);
        let isZip = flags.zip === true;

        await sendText(from, '> extrayendo imagenes');

        let parts = paginas ? paginas.split(',') : ['all'];
        
        for (let part of parts) {
            let cmdPdf;
            if (part === 'all') {
                cmdPdf = `pdftoppm -jpeg "${inputPath}" "${outputPrefix}"`;
            } else if (part.includes('-')) {
                let [f, l] = part.split('-');
                if (!l) {
                    cmdPdf = `pdftoppm -jpeg -f ${f} "${inputPath}" "${outputPrefix}-${part}"`;
                } else {
                    cmdPdf = `pdftoppm -jpeg -f ${f} -l ${l} "${inputPath}" "${outputPrefix}-${part}"`;
                }
            } else {
                cmdPdf = `pdftoppm -jpeg -f ${part} -l ${part} "${inputPath}" "${outputPrefix}-${part}"`;
            }
            logger.cmd(cmdPdf);
            await execAsync(cmdPdf, { timeout: 120_000 });
        }

        const files = (fs.existsSync(TMP_DIR) ? fs.readdirSync(TMP_DIR) : [])
            .filter(f => f.startsWith(`${sessionId}-out`) && f.endsWith('.jpg'))
            .map(f => path.join(TMP_DIR, f));
        
        if (files.length === 0) throw new Error('no se generaron imagenes (revisa las paginas)');

        files.sort();

        if (isZip) {
            const cmdZip = `zip -j -q "${zipPath}" "${outputPrefix}"*.jpg`;
            logger.cmd(cmdZip);
            await execAsync(cmdZip, { timeout: 60_000 });
            if (!fs.existsSync(zipPath)) throw new Error('no se pudo generar el zip');
            let zipCustomName = null;
            if (originalFileName) {
                zipCustomName = `${path.parse(originalFileName).name}.zip`;
            }
            await sendMedia(from, zipPath, '> listo en zip', false, false, null, zipCustomName);
        } else {
            await sendText(from, `> enviando \`${files.length}\` imagenes`);
            const BATCH_SIZE = 3;
            for (let i = 0; i < files.length; i += BATCH_SIZE) {
                const batch = files.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map(file => sendMedia(from, file, '', false, true, 0)));
            }
        }
    } catch (err) {
        logger.error('pdf2img:', err.message);
        await sendText(from, 'No pude procesar el archivo. Revisa que abra correctamente y prueba de nuevo.');
    } finally {
        cleanup(inputPath, zipPath);
        if (outputPrefix) {
            try {
                const dir = path.dirname(outputPrefix);
                const base = path.basename(outputPrefix);
                if (fs.existsSync(dir)) {
                    for (const f of fs.readdirSync(dir)) {
                        if (f.startsWith(base) && f.endsWith('.jpg')) {
                            try { fs.unlinkSync(path.join(dir, f)); } catch {}
                        }
                    }
                }
            } catch {}
        }
    }
}

async function handleUnirPdf(parsed = {}, from, messageData = {}) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    if (!from) return;
    cleanExpiredSessions();
    const participant = messageData?.key?.participant || messageData?.participant || from;
    const sessionKey = getDocSessionKey(from, participant);
    const safeParsed = (parsed && typeof parsed === 'object') ? parsed : {};
    const flags = safeParsed.flags || {};
    const args = Array.isArray(safeParsed.args) ? safeParsed.args : [];

    const isTerminar = args[0] === 'terminar' || !!flags.terminar;
    const isCancelar = args[0] === 'cancelar' || !!flags.cancelar;

    if (isCancelar) {
        if (userPdfs.has(sessionKey)) {
            const session = userPdfs.get(sessionKey);
            userPdfs.delete(sessionKey);
            for (let i = 1; i <= session.count; i++) {
                cleanup(path.join(TMP_DIR, `${session.id}-part-${String(i).padStart(3, '0')}.pdf`));
            }
            return sendText(from, 'Listo, cancelé la unión de PDFs y vacié la lista.');
        }
        return sendText(from, '> no hay PDFs en cola para cancelar');
    }
    
    if (isTerminar) {
        if (!userPdfs.has(sessionKey)) return sendText(from, '> no hay pdfs en cola');
        
        const session = userPdfs.get(sessionKey);
        userPdfs.delete(sessionKey); // Limpiar

        const outputPath = path.join(TMP_DIR, `${session.id}-merged.pdf`);
        await sendText(from, `> uniendo \`${session.count}\` pdfs`);

        try {
            const files = [];
            for (let i = 1; i <= session.count; i++) {
                files.push(`"${path.join(TMP_DIR, `${session.id}-part-${String(i).padStart(3, '0')}.pdf`)}"`);
            }
            const cmd = `gs -q -dNOPAUSE -dBATCH -sDEVICE=pdfwrite -sOutputFile="${outputPath}" ${files.join(' ')}`;
            logger.cmd(cmd);
            await execAsync(cmd, { timeout: 120_000 });

            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                throw new Error('error al generar pdf final');
            }

            await sendMedia(from, outputPath, '> pdfs unidos');
        } catch(err) {
            logger.error('unirpdf:', err.message);
            await sendText(from, `> error al unir \`${err.message}\``);
        } finally {
            cleanup(outputPath);
            for (let i = 1; i <= session.count; i++) {
                cleanup(path.join(TMP_DIR, `${session.id}-part-${String(i).padStart(3, '0')}.pdf`));
            }
        }
        return;
    }

    if (!isDocumentMessage(messageData)) {
        return sendText(from, '> adjunta un pdf\ncuando termines manda `unir terminar`');
    }

    try {
        const { buffer, extension } = await downloadMedia(messageData);
        if (extension !== 'pdf') return sendText(from, '> solo admite `pdf`');

        let session;
        if (!userPdfs.has(sessionKey)) {
            session = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, count: 0, lastActive: Date.now() };
            userPdfs.set(sessionKey, session);
        } else {
            session = userPdfs.get(sessionKey);
            session.lastActive = Date.now();
        }

        session.count++;
        const partPath = path.join(TMP_DIR, `${session.id}-part-${String(session.count).padStart(3, '0')}.pdf`);
        fs.writeFileSync(partPath, buffer);

        await sendText(from, `> pdf \`${session.count}\` en cola\nenvia otro o manda \`unir terminar\``);

    } catch (err) {
        logger.error('unirpdf add:', err.message);
        await sendText(from, 'No pude procesar el archivo. Revisa que abra correctamente y prueba de nuevo.');
    }
}

module.exports = { handleDoc, handleComprimir, handlePdf2Img, handleUnirPdf, handleRecortarPdf, hasActiveSession };
