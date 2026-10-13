'use strict';

const { cleanup } = require('../utils/cleanup');

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sendMedia, downloadMedia } = require('../services/evolution');
const { extractUrl } = require('../core/parser');
const logger = require('../services/logger');
const { Progress } = require('../services/progress');

const execFileAsync = promisify(execFile);

const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';
fs.mkdirSync(TMP_DIR, { recursive: true });

// ─── Configuración de formatos ────────────────────────────────────────────────

const FORMAT_CONFIG = {
    mp3: { ext: 'mp3', args: ['-c:a', 'libmp3lame'], type: 'audio' },
    m4a: { ext: 'm4a', args: ['-c:a', 'aac'], type: 'audio' },
    ogg: { ext: 'ogg', args: ['-c:a', 'libvorbis'], type: 'audio' },
    wav: { ext: 'wav', args: ['-c:a', 'pcm_s16le'], type: 'audio' },
    opus: { ext: 'opus', args: ['-c:a', 'libopus'], type: 'audio' },
    mp4: { ext: 'mp4', args: ['-c:v', 'libx264', '-c:a', 'aac', '-movflags', 'faststart'], type: 'video' },
    webm: { ext: 'webm', args: ['-c:v', 'libvpx-vp9', '-c:a', 'libopus'], type: 'video' },
    avi: { ext: 'avi', args: ['-c:v', 'libxvid', '-c:a', 'mp3'], type: 'video' },
    gif: { ext: 'gif', args: ['-vf', 'fps=10,scale=480:-1:flags=lanczos', '-loop', '0'], type: 'image' },
    webp: { ext: 'webp', args: ['-c:v', 'libwebp', '-quality', '85'], type: 'image' },
    pdf: { ext: 'pdf', args: [], type: 'document' },
};

const DOCUMENT_EXTENSIONS = ['docx', 'doc', 'pptx', 'xlsx', 'odt'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

const QUALITY_FLAGS = {
    alta: { video: ['-crf', '18'], audio: ['-q:a', '0'] },
    media: { video: ['-crf', '23'], audio: ['-q:a', '4'] },
    baja: { video: ['-crf', '30'], audio: ['-q:a', '7'] },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convierte un documento de oficina a PDF usando LibreOffice
 */
async function convertDocumentToPdf(inputPath, outputPath) {
    await execFileAsync('soffice', [
        '--headless',
        '--convert-to', 'pdf',
        '--outdir', path.dirname(outputPath),
        inputPath
    ], { timeout: 5 * 60 * 1000 });

    // Renombrar el archivo generado si no coincide con outputPath
    const generatedPdf = path.join(path.dirname(outputPath), path.basename(inputPath, path.extname(inputPath)) + '.pdf');
    if (fs.existsSync(generatedPdf) && generatedPdf !== outputPath) {
        fs.renameSync(generatedPdf, outputPath);
    }
}

/**
 * Convierte una imagen a PDF usando ImageMagick
 */
async function convertImageToPdf(inputPath, outputPath) {
    await execFileAsync('convert', [inputPath, outputPath], { timeout: 2 * 60 * 1000 });
}

/**
 * Parsea un tiempo en formato HH:MM:SS o segundos a string para ffmpeg.
 */
function parseTime(val) {
    if (!val) return null;
    if (/^\d+$/.test(String(val))) return String(val);
    if (/^\d+:\d{2}(:\d{2})?$/.test(String(val))) return String(val);
    return null;
}

/**
 * Descarga solo audio de una URL usando yt-dlp.
 */
async function downloadAudioFromUrl(url, outputPath) {
    const args = [
        '--no-playlist',
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '5',
        '-o', outputPath,
        url
    ];
    await execFileAsync('yt-dlp', args, { timeout: 5 * 60 * 1000, maxBuffer: 50 * 1024 * 1024 });
}

/**
 * Descarga video de una URL usando yt-dlp.
 */
async function downloadVideoFromUrl(url, outputPath) {
    const args = [
        '--no-playlist',
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '-o', outputPath,
        url
    ];
    await execFileAsync('yt-dlp', args, { timeout: 10 * 60 * 1000, maxBuffer: 50 * 1024 * 1024 });
}

// Parámetros compartidos por adjuntos y enlaces: nunca ignorar una petición.
function parseSpeed(value) {
    if (value == null) return 1;
    const normalized = String(value).trim().replace(/x$/i, '');
    if (!/^\d+(?:[.,]\d+)?$/.test(normalized)) return null;
    const speed = Number(normalized.replace(',', '.'));
    return Number.isFinite(speed) && speed >= 0.25 && speed <= 4 ? speed : null;
}

function parseBitrate(value) {
    if (value == null) return null;
    const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*([km])?(?:b(?:ps|\/s)?)?$/i);
    if (!match) return NaN;
    const bits = Number(match[1]) * ({ k: 1000, m: 1000000 }[String(match[2] || '').toLowerCase()] || 1);
    return Number.isSafeInteger(bits) && bits > 0 ? bits : NaN;
}

function audioTempoFilter(speed) {
    const factors = [];
    while (speed > 2) { factors.push(2); speed /= 2; }
    while (speed < 0.5) { factors.push(0.5); speed /= 0.5; }
    factors.push(speed);
    return factors.map(factor => `atempo=${factor}`).join(',');
}

function buildFfmpegArgs({ inputPath, outputPath, format, quality, timeIn, timeEnd, speed, bitrate }) {
    const cfg = FORMAT_CONFIG[format];
    const ffmpegArgs = ['-y'];
    if (timeIn) ffmpegArgs.push('-ss', timeIn);
    if (timeEnd) ffmpegArgs.push('-to', timeEnd);
    ffmpegArgs.push('-i', inputPath);
    const codecArgs = [...cfg.args];
    if (speed !== 1 && format === 'gif') {
        const filterIndex = codecArgs.indexOf('-vf');
        codecArgs[filterIndex + 1] = `setpts=(PTS-STARTPTS)/${speed},${codecArgs[filterIndex + 1]}`;
    }
    ffmpegArgs.push(...codecArgs);
    if (cfg.type === 'audio' || cfg.type === 'video') {
        if (bitrate != null) ffmpegArgs.push(cfg.type === 'audio' ? '-b:a' : '-b:v', String(bitrate));
        else ffmpegArgs.push(...QUALITY_FLAGS[quality][cfg.type]);
        if (speed !== 1) {
            if (cfg.type === 'video') ffmpegArgs.push('-vf', `setpts=(PTS-STARTPTS)/${speed}`);
            ffmpegArgs.push('-af', audioTempoFilter(speed));
        }
    }
    if (cfg.type === 'audio') ffmpegArgs.push('-vn');
    ffmpegArgs.push('-threads', String(Math.min(os.cpus()?.length || 2, 8)), outputPath);
    return ffmpegArgs;
}

async function handleConvertir(parsed = {}, from, messageData = {}) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    if (!from) return;
    const flags = parsed?.flags || {};
    const args = Array.isArray(parsed?.args) ? parsed.args : [];
    const p = new Progress(from, messageData?.key);
    const format = String(flags.f ?? flags.formato ?? flags.format ?? 'mp3').toLowerCase();
    const quality = String(flags.q ?? flags.calidad ?? 'media').toLowerCase();
    const speed = parseSpeed(flags.speed ?? flags.v ?? flags.velocidad);
    const bitrateValue = flags.bitrate ?? flags.b;
    const bitrate = parseBitrate(bitrateValue);
    const timeIn = parseTime(flags.ss ?? flags.i ?? flags.inicio);
    const timeEnd = parseTime(flags.to ?? flags.e ?? flags.fin);
    const url = extractUrl(args);
    const cfg = FORMAT_CONFIG[format];

    if (!cfg) return p.fail(`Ese formato no lo manejo. Usa: ${Object.keys(FORMAT_CONFIG).join(', ')}.`);
    if (!QUALITY_FLAGS[quality]) return p.fail('La calidad puede ser alta, media o baja.');
    if (speed == null) return p.fail('La velocidad debe estar entre 0.25x y 4x. Por ejemplo: 1.5x.');
    if (speed !== 1 && !['audio', 'video'].includes(cfg.type) && format !== 'gif') {
        return p.fail('La velocidad aplica a audio, video o GIF. ¿A qué formato lo convierto?');
    }
    if (bitrateValue != null) {
        if (!['audio', 'video'].includes(cfg.type) || format === 'wav') {
            return p.fail('Ese formato no permite elegir bitrate. Para audio usa MP3, M4A, OGG u OPUS; para video, MP4, WEBM o AVI.');
        }
        const [minimum, maximum] = cfg.type === 'audio' ? [8000, 512000] : [32000, 100000000];
        if (!Number.isFinite(bitrate) || bitrate < minimum || bitrate > maximum) {
            return p.fail(cfg.type === 'audio'
                ? 'Para audio, dime un bitrate entre 8k y 512k. Por ejemplo: 128k.'
                : 'Para video, dime un bitrate entre 32k y 100M. Por ejemplo: 2M.');
        }
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const outputPath = path.join(TMP_DIR, `${sessionId}-output.${cfg.ext}`);
    let inputPath;
    let extension;
    const filesToClean = [outputPath];
    try {
        if (url) {
            if (format === 'pdf') return p.fail('Para crear un PDF, mándame una imagen o un documento.');
            await p.start('descargando', `para convertir a ${format}`);
            const extensions = cfg.type === 'audio' ? ['mp3', 'm4a', 'ogg', 'wav'] : ['mp4', 'mkv', 'webm'];
            const candidates = extensions.map(ext => path.join(TMP_DIR, `${sessionId}-input.${ext}`));
            filesToClean.push(...candidates);
            const download = cfg.type === 'audio' ? downloadAudioFromUrl : downloadVideoFromUrl;
            await download(url, path.join(TMP_DIR, `${sessionId}-input.%(ext)s`));
            inputPath = candidates.find(file => fs.existsSync(file));
            if (!inputPath) throw new Error('No se pudo descargar el archivo de entrada.');
            extension = path.extname(inputPath).slice(1);
        } else if (messageData && (
            /audio|video|document|image/i.test(messageData.messageType || '') ||
            messageData.quotedStanzaId ||
            messageData.message?.extendedTextMessage?.contextInfo?.quotedMessage
        )) {
            await p.start('convirtiendo', format);
            const media = await downloadMedia(messageData);
            extension = String(media.extension || '').replace(/^\./, '').toLowerCase();
            if (!/^[a-z0-9]+$/.test(extension)) throw new Error('No pude reconocer el formato del archivo.');
            inputPath = path.join(TMP_DIR, `${sessionId}-input.${extension}`);
            filesToClean.push(inputPath);
            fs.writeFileSync(inputPath, media.buffer);
        } else {
            return p.fail('Mándame el archivo o su enlace y dime a qué formato lo quieres.');
        }

        // Ambos orígenes pasan por la misma conversión y respetan sus parámetros.
        if (DOCUMENT_EXTENSIONS.includes(extension) && format === 'pdf') {
            await convertDocumentToPdf(inputPath, outputPath);
        } else if (IMAGE_EXTENSIONS.includes(extension) && format === 'pdf') {
            await convertImageToPdf(inputPath, outputPath);
        } else if (format === 'pdf') {
            return p.fail('Para crear un PDF, mándame una imagen o un documento de oficina.');
        } else {
            const ffmpegArgs = buildFfmpegArgs({ inputPath, outputPath, format, quality, timeIn, timeEnd, speed, bitrate });
            logger.cmd(`ffmpeg ${ffmpegArgs.join(' ')}`);
            await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 15 * 60 * 1000, maxBuffer: 50 * 1024 * 1024 });
        }

        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
            throw new Error('No se pudo generar el archivo de salida.');
        }
        const sizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
        const name = flags.name || flags.n;
        const customFileName = name ? `${String(name).replace(/\.[a-zA-Z0-9]+$/, '')}.${cfg.ext}` : null;
        await sendMedia(from, outputPath, `Listo, aquí tienes tu ${format.toUpperCase()} (${sizeMB} MB).`, false, false, null, customFileName);
        await p.done(`${sizeMB} MB`);
        return { success: true, formato: format, velocidad: speed, bitrate, enviado_al_chat: true };
    } catch (err) {
        logger.error('convertir:', err.message);
        let msg = 'No pude convertirlo. Prueba con otro archivo o formato.';
        if (err.message.includes('codec not found')) msg = `Ese formato (${format}) no está disponible ahorita. Prueba con otro.`;
        if (err.message.includes('Invalid data')) msg = 'No pude leer ese archivo. Revisa que abra y vuelve a mandarlo.';
        if (err.message.includes('supera el límite')) msg = err.message;
        await p.fail(msg);
        return { success: false, error: msg, enviado_al_chat: true };
    } finally {
        // Incluye descargas parciales y archivos auxiliares de yt-dlp/LibreOffice.
        try {
            filesToClean.push(...fs.readdirSync(TMP_DIR)
                .filter(name => name.startsWith(`${sessionId}-`))
                .map(name => path.join(TMP_DIR, name)));
        } catch { /* la limpieza principal sigue disponible */ }
        cleanup(...filesToClean);
    }
}

module.exports = { handleConvertir, parseSpeed, parseBitrate, audioTempoFilter, buildFfmpegArgs };
