'use strict';

const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const { sendText, sendMedia, downloadMedia } = require('../services/evolution');
const { extractUrl } = require('../core/parser');
const logger = require('../services/logger');
const { Progress } = require('../services/progress');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';
fs.mkdirSync(TMP_DIR, { recursive: true });

// ─── Configuración de formatos ────────────────────────────────────────────────

const FORMAT_CONFIG = {
    mp3: { ext: 'mp3', args: '-c:a libmp3lame', type: 'audio' },
    m4a: { ext: 'm4a', args: '-c:a aac', type: 'audio' },
    ogg: { ext: 'ogg', args: '-c:a libvorbis', type: 'audio' },
    wav: { ext: 'wav', args: '-c:a pcm_s16le', type: 'audio' },
    opus: { ext: 'opus', args: '-c:a libopus', type: 'audio' },
    mp4: { ext: 'mp4', args: '-c:v libx264 -c:a aac -movflags faststart', type: 'video' },
    webm: { ext: 'webm', args: '-c:v libvpx-vp9 -c:a libopus', type: 'video' },
    avi: { ext: 'avi', args: '-c:v libxvid -c:a mp3', type: 'video' },
    gif: { ext: 'gif', args: '-vf "fps=10,scale=480:-1:flags=lanczos" -loop 0', type: 'image' },
    webp: { ext: 'webp', args: '-c:v libwebp -quality 85', type: 'image' },
};

const QUALITY_FLAGS = {
    alta: { video: '-crf 18', audio: '-q:a 0' },
    media: { video: '-crf 23', audio: '-q:a 4' },
    baja: { video: '-crf 30', audio: '-q:a 7' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanup(...files) {
    for (const f of files) {
        try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignorar */ }
    }
}

/**
 * Parsea un tiempo en formato HH:MM:SS o segundos a string para ffmpeg.
 */
function parseTime(val) {
    if (!val) return null;
    // Si es número o string numérico
    if (/^\d+$/.test(String(val))) return String(val);
    // Si ya tiene formato HH:MM:SS
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

// ─── Manejador principal ───────────────────────────────────────────────────────

/**
 * @param {object} parsed      - { command, flags, args }
 * @param {string} from        - JID del remitente
 * @param {object} messageData - Datos crudos del webhook
 */
async function handleConvertir({ flags, args }, from, messageData) {
    const p = new Progress(from);
    // ── Parámetros ──
    const format = (flags.f ?? flags.formato ?? '').toLowerCase();
    const quality = (flags.q ?? flags.calidad ?? 'media').toLowerCase();
    const timeIn = parseTime(flags.ss ?? flags.i ?? flags.inicio);
    const timeEnd = parseTime(flags.to ?? flags.e ?? flags.fin);
    const url = extractUrl(args);

    // Validar formato destino
    if (!format || !FORMAT_CONFIG[format]) {
        return p.fail(`formato inválido \`${format}\` · usa: ${Object.keys(FORMAT_CONFIG).join(' ')}`);
    }

    // Validar calidad
    if (!QUALITY_FLAGS[quality]) {
        return p.fail(`calidad inválida \`${quality}\` · usa: alta media baja`);
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const cfg = FORMAT_CONFIG[format];
    const outputPath = path.join(TMP_DIR, `${sessionId}-output.${cfg.ext}`);
    let inputPath = null;
    let filesToClean = [outputPath];

    try {
        // ── Obtener el archivo de entrada ──
        if (url) {
            // Desde URL: descargar primero
            await p.start('descargando', `para convertir a ${format}`);

            if (cfg.type === 'audio') {
                inputPath = path.join(TMP_DIR, `${sessionId}-input.mp3`);
                await downloadAudioFromUrl(url, inputPath.replace('.mp3', '.%(ext)s'));
                // Buscar archivo real generado
                inputPath = ['.mp3', '.m4a', '.ogg', '.wav'].map(e =>
                    path.join(TMP_DIR, `${sessionId}-input${e}`)
                ).find(p => fs.existsSync(p)) ?? inputPath;
            } else {
                inputPath = path.join(TMP_DIR, `${sessionId}-input.mp4`);
                await downloadVideoFromUrl(url, inputPath.replace('.mp4', '.%(ext)s'));
                inputPath = ['.mp4', '.mkv', '.webm'].map(e =>
                    path.join(TMP_DIR, `${sessionId}-input${e}`)
                ).find(p => fs.existsSync(p)) ?? inputPath;
            }

        } else if (messageData && (
            messageData.messageType?.includes('audio') ||
            messageData.messageType?.includes('video') ||
            messageData.messageType?.includes('document') ||
            messageData.messageType?.includes('image')
        )) {
            // Desde adjunto
            await p.start('convirtiendo', format);
            const { buffer, extension } = await downloadMedia(messageData);
            inputPath = path.join(TMP_DIR, `${sessionId}-input.${extension}`);
            fs.writeFileSync(inputPath, buffer);

        } else {
            return p.fail('no se encontró archivo · adjunta un archivo o pasa una url');
        }

        filesToClean.push(inputPath);

        if (!fs.existsSync(inputPath)) {
            throw new Error('no se pudo obtener el archivo de entrada');
        }

        // ── Construir comando ffmpeg ──
        const qualFlags = QUALITY_FLAGS[quality];
        const trimFlags = [
            timeIn ? `-ss ${timeIn}` : '',
            timeEnd ? `-to ${timeEnd}` : '',
        ].filter(Boolean).join(' ');

        // Para GIF, no tiene flags de calidad de audio/video normales
        const qualityArg = format === 'gif'
            ? ''
            : cfg.type === 'video'
                ? qualFlags.video
                : qualFlags.audio;

        const cmd = [
            'ffmpeg -y',
            trimFlags,
            `-i "${inputPath}"`,
            cfg.args,
            qualityArg,
            '-vn', // si es audio puro (se ignora para video/imagen)
            `-threads ${require('os').cpus().length}`,
            `"${outputPath}"`,
        ];

        // Para video o imagen, no incluir -vn
        const finalCmd = cfg.type !== 'audio'
            ? cmd.filter(c => c !== '-vn').join(' ')
            : cmd.join(' ');

        logger.cmd(finalCmd);


        await execAsync(finalCmd, { timeout: 15 * 60 * 1000, maxBuffer: 50 * 1024 * 1024 });

        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
            throw new Error('ffmpeg no generó el archivo de salida.');
        }

        const sizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
        logger.success(`Conversión lista: ${outputPath} (${sizeMB} MB)`);

        await p.done(`${sizeMB}mb`);
        const customFileName = (flags.name || flags.n) ? `${(flags.name || flags.n).replace(/\.[a-zA-Z0-9]+$/, '')}.${cfg.ext}` : null;
        await sendMedia(from, outputPath,
            `> listo \`${sizeMB}mb\``,
            false,
            false,
            null,
            customFileName
        );

    } catch (err) {
        logger.error('convertir:', err.message);

        let msg = err.message;
        if (err.message.includes('codec not found'))
            msg = `ffmpeg no tiene el codec para ${format}`;
        if (err.message.includes('Invalid data'))
            msg = 'el archivo de entrada no es válido o está corrupto';
        if (err.message.includes('supera el límite'))
            msg = err.message;

        await p.fail(msg);

    } finally {
        cleanup(...filesToClean);
    }
}

module.exports = { handleConvertir };
