'use strict';

const { cleanup } = require('../utils/cleanup');

const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const { sendText, sendSticker, sendAnimatedSticker, downloadMedia } = require('../services/evolution');
const { extractUrl } = require('../core/parser');
const logger = require('../services/logger');
const webpmux = require('node-webpmux');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';
fs.mkdirSync(TMP_DIR, { recursive: true });

// Formatos de imagen/GIF soportados
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.webm']);

// ─── Helpers ──────────────────────────────────────────────────────────────────



/**
 * Añade metadatos EXIF al WebP para que WhatsApp lo reconozca como un Sticker válido.
 * Esto es obligatorio para que los stickers animados funcionen correctamente y no se pongan estáticos.
 */
async function addExifMetadata(webpPath, packname = 'Bot', author = 'Azael') {
    const img = new webpmux.Image();
    await img.load(webpPath);
    
    const json = {
        "sticker-pack-id": "",
        "sticker-pack-name": "",
        "sticker-pack-publisher": "",
        "emojis": []
    };
    
    const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
    const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
    const exif = Buffer.concat([exifAttr, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);
    
    img.exif = exif;
    await img.save(webpPath);
}

/**
 * Descarga un archivo desde una URL y lo guarda en disco.
 */
function downloadFromUrl(url, destPath) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(destPath);

        file.on('error', (err) => {
            file.destroy();
            fs.unlink(destPath, () => {});
            reject(err);
        });

        proto.get(url, (res) => {
            if (res.statusCode !== 200) {
                file.destroy();
                fs.unlink(destPath, () => {});
                reject(new Error(`HTTP ${res.statusCode} al descargar imagen.`));
                return;
            }
            res.pipe(file);
            file.on('finish', () => { file.close(() => resolve()); });
        }).on('error', (err) => {
            file.destroy();
            fs.unlink(destPath, () => { });
            reject(err);
        });
    });
}

/**
 * Detecta si el archivo de entrada es un GIF animado o video.
 */
async function isAnimated(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (VIDEO_EXTENSIONS.has(ext)) return true;
    if (ext !== '.gif') return false;

    // Verificar si el GIF tiene más de 1 frame
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=nb_frames',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            filePath,
        ]);
        return parseInt(stdout.trim(), 10) > 1;
    } catch {
        return false;
    }
}

/**
 * Convierte imagen estática a WebP estático 512x512 para sticker.
 * Mantiene transparencia si la tiene (PNG/WebP).
 */
async function convertToStaticSticker(inputPath, outputPath, cropMode) {
    const scaleFilter = cropMode
        // Crop: escala para que el lado menor sea 512 y recorta al centro
        ? 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512'
        // Adaptar a la foto (mantiene relación de aspecto con lado máximo de 512 y dimensiones pares para evitar errores)
        : "scale='if(gt(iw,ih),512,-2)':'if(gt(iw,ih),-2,512)'";

    const args = [
        '-y',
        '-i', inputPath,
        '-vf', scaleFilter,
        '-c:v', 'libwebp',
        '-quality', '90',
        '-lossless', '0',
        '-frames:v', '1',
        outputPath,
    ];

    logger.cmd(`ffmpeg ${args.join(' ')}`);
    await execFileAsync('ffmpeg', args, { timeout: 30_000 });
}

/**
 * Convierte GIF o video corto a WebP animado para sticker.
 */
async function convertToAnimatedSticker(inputPath, outputPath, cropMode) {
    const scaleFilter = cropMode
        ? 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512'
        : 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000';

    const tmpGif = outputPath.replace('.webp', '.gif');

    // 1. Convertir a GIF temporal con dimensiones exactas
    const ffmpegArgs = [
        '-y',
        '-t', '6',
        '-i', inputPath,
        '-vf', `fps=10,${scaleFilter},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
        '-loop', '0',
        tmpGif,
    ];

    logger.cmd(`ffmpeg ${ffmpegArgs.join(' ')}`);
    await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 60_000 });

    // 2. Convertir el GIF a WebP oficial animado
    const gif2webpArgs = [
        tmpGif,
        '-lossy',
        '-q', '30',
        '-m', '3',
        '-mt',
        '-min_size',
        '-o', outputPath
    ];

    logger.cmd(`gif2webp ${gif2webpArgs.join(' ')}`);
    await execFileAsync('gif2webp', gif2webpArgs, { timeout: 60_000 });
    
    // Limpieza del archivo temporal
    try { fs.unlinkSync(tmpGif); } catch { /* ignorar */ }
}

// ─── Manejador principal ───────────────────────────────────────────────────────

/**
 * @param {object} parsed      - { command, flags, args }
 * @param {string} from        - JID del remitente
 * @param {object} messageData - Datos crudos del webhook
 */
async function handleSticker(parsed = {}, from, messageData = {}) {
    if (!from) return;
    const safeParsed = parsed || {};
    const flags = safeParsed.flags || {};
    const args = Array.isArray(safeParsed.args) ? safeParsed.args : [];
    const cropMode = !!(flags.r ?? flags.recortar);
    const forceAnimated = !!(flags.a ?? flags.animado);
    const url = extractUrl(args);

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const inputExt = url ? path.extname(new URL(url).pathname).toLowerCase() || '.jpg' : '.tmp';
    let inputPath = path.join(TMP_DIR, `${sessionId}-input${inputExt}`);
    const outputPath = path.join(TMP_DIR, `${sessionId}-sticker.webp`);

    try {
        // ── Obtener la imagen: desde URL o desde adjunto ──
        if (url) {
            await downloadFromUrl(url, inputPath);

        } else if (
            messageData?.messageType?.toLowerCase().includes('image') ||
            messageData?.messageType?.toLowerCase().includes('video')
        ) {
            const { buffer, extension } = await downloadMedia(messageData);
            inputPath = inputPath.replace('.tmp', `.${extension}`);
            fs.writeFileSync(inputPath, buffer);

            let animated = await isAnimated(inputPath);
            // Si piden animado pero la foto es un simple JPG estático, ignorar el flag para evitar crash en ffmpeg
            if (forceAnimated && !animated) {
                // Solo permitimos forzar 'animado' si es un .gif o .mp4. Si es .jpg/.png, fallaría.
                const ext = path.extname(inputPath).toLowerCase();
                if (ext === '.gif' || ext === '.mp4') animated = true;
            }
            if (animated) {
                await convertToAnimatedSticker(inputPath, outputPath, cropMode);
                if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                    throw new Error('ffmpeg no generó el sticker. Verifica que el archivo de entrada sea válido.');
                }
                await addExifMetadata(outputPath);
                await sendAnimatedSticker(from, outputPath);
            } else {
                await convertToStaticSticker(inputPath, outputPath, cropMode);
                if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                    throw new Error('ffmpeg no generó el sticker. Verifica que el archivo de entrada sea válido.');
                }
                await addExifMetadata(outputPath);
                await sendSticker(from, outputPath);
            }
            return;

        } else {
            return sendText(from,
                '> no se encontro imagen\nenvia una imagen con `/@ sticker`\no pasa una url: `/@ sticker [url]`'
            );
        }

        // ── Convertir (cuando viene de URL) ──
        let animated = await isAnimated(inputPath);
        if (forceAnimated && !animated) {
            const ext = path.extname(inputPath).toLowerCase();
            if (ext === '.gif' || ext === '.mp4') animated = true;
        }

        if (animated) {
            await convertToAnimatedSticker(inputPath, outputPath, cropMode);
            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                throw new Error('ffmpeg no generó el sticker. Verifica que el archivo de entrada sea válido.');
            }
            await addExifMetadata(outputPath);
            await sendAnimatedSticker(from, outputPath);
        } else {
            await convertToStaticSticker(inputPath, outputPath, cropMode);
            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                throw new Error('ffmpeg no generó el sticker. Verifica que el archivo de entrada sea válido.');
            }
            await addExifMetadata(outputPath);
            await sendSticker(from, outputPath);
        }

    } catch (err) {
        logger.error('sticker:', err.message);

        let msg = `> error \`${err.message}\``;
        if (err.message.includes('libwebp'))
            msg = '> ffmpeg no tiene soporte webp';
        if (err.message.includes('HTTP 404'))
            msg = '> url no existe';
        if (err.message.includes('Invalid data'))
            msg = '> archivo no valido';
        if (err.message.includes('expiró') || err.message.includes('descargar'))
            msg = `> ${err.message}`;

        await sendText(from, msg);

    } finally {
        cleanup(inputPath, outputPath);
    }
}

module.exports = { handleSticker };
