'use strict';

const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const { sendText, downloadMedia } = require('../services/evolution');
const { extractUrl } = require('../core/parser');
const logger = require('../services/logger');
const { Progress } = require('../services/progress');

const execFileAsync = promisify(execFile);

const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';
const DEFAULT_MODEL = process.env.WHISPER_MODEL ?? 'small';
const DEFAULT_LANG = process.env.WHISPER_LANGUAGE ?? 'auto';

// Ruta al script de Python (relativa a este archivo)
const TRANSCRIBE_SCRIPT = path.resolve(__dirname, '../scripts/transcribe.py');

fs.mkdirSync(TMP_DIR, { recursive: true });

// ─── Validaciones ──────────────────────────────────────────────────────────────

// faster-whisper soporta los mismos modelos que whisper original + large-v2/v3
const VALID_MODELS = new Set([
    'tiny', 'tiny.en',
    'base', 'base.en',
    'small', 'small.en',
    'medium', 'medium.en',
    'large-v1', 'large-v2', 'large-v3',
    'large',   // alias de large-v3
]);

const VALID_LANGS = new Set([
    'auto', 'es', 'en', 'fr', 'de', 'pt', 'it',
    'zh', 'ja', 'ko', 'ru', 'ar', 'nl', 'pl', 'tr',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanup(...files) {
    for (const f of files) {
        try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignorar */ }
    }
}

/**
 * Descarga el audio de una URL con yt-dlp.
 */
async function downloadAudioFromUrl(url, outputTemplate) {
    const args = [
        '--no-playlist',
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '5',
        '-o', outputTemplate,
        url,
    ];
    logger.cmd(`yt-dlp ${args.join(' ')}`);
    await execFileAsync('yt-dlp', args, { timeout: 5 * 60 * 1000, maxBuffer: 50 * 1024 * 1024 });
}

/**
 * Divide texto largo en fragmentos para no superar el límite de WhatsApp.
 */
function splitText(text, maxLength = 3500) {
    const parts = [];
    let start = 0;

    while (start < text.length) {
        let end = Math.min(start + maxLength, text.length);
        if (end < text.length) {
            const lastBreak = text.lastIndexOf('\n', end);
            if (lastBreak > start) end = lastBreak + 1;
        }
        parts.push(text.slice(start, end).trim());
        start = end;
    }

    return parts.filter(Boolean);
}

/**
 * Llama al script Python con faster-whisper y retorna el texto transcrito.
 * stdout → texto transcrito
 * stderr → logs internos de Python (no interfieren)
 *
 * @param {string} audioPath - Ruta al archivo de audio
 * @param {string} model     - Modelo de whisper
 * @param {string} lang      - Idioma o 'auto'
 * @returns {Promise<string>}
 */
async function runFasterWhisper(audioPath, model, lang) {
    const args = [TRANSCRIBE_SCRIPT, audioPath, model, lang];
    logger.cmd(`python3 ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
        const proc = spawn('python3', args, {
            timeout: 15 * 60 * 1000,
            env: {
                ...process.env,
                WHISPER_DEVICE: process.env.WHISPER_DEVICE ?? 'cpu',
                WHISPER_COMPUTE_TYPE: process.env.WHISPER_COMPUTE_TYPE ?? 'int8',
                WHISPER_CACHE_DIR: process.env.WHISPER_CACHE_DIR ?? '',
            },
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', chunk => { stdout += chunk; });
        proc.stderr.on('data', chunk => { stderr += chunk; });

        // Matar el proceso y todos sus hijos si se excede el timeout
        const timer = setTimeout(() => {
            proc.kill('SIGKILL');
            reject(new Error('timeout: la transcripción tardó demasiado'));
        }, 15 * 60 * 1000);

        proc.on('close', (code) => {
            clearTimeout(timer);

            if (stderr.trim()) logger.info('[faster-whisper]', stderr.trim());

            // Código 3 = sin voz detectada (definido en el script Python)
            if (code === 3) return resolve('');

            if (code !== 0) {
                const detail = stderr.trim();
                return reject(new Error(detail || `python3 salió con código ${code}`));
            }

            resolve(stdout.trim());
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

// ─── Enviar transcripción al usuario (soporte para textos largos) ─────────────

async function sendTranscription(from, text, model) {
    if (!text) {
        await sendText(from, '> no se detecto voz');
        return null;
    }

    const parts = splitText(text);

    if (parts.length === 1) {
        const msg = `> transcripcion \`${model}\`\n\n${parts[0]}`;
        await sendText(from, msg);
        return msg;
    } else {
        await sendText(from, `> transcripcion \`${model}\` en ${parts.length} partes`);
        for (let i = 0; i < parts.length; i++) {
            await sendText(from, `> parte ${i + 1}/${parts.length}\n${parts[i]}`);
        }
        // Retornar el texto completo para el historial de la IA
        return text.slice(0, 400);
    }
}

// ─── Manejador principal ───────────────────────────────────────────────────────

/**
 * @param {object} parsed      - { command, flags, args }
 * @param {string} from        - JID del remitente
 * @param {object} messageData - Datos crudos del webhook
 */
async function handleTranscribir({ flags, args }, from, messageData) {
    const p = new Progress(from);
    // ── Parámetros ──
    const model = (flags.m ?? flags.modelo ?? DEFAULT_MODEL).toLowerCase();
    const lang = (flags.l ?? flags.idioma ?? DEFAULT_LANG).toLowerCase();
    const url = extractUrl(args);

    if (!VALID_MODELS.has(model)) {
        return p.fail(`modelo inválido \`${model}\` · usa: tiny base small medium large`);
    }

    if (!VALID_LANGS.has(lang)) {
        return p.fail(`idioma inválido \`${lang}\` · usa: ${[...VALID_LANGS].join(' ')}`);
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const audioPath = path.join(TMP_DIR, `${sessionId}.mp3`);
    let filesToClean = [audioPath];

    try {
        // ═══════════════════════════════════════════
        //  MODO 1: URL
        // ═══════════════════════════════════════════
        if (url) {
            await p.start('descargando', `audio · ${model} · ${lang}`);

            await downloadAudioFromUrl(url, audioPath.replace('.mp3', '.%(ext)s'));

            // yt-dlp puede cambiar la extensión del archivo generado
            const actualFile = ['.mp3', '.m4a', '.ogg', '.wav', '.opus', '.webm']
                .map(ext => audioPath.replace('.mp3', ext))
                .find(p => fs.existsSync(p));

            if (!actualFile) {
                throw new Error('No se pudo descargar el audio de la URL proporcionada.');
            }

            filesToClean = [actualFile];
            await p.phase('transcribiendo', model);

            const text = await runFasterWhisper(actualFile, model, lang);
            await p.done(model);
            return await sendTranscription(from, text, model);

            // ═══════════════════════════════════════════
            //  MODO 2: Nota de voz o archivo de audio adjunto
            // ═══════════════════════════════════════════
        } else if (
            messageData?.messageType?.toLowerCase().includes('audio') ||
            messageData?.message?.audioMessage
        ) {
            await p.start('transcribiendo', `${model} · ${lang}`);

            const { buffer } = await downloadMedia(messageData);
            fs.writeFileSync(audioPath, buffer);
            filesToClean = [audioPath];

            const text = await runFasterWhisper(audioPath, model, lang);
            await p.done(model);
            return await sendTranscription(from, text, model);

            // ═══════════════════════════════════════════
            //  Sin entrada válida
            // ═══════════════════════════════════════════
        } else {
            return p.fail('no se encontró audio · adjunta un audio o pasa una url');
        }

    } catch (err) {
        logger.error('transcribir:', err.message);

        let msg = err.message;
        if (err.message.includes('faster-whisper') || err.message.includes('ModuleNotFoundError'))
            msg = 'faster-whisper no está instalado';
        else if (err.message.includes('out of memory'))
            msg = `sin memoria para modelo ${model}. prueba con uno más pequeño`;
        else if (err.message.includes('python3') || err.message.includes('command not found'))
            msg = 'python3 no encontrado';
        else if (err.message.includes('No such file') || err.message.includes('not found'))
            msg = 'archivo de audio no encontrado';

        await p.fail(msg);

    } finally {
        cleanup(...filesToClean);
    }
}

module.exports = { handleTranscribir };