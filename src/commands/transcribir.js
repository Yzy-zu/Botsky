'use strict';

const { cleanup } = require('../utils/cleanup');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const { sendText, downloadMedia } = require('../services/evolution');
const { extractUrl } = require('../core/parser');
const logger = require('../services/logger');
const { Progress } = require('../services/progress');
const { transcribeAudio, summarizeTranscription } = require('../services/whisper');

const execFileAsync = promisify(execFile);

const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';
const DEFAULT_MODEL = 'whisper-large-v3-turbo';
const DEFAULT_LANG = process.env.WHISPER_LANGUAGE ?? 'auto';

fs.mkdirSync(TMP_DIR, { recursive: true });

// ─── Modelos y Lenguajes ──────────────────────────────────────────────────────

const MODEL_MAP = {
    'turbo': 'whisper-large-v3-turbo',
    'fast': 'whisper-large-v3-turbo',
    'large': 'whisper-large-v3',
    'large-v3': 'whisper-large-v3',
    'whisper-large-v3-turbo': 'whisper-large-v3-turbo',
    'whisper-large-v3': 'whisper-large-v3',
    'small': 'whisper-large-v3-turbo',
    'base': 'whisper-large-v3-turbo',
    'tiny': 'whisper-large-v3-turbo'
};

const VALID_LANGS = new Set([
    'auto', 'es', 'en', 'fr', 'de', 'pt', 'it',
    'zh', 'ja', 'ko', 'ru', 'ar', 'nl', 'pl', 'tr',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Enviar transcripción al usuario (soporte para resumen y textos largos) ───

async function sendTranscription(from, { text, duration, language, provider, elapsedMs }, shouldSummarize = false) {
    if (!text || text.trim().length === 0) {
        await sendText(from, 'No alcancé a distinguir lo que se dice. Prueba con un audio más claro o con menos ruido.');
        return null;
    }

    let summary = null;
    const wordCount = text.trim().split(/\s+/).length;

    // Resumir si el usuario lo pidió o si el audio es muy largo (más de 60 palabras)
    if (shouldSummarize || wordCount >= 60) {
        try {
            summary = await summarizeTranscription(text);
        } catch (err) {
            logger.warn(`[TRANSCRIBIR] No se pudo generar resumen: ${err.message}`);
        }
    }

    const durationStr = duration ? ` · ${duration}s` : '';
    const header = `🎙️ *Esto dice el audio*${durationStr}`;

    let fullMessage = `${header}\n\n"${text}"`;
    if (summary) {
        fullMessage += `\n\n*Lo principal:*\n${summary}`;
    }

    const parts = splitText(fullMessage);

    if (parts.length === 1) {
        await sendText(from, parts[0]);
        return fullMessage;
    } else {
        await sendText(from, `El audio salió largo. Te lo paso en ${parts.length} partes:`);
        for (let i = 0; i < parts.length; i++) {
            await sendText(from, `*Parte ${i + 1} de ${parts.length}*\n\n${parts[i]}`);
        }
        return fullMessage.slice(0, 400);
    }
}

// ─── Manejador principal ───────────────────────────────────────────────────────

/**
 * @param {object} parsed      - { command, flags, args }
 * @param {string} from        - JID del remitente
 * @param {object} messageData - Datos crudos del webhook
 */
async function handleTranscribir(parsed = {}, from, messageData = {}) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    if (!from) return;
    const safeParsed = (parsed && typeof parsed === 'object') ? parsed : {};
    const flags = safeParsed.flags || {};
    const args = Array.isArray(safeParsed.args) ? safeParsed.args : [];
    const p = new Progress(from, messageData?.key);

    const rawModel = (flags.m ?? flags.modelo ?? 'turbo').toLowerCase();
    const model = MODEL_MAP[rawModel] || DEFAULT_MODEL;
    const lang = (flags.l ?? flags.idioma ?? DEFAULT_LANG).toLowerCase();
    const shouldSummarize = !!(flags.resumir || flags.resumen || flags.r || args.includes('resumen') || args.includes('resumir'));
    const url = extractUrl(args);

    if (lang !== 'auto' && !VALID_LANGS.has(lang)) {
        return p.fail(`idioma inválido \`${lang}\` · usa: ${[...VALID_LANGS].join(' ')}`);
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const audioPath = path.join(TMP_DIR, `${sessionId}.ogg`);
    let filesToClean = [audioPath];

    try {
        // ═══════════════════════════════════════════
        //  MODO 1: URL (YouTube, TikTok, etc.)
        // ═══════════════════════════════════════════
        if (url) {
            await p.start('descargando', `audio · Whisper AI`);

            const urlAudioTemplate = path.join(TMP_DIR, `${sessionId}.%(ext)s`);
            await downloadAudioFromUrl(url, urlAudioTemplate);

            const actualFile = ['.mp3', '.m4a', '.ogg', '.wav', '.opus', '.webm']
                .map(ext => path.join(TMP_DIR, `${sessionId}${ext}`))
                .find(p => fs.existsSync(p));

            if (!actualFile) {
                throw new Error('No se pudo descargar el audio de la URL proporcionada.');
            }

            filesToClean = [actualFile];
            await p.phase('transcribiendo', 'Groq Whisper');

            const result = await transcribeAudio(actualFile, { model, language: lang });
            await p.done('listo');
            return await sendTranscription(from, result, shouldSummarize);

            // ═══════════════════════════════════════════
            //  MODO 2: Nota de voz o audio adjunto / citado
            // ═══════════════════════════════════════════
        } else {
            const contextInfo = messageData?.message?.extendedTextMessage?.contextInfo;
            const quotedAudio = contextInfo?.quotedMessage?.audioMessage;
            const hasDirectAudio = messageData?.messageType?.toLowerCase().includes('audio') || !!messageData?.message?.audioMessage;
            const isQuotedAudio = !!quotedAudio;

            if (hasDirectAudio || isQuotedAudio) {
                await p.start('transcribiendo', `Whisper AI`);

                // Asegurar key del mensaje citado si aplica
                if (isQuotedAudio && !messageData.quotedStanzaId && contextInfo?.stanzaId) {
                    messageData.quotedStanzaId = contextInfo.stanzaId;
                    messageData.quotedParticipant = contextInfo.participant || messageData.key?.participant;
                }

                const downloaded = await downloadMedia(messageData);
                if (!downloaded || !downloaded.buffer) {
                    throw new Error('No se pudo descargar el audio de WhatsApp.');
                }

                const ext = downloaded.extension || 'ogg';
                const finalAudioPath = path.join(TMP_DIR, `${sessionId}.${ext}`);
                fs.writeFileSync(finalAudioPath, downloaded.buffer);
                filesToClean = [finalAudioPath];

                const result = await transcribeAudio(finalAudioPath, { model, language: lang });
                await p.done('listo');
                return await sendTranscription(from, result, shouldSummarize);

                // ═══════════════════════════════════════════
                //  Sin entrada válida
                // ═══════════════════════════════════════════
            } else {
                return p.fail('no se encontró audio · adjunta un audio, responde a uno o pasa una URL');
            }
        }

    } catch (err) {
        logger.error('[TRANSCRIBIR] Error:', err.message);

        let msg = err.message;
        if (err.message.includes('No such file') || err.message.includes('not found')) {
            msg = 'archivo de audio no encontrado';
        } else if (err.message.includes('timeout')) {
            msg = 'la transcripción tardó demasiado en responder';
        }

        await p.fail(msg);

    } finally {
        cleanup(...filesToClean);
    }
}

module.exports = { handleTranscribir };
