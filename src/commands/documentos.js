'use strict';

const fs = require('fs');
const path = require('path');
const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const { sendText, sendMedia, downloadMedia } = require('../services/evolution');
const logger = require('../services/logger');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';

function cleanup(...files) {
    for (const f of files) {
        try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignorar */ }
    }
}

const userPdfs = new Map(); // from -> { id, count, lastActive }
const userImagePdfs = new Map(); // from -> { id, files: [], lastActive }

// Limpiar sesiones inactivas de más de 20 minutos
function cleanExpiredSessions() {
    const now = Date.now();
    const timeout = 20 * 60 * 1000; // 20 minutos
    for (const [from, session] of userImagePdfs.entries()) {
        if (now - session.lastActive > timeout) {
            for (const file of session.files) {
                cleanup(file);
            }
            userImagePdfs.delete(from);
            logger.info(`Sesión de imágenes PDF expirada y limpiada para ${from}`);
        }
    }
    for (const [from, session] of userPdfs.entries()) {
        if (now - session.lastActive > timeout) {
            for (let i = 1; i <= session.count; i++) {
                cleanup(path.join(TMP_DIR, `${session.id}-part-${String(i).padStart(3, '0')}.pdf`));
            }
            userPdfs.delete(from);
            logger.info(`Sesión de unión de PDFs expirada y limpiada para ${from}`);
        }
    }
}

function hasActiveSession(from) {
    if (userImagePdfs.has(from)) {
        return 'pdf';
    }
    if (userPdfs.has(from)) {
        return 'unir';
    }
    return null;
}

async function handleDoc(parsed, from, messageData) {
    cleanExpiredSessions();

    const isTerminar = parsed.args[0] === 'terminar' || parsed.flags.terminar;
    const isCancelar = parsed.args[0] === 'cancelar' || parsed.flags.cancelar;

    if (isTerminar) {
        if (!userImagePdfs.has(from)) {
            return sendText(from, '> no hay imágenes en cola para generar un PDF');
        }

        const session = userImagePdfs.get(from);
        userImagePdfs.delete(from);

        if (session.files.length === 0) {
            return sendText(from, '> no se agregaron imágenes a la cola');
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

            await sendMedia(from, outputPath, '> PDF generado con éxito', false, false, null, `imagenes-${Date.now()}.pdf`);
        } catch (err) {
            logger.error('doc merge:', err.message);
            await sendText(from, `> error al generar PDF \`${err.message}\``);
        } finally {
            cleanup(outputPath);
            for (const file of session.files) {
                cleanup(file);
            }
        }
        return;
    }

    if (isCancelar) {
        if (userImagePdfs.has(from)) {
            const session = userImagePdfs.get(from);
            userImagePdfs.delete(from);
            for (const file of session.files) {
                cleanup(file);
            }
            return sendText(from, '> cola de imágenes vaciada y proceso cancelado');
        }
        return sendText(from, '> no hay imágenes en cola para cancelar');
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
            if (!userImagePdfs.has(from)) {
                const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                userImagePdfs.set(from, { id: sessionId, files: [], lastActive: Date.now() });
                return sendText(from, '> 📂 Cola de PDF iniciada. Envía las imágenes que deseas agregar y escribe `/@ pdf terminar` al finalizar.');
            } else {
                const session = userImagePdfs.get(from);
                return sendText(from, `> Ya tienes una cola activa con \`${session.files.length}\` imágenes. Envía más o escribe \`/@ pdf terminar\` para finalizar.`);
            }
        }
        return sendText(from, '> adjunta un documento o imagen\nusa `/@ doc -f [formato]`');
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
            if (!userImagePdfs.has(from)) {
                session = { id: sessionId, files: [], lastActive: Date.now() };
                userImagePdfs.set(from, session);
            } else {
                session = userImagePdfs.get(from);
                session.lastActive = Date.now();
            }

            const imgIndex = session.files.length + 1;
            const imgPath = path.join(TMP_DIR, `${session.id}-img-${String(imgIndex).padStart(3, '0')}.${extension}`);
            fs.writeFileSync(imgPath, buffer);
            session.files.push(imgPath);

            await sendText(from, `> imagen \`${imgIndex}\` en cola\nenvia otra o manda \`/@ pdf terminar\` para generar el PDF`);
        } else {
            // Mensaje eliminado
            const { buffer, extension, originalFileName } = await downloadMedia(messageData);
            inputPath = path.join(TMP_DIR, `${sessionId}-input.${extension}`);
            fs.writeFileSync(inputPath, buffer);

            if (extension === format) {
                cleanup(inputPath);
                return sendText(from, `> el archivo ya es \`${format}\``);
            }

            // Mensaje eliminado

            outputPath = path.join(TMP_DIR, `${sessionId}-input.${format}`);

            let infilter = '';
            if (extension === 'pdf') {
                if (['docx', 'doc', 'odt'].includes(format)) infilter = '--infilter="writer_pdf_import"';
                else if (['pptx', 'ppt', 'odp'].includes(format)) infilter = '--infilter="impress_pdf_import"';
                else if (['xlsx', 'xls', 'ods'].includes(format)) {
                     cleanup(inputPath);
                     return sendText(from, '> no se puede convertir de pdf a excel directamente');
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
        await sendText(from, `> error \`${err.message}\``);
    } finally {
        cleanup(inputPath, outputPath);
    }
}

async function handleComprimir(parsed, from, messageData) {
    if (!messageData?.messageType?.includes('document')) {
        return sendText(from, '> adjunta un pdf para comprimir');
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let inputPath = null;
    let outputPath = null;

    try {
        const { buffer, extension, originalFileName } = await downloadMedia(messageData);
        const msg = messageData?.message;
        const mimeType = msg?.documentMessage?.mimetype || msg?.documentWithCaptionMessage?.message?.documentMessage?.mimetype;

        if (extension !== 'pdf' || mimeType !== 'application/pdf') {
            return sendText(from, '> solo funciona con archivos `pdf` reales');
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
        await sendText(from, `> error \`${err.message}\``);
    } finally {
        cleanup(inputPath, outputPath);
    }
}

async function handlePdf2Img(parsed, from, messageData) {
    if (!messageData?.messageType?.includes('document')) {
        return sendText(from, '> adjunta un pdf\nusa `/@ pdf2img`');
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

        let paginas = (parsed.flags.pages || parsed.flags.p) || (parsed.args[0] && /^[0-9,-]+$/.test(parsed.args[0]) ? parsed.args[0] : null);
        let isZip = parsed.flags.zip === true;

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

        const files = fs.readdirSync(TMP_DIR).filter(f => f.startsWith(`${sessionId}-out`) && f.endsWith('.jpg')).map(f => path.join(TMP_DIR, f));
        
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
        await sendText(from, `> error \`${err.message}\``);
    } finally {
        cleanup(inputPath, zipPath);
        try { exec(`rm -f "${outputPrefix}"*.jpg`); } catch { }
    }
}

async function handleUnirPdf(parsed, from, messageData) {
    cleanExpiredSessions();

    const isTerminar = parsed.args[0] === 'terminar' || parsed.flags.terminar;
    const isCancelar = parsed.args[0] === 'cancelar' || parsed.flags.cancelar;

    if (isCancelar) {
        if (userPdfs.has(from)) {
            const session = userPdfs.get(from);
            userPdfs.delete(from);
            for (let i = 1; i <= session.count; i++) {
                cleanup(path.join(TMP_DIR, `${session.id}-part-${String(i).padStart(3, '0')}.pdf`));
            }
            return sendText(from, '> cola de PDFs vaciada y proceso cancelado');
        }
        return sendText(from, '> no hay PDFs en cola para cancelar');
    }
    
    if (isTerminar) {
        if (!userPdfs.has(from)) return sendText(from, '> no hay pdfs en cola');
        
        const session = userPdfs.get(from);
        userPdfs.delete(from); // Limpiar

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

    if (!messageData?.messageType?.includes('document')) {
        return sendText(from, '> adjunta un pdf\ncuando termines manda `/@ unir terminar`');
    }

    try {
        const { buffer, extension } = await downloadMedia(messageData);
        if (extension !== 'pdf') return sendText(from, '> solo admite `pdf`');

        let session;
        if (!userPdfs.has(from)) {
            session = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, count: 0, lastActive: Date.now() };
            userPdfs.set(from, session);
        } else {
            session = userPdfs.get(from);
            session.lastActive = Date.now();
        }

        session.count++;
        const partPath = path.join(TMP_DIR, `${session.id}-part-${String(session.count).padStart(3, '0')}.pdf`);
        fs.writeFileSync(partPath, buffer);

        await sendText(from, `> pdf \`${session.count}\` en cola\nenvia otro o manda \`/@ unir terminar\``);

    } catch (err) {
        logger.error('unirpdf add:', err.message);
        await sendText(from, `> error \`${err.message}\``);
    }
}

module.exports = { handleDoc, handleComprimir, handlePdf2Img, handleUnirPdf, hasActiveSession };
