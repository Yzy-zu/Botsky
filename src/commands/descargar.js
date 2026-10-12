'use strict';

const fs = require('fs');
const path = require('path');

const evolution = require('../services/evolution');
const sendMedia = (...args) => evolution.sendMedia(...args);
const sendText = (...args) => evolution.sendText(...args);
const { extractUrl } = require('../core/parser');
const logger = require('../services/logger');
const progress = require('../services/progress');
const { Progress } = progress;
const spawnWithProgress = (...args) => progress.spawnWithProgress(...args);
const drive = require('../services/drive');
const mediaSearch = require('../services/mediaSearch');
const searchMedia = (...args) => (mediaSearch.searchMedia ? mediaSearch.searchMedia(...args) : mediaSearch(...args));
const { searchFailureMessage } = require('../services/operationFeedback');

let thumbCollageModule = null;
try {
    thumbCollageModule = require('../utils/thumbnailCollage');
} catch (_) {
    thumbCollageModule = null;
}

const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';
const DEFAULT_QUALITY = process.env.YTDLP_DEFAULT_QUALITY ?? '480';
const DEFAULT_AUDIO_QUALITY = process.env.YTDLP_DEFAULT_AUDIO_QUALITY ?? '192';
const WHATSAPP_MAX_MB = parseFloat(process.env.WHATSAPP_MAX_MEDIA_MB || process.env.WHATSAPP_MAX_MB || '50');

// Asegurar que el directorio temporal existe
fs.mkdirSync(TMP_DIR, { recursive: true });

// ─── Validaciones ──────────────────────────────────────────────────────────────

const VALID_FORMATS = new Set(['mp4', 'mp3', 'm4a', 'webm', 'ogg']);
const VALID_QUALITY = new Set(['144', '240', '360', '480', '720', '1080', 'best']);
const AUDIO_FORMATS = new Set(['mp3', 'm4a', 'ogg', 'wav']);

// ─── Deduplicación de descargas concurrentes ──────────────────────────────────
const inProgressDownloads = new Map(); // key -> { promise, refCount, shouldCleanup, cleanup }

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Limpia archivos temporales de una sesión.
 */
function cleanup(...files) {
    for (const f of files) {
        try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignorar */ }
    }
}

/**
 * Obtiene el primer archivo generado en el directorio que coincida con el prefijo.
 */
function findGeneratedFile(dir, prefix) {
    const files = fs.readdirSync(dir)
        .filter(f => f.startsWith(prefix) && !f.endsWith('.part') && !f.endsWith('.ytdl'))
        .map(f => path.join(dir, f));
    // Prioritizar archivo final (evitar stream chunks intermedios .f398.mp4 etc.)
    const finalFile = files.find(f => !f.match(/\.f\d+\./));
    return finalFile || files[0] || null;
}

const ADULT_KEYWORDS = [
    'nopor', 'porno', 'porn', 'xxx', 'teen', 'milf', 'hentai', 'chichis', 'tetas',
    'culonas', 'anal', 'creampie', 'blowjob', 'erotico', 'erotica', 'sensual',
    'xvideos', 'pornhub', 'xnxx', 'redtube', 'onlyfans', 'rule34', 'pajero', 'paja',
    'cochinada', 'cochinadas'
];

const ADULT_URL_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:[a-zA-Z0-9-]+\.)?(?:xvideos\d*|pornhub\w*|xnxx\d*|redtube|youporn|spankbang|xhamster\d*|chaturbate|onlyfans|rule34|eporner|tnaflix|beeg|tube8|brazzers)\.[a-z0-9.]+/i;

function extractAdultUrl(text) {
    if (!text || typeof text !== 'string') return null;
    const m = text.match(/(?:https?:\/\/)?(?:www\.)?(?:[a-zA-Z0-9-]+\.)?(?:xvideos\d*|pornhub\w*|xnxx\d*|redtube|youporn|spankbang|xhamster\d*|chaturbate|onlyfans|rule34|eporner|tnaflix|beeg|tube8|brazzers)\.[a-z0-9.]+(?:\/[^\s]*)?/i);
    if (!m) return null;
    let url = m[0].replace(/[.,;:!?)>"'«»“”‘’]+$/, '');
    if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
    }
    return url;
}

// ─── Sesiones interactivas de búsqueda ────────────────────────────────────────
const searchSessions = new Map(); // sessionKey -> { results, isAdult, searchQuery, format, quality, timestamp }

function getDownloadSessionKey(from, messageData) {
    const isGroup = typeof from === 'string' && from.endsWith('@g.us');
    if (isGroup) {
        const participant = messageData?.key?.participant || messageData?.participant || from;
        return `${from}_${participant}`;
    }
    return from;
}

function getSearchSession(sessionKey) {
    if (!sessionKey) return null;
    const s = searchSessions.get(sessionKey);
    if (!s) return null;
    if (Date.now() - s.timestamp > 15 * 60 * 1000) {
        searchSessions.delete(sessionKey);
        return null;
    }
    return s;
}

function setSearchSession(sessionKey, data) {
    if (!sessionKey) return;
    searchSessions.set(sessionKey, { ...data, timestamp: Date.now() });
}

function clearSearchSession(sessionKey) {
    if (sessionKey) searchSessions.delete(sessionKey);
}

function matchSelection(text) {
    if (!text || typeof text !== 'string') return null;
    let clean = text.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    clean = clean.replace(/@[^\s,]+\s*/g, '');
    clean = clean.replace(/[¿?¡!.,;:_~]/g, ' ').replace(/\s+/g, ' ').trim();

    let format = null;
    const fmtMatch = clean.match(/(?:(?:\s+(?:en|a|como)\s+|\s+)(mp3|audio|mp4|video))\s*(?:(?:por\s*favor|por\s*fa|porfa|plis|pls|paro)\s*)*$/i);
    if (fmtMatch) {
        format = (fmtMatch[1] === 'audio' || fmtMatch[1] === 'mp3') ? 'mp3' : 'mp4';
        clean = clean.slice(0, clean.lastIndexOf(fmtMatch[0])).trim();
    }

    clean = clean.replace(/\s+(?:por\s*favor|por\s*fa|porfa|plis|pls|paro|de\s+la\s+lista|de\s+ahi)$/i, '').trim();

    const m = clean.match(/^(?:(?:oye\s+)?(?:compa\s+|bot\s+|botsky\s+|botsito\s+)?)?(?:descarga(?:me|te)?|baja(?:me|te)?|pasa(?:me|te)?|manda(?:me|te)?|tumba(?:te|me)?|echa(?:me|te)?|dame|quiero(?:\s+ver)?|pon(?:me|te)?|toca|escoge|elijo|selecciona)?\s*(?:(?:el|la)\s+)?(?:numero|num|opcion|video|rola|cancion|#)?\s*#?\s*(\d{1,2})$/i);
    if (m) {
        const num = parseInt(m[1], 10);
        if (num >= 1 && num <= 99) {
            return { num, format };
        }
    }
    return null;
}

function decodeHtmlEntities(str) {
    if (!str) return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&[a-zA-Z]+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseDurationToSeconds(durStr) {
    if (!durStr || durStr === 'N/A') return null;
    const clean = durStr.trim().toLowerCase();
    const minMatch = clean.match(/(\d+)\s*min/);
    if (minMatch) return parseInt(minMatch[1], 10) * 60;
    const secMatch = clean.match(/(\d+)\s*sec/);
    if (secMatch) return parseInt(secMatch[1], 10);
    const parts = clean.split(':').map(p => parseInt(p, 10));
    if (!parts.some(isNaN)) {
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
    }
    return null;
}

function estimateSizeStr(seconds) {
    if (!seconds) return '';
    const mb = Math.max(3, Math.round((seconds * 2.2) / 60));
    if (mb > 64) {
        return `⚠️ ~${mb}MB (pesado)`;
    }
    return `💾 ~${mb}MB`;
}

/** Legacy array API. New callers should use mediaSearch's typed result. */
async function searchYoutubeList(query, limit = 8) {
    const result = await searchMedia(query, { limit });
    return result.items;
}

/**
 * Búsqueda de videos para adultos en XVideos.
 */
async function searchAdultList(query, limit = 8) {
    let cleanQuery = query.replace(/\b(?:noporsito|nopor|porno|xxx|videos?\s+de|videos?|clips?|pel[ií]culas?|pelis?\b|desc[aá]rga(?:me|te)?|descargar|descarga|b[aá]ja(?:me|te)?|bajar|baja|b[uú]sca(?:me)?|buscar|busca|p[aá]sa(?:me|te)?|pasar|pasa|t[uú]mba(?:te|me)?|tumbar|tumba|dame|m[aá]nda(?:me|te)?)\b/gi, '').trim();
    cleanQuery = cleanQuery.replace(/\s+/g, ' ').trim();
    cleanQuery = cleanQuery.replace(/^\s*(?:(?:un|una|unas|unos|el|la|los|las|de|del)\s+)+/i, '').trim() || query;
    try {
        const searchUrl = `https://www.xvideos.com/?k=${encodeURIComponent(cleanQuery)}`;
        const res = await fetch(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(6000)
        });
        if (res.ok) {
            const html = await res.text();
            const results = [];
            const blocks = html.split('<div id="video_');
            for (let i = 1; i < blocks.length && results.length < limit; i++) {
                const block = blocks[i];
                const hrefMatch = block.match(/href="(\/video[0-9a-zA-Z._\/-]+)"[^>]*title="([^"]*)"/);
                const durMatch = block.match(/class="duration">([^<]+)<\/span>/);
                const thumbMatch = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+)"/);
                let thumbUrl = thumbMatch ? thumbMatch[1] : null;
                if (thumbUrl && thumbUrl.includes('THUMBNUM')) {
                    thumbUrl = thumbUrl.replace('THUMBNUM', '1');
                }
                if (hrefMatch && hrefMatch[1] && !hrefMatch[1].includes('videos-i-like') && !hrefMatch[1].includes('verification')) {
                    const dur = durMatch ? durMatch[1].trim() : 'N/A';
                    const secs = parseDurationToSeconds(dur);
                    results.push({
                        title: decodeHtmlEntities(hrefMatch[2]),
                        url: `https://www.xvideos.com${hrefMatch[1]}`,
                        thumbnailUrl: thumbUrl,
                        duration: dur,
                        estimatedSize: estimateSizeStr(secs)
                    });
                }
            }
            if (results.length > 0) return results;
        }
    } catch (e) {
        logger.error('[descargar] Error en searchAdultList:', e.message);
    }
    return [];
}

function buildArgs(url, format, quality, withSubs, outputPrefix, flags = {}) {
    const isSpotify = Boolean(url && (/spotify\.com|spotify\.link|^spotify:/i.test(url)));
    if (isSpotify) {
        return [
            'download',
            url,
            '--format', 'mp3',
            '--output', `${outputPrefix}-{title}.{output-ext}`
        ];
    }

    const outputTemplate = `${outputPrefix}.%(ext)s`;
    const isAudio = AUDIO_FORMATS.has(format);
    const isYoutube = url.includes('youtu.be') || url.includes('youtube.com') || url.startsWith('ytsearch');

    // Cookies de YouTube (detectar variables o archivos locales)
    const cookiesCandidate = process.env.YOUTUBE_COOKIES_FILE || process.env.COOKIES_FILE || '';
    let cookiesFile = '';
    if (cookiesCandidate && fs.existsSync(cookiesCandidate)) {
        cookiesFile = cookiesCandidate;
    } else {
        const defaultCookie1 = path.join(__dirname, '../../data/youtube_cookies.txt');
        const defaultCookie2 = path.join(__dirname, '../../data/cookies.txt');
        if (fs.existsSync(defaultCookie1)) cookiesFile = defaultCookie1;
        else if (fs.existsSync(defaultCookie2)) cookiesFile = defaultCookie2;
    }
    const hasCookies = isYoutube && cookiesFile && fs.existsSync(cookiesFile);

    const ytFlags = isYoutube ? [
        ...(hasCookies ? ['--cookies', cookiesFile] : []),
    ] : [];

    let args = [];

    if (isAudio) {
        args = [
            '--no-playlist',
            ...ytFlags,
            '-x',
            '--audio-format', format,
            '--embed-thumbnail',
            '--add-metadata',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            '--socket-timeout', '30',
            '--retries', '3',
            '--limit-rate', '50M',
            '-o', outputTemplate,
            url
        ];
    } else {
        const q = quality === 'best'
            ? 'bestvideo+bestaudio/best'
            : `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`;
        args = [
            '--no-playlist',
            ...ytFlags,
            '-f', q,
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            '--socket-timeout', '30',
            '--retries', '3',
            '--limit-rate', '50M',
            '--merge-output-format', 'mp4',
            '--add-metadata'
        ];
        if (withSubs) {
            args.push('--write-subs', '--write-auto-subs', '--sub-lang', 'es,en', '--embed-subs');
        }

        // Recorte de tiempo mediante --download-sections (yt-dlp)
        if (flags && (flags.ss || flags.to)) {
            const ss = flags.ss || '0';
            const to = flags.to || 'inf';
            args.push('--download-sections', `*${ss}-${to}`, '--force-keyframes-at-cuts');
        }

        if (url.includes('/video/search') || url.includes('playlist')) {
            args.push('--playlist-items', '1');
        }
        args.push('-o', outputTemplate, url);
    }

    return args;
}

// ─── Manejador principal ───────────────────────────────────────────────────────

/**
 * @param {object} parsed   - { command, flags, args }
 * @param {string} from     - JID del remitente
 */
async function handleDescargar(parsed = {}, from, messageData = {}) {
    if (!from) return;
    const safeParsed = (parsed && typeof parsed === 'object') ? parsed : {};
    const flags = safeParsed.flags || {};
    const args = Array.isArray(safeParsed.args) ? safeParsed.args : [];

    // ── Extraer parámetros ──
    let url = extractUrl(args) || extractAdultUrl(Array.isArray(args) ? args.join(' ') : String(args || ''));
    const p = new Progress(from, messageData?.key);

    // Validación silenciosa: fotos de TikTok no soportadas por yt-dlp
    if (url && url.includes('tiktok.com') && url.includes('/photo/')) {
        logger.info('[descargar] Enlace de foto de TikTok detectado, ignorando en silencio.');
        return;
    }

    let format = (flags.f ?? flags.formato ?? 'mp4').toLowerCase();
    let quality = (flags.q ?? flags.calidad ?? DEFAULT_QUALITY).toString().toLowerCase();
    if (['alta', 'maxima', 'hd', 'full hd', 'fullhd', 'hq', 'best', 'rico', 'perron'].includes(quality)) quality = '1080';
    if (['baja', 'ligero', 'comprimido', 'mala'].includes(quality)) quality = '360';
    const withSubs = !!(flags.s ?? flags.subtitulos);

    if (!VALID_FORMATS.has(format)) {
        return p.fail(`formato inválido \`${format}\` · usa: ${[...VALID_FORMATS].join(' ')}`);
    }

    if (!AUDIO_FORMATS.has(format) && !VALID_QUALITY.has(quality)) {
        return p.fail(`calidad inválida \`${quality}\` · usa: ${[...VALID_QUALITY].join(' ')}`);
    }

    let isSearch = false;
    let searchQuery = '';
    let isAdult = !!(flags.adult || flags.nopor) || Boolean(url && ADULT_URL_REGEX.test(url));

    if (!url) {
        searchQuery = args.filter(a => typeof a === 'string' && a).join(' ').trim();
        if (!searchQuery) {
            return p.fail('¿Qué video o canción buscas? También puedes mandarme el enlace.');
        }

        // 1. ¿Es selección de una lista previa activa?
        const downloadSessionKey = getDownloadSessionKey(from, messageData);
        const session = getSearchSession(downloadSessionKey);
        const sel = matchSelection(searchQuery);
        if (sel) {
            if (session) {
                const idx = sel.num - 1;
                if (idx >= 0 && idx < session.results.length) {
                    const item = session.results[idx];
                    url = item.url;
                    isAdult = session.isAdult || Boolean(url && ADULT_URL_REGEX.test(url));
                    if (sel.format) format = sel.format;
                    session.timestamp = Date.now();
                    logger.info(`[descargar] Seleccionó opción #${sel.num}: "${item.title}" (${url})`);
                } else {
                    return p.fail(`Esa opción no está en la lista. Escoge del 1 al ${session.results.length}.`);
                }
            } else {
                return p.fail('No hay ninguna lista de videos activa compa (o ya expiró). Pídeme una búsqueda primero, ej: *descarga video de [tema]*');
            }
        } else {
            // 2. Es una búsqueda nueva -> mostrar lista de opciones con duración y peso
            isSearch = true;
            const qLower = searchQuery.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (!isAdult && ADULT_KEYWORDS.some(kw => qLower.includes(kw))) {
                isAdult = true;
            }

            const searchType = isAdult ? 'cochinadas' : `"${searchQuery}"`;
            await p.start('buscando', `${searchType}`);

            // A new search replaces the old choices, including when it fails.
            clearSearchSession(downloadSessionKey);
            let results;
            if (isAdult) {
                // Legacy provider is intentionally kept separate from YouTube.
                results = await (module.exports.searchAdultList || searchAdultList)(searchQuery, 8);
                if (!results || results.length === 0) {
                    return p.fail(searchFailureMessage({ status: 'empty' }));
                }
            } else {
                const result = await searchMedia(searchQuery, { limit: 8 });
                logger.info('[MEDIA-SEARCH]', JSON.stringify({
                    status: result.status, provider: result.provider, ...result.diagnostic
                }));
                if (result.status !== 'success') return p.fail(searchFailureMessage(result));
                results = result.items;
            }

            // Guardar la sesión interactiva
            setSearchSession(downloadSessionKey, { results, isAdult, searchQuery, format, quality });

            // Formatear mensaje estilo WhatsApp
            const header = isAdult
                ? `🔞 *Videos encontrados para:* "${searchQuery}"\n_Checa la duración y peso antes de pedir, no mames que te bajes una de 2 horas:_\n`
                : `🎬 *Encontré estas opciones para:* "${searchQuery}"\n`;

            const itemsText = results.map((r, i) => {
                const sizePart = r.estimatedSize ? ` · ${r.estimatedSize}` : '';
                return `*${i + 1}.* ${r.title}\n   ⏱️ ${r.duration || 'duración no disponible'}${sizePart}`;
            }).join('\n\n');

            const footer = `\n\n👉 _Responde con_ *el 1*, *el 2* _o_ *descárgame el 3* _(agrega mp3 si solo quieres audio)_`;
            const fullMessage = `${header}\n${itemsText}${footer}`;

            // Generar y enviar collage con las miniaturas numeradas
            let collageFile = null;
            if (thumbCollageModule && typeof thumbCollageModule.generateThumbnailCollage === 'function') {
                try {
                    collageFile = await thumbCollageModule.generateThumbnailCollage(results);
                } catch (cErr) {
                    logger.warn(`[descargar] Error generando collage de miniaturas: ${cErr.message}`);
                }
            }

            if (collageFile && fs.existsSync(collageFile)) {
                try {
                    await sendMedia(from, collageFile, fullMessage);
                } catch (mediaErr) {
                    logger.warn(`[descargar] Falló envío de collage como media, enviando texto: ${mediaErr.message}`);
                    await sendText(from, fullMessage);
                } finally {
                    try { if (fs.existsSync(collageFile)) fs.unlinkSync(collageFile); } catch (_) {}
                }
            } else {
                await sendText(from, fullMessage);
            }
            await p.done('opciones enviadas');
            return;
        }
    }

    // ── Feedback inicial con progreso ──
    const isAudio = AUDIO_FORMATS.has(format);
    const qualityTxt = isAudio ? `${DEFAULT_AUDIO_QUALITY}kbps` : `${quality}p`;
    if (isSearch) {
        const tag = isAdult ? 'cochinadas' : `"${searchQuery}"`;
        await p.start('buscando', `${tag} · ${format} ${qualityTxt}`);
    } else {
        await p.start('descargando', `${format} ${qualityTxt}`);
    }

    // ── Deduplicación de descargas idénticas concurrentes ──
    const dedupKey = `${url}|${format}|${quality}`;
    if (inProgressDownloads.has(dedupKey)) {
        logger.info(`[descargar] Descarga concurrente detectada para ${dedupKey}, uniéndose.`);
        const entry = inProgressDownloads.get(dedupKey);
        entry.refCount++;
        try {
            const shared = await entry.promise;
            if (shared && typeof shared === 'object' && shared.drive && shared.webViewLink) {
                const driveMessage = `> ☁️ *Archivo listo en Google Drive*\n> El archivo pesa *${shared.size.toFixed(2)} MB* (supera el límite de ${WHATSAPP_MAX_MB} MB de WhatsApp).\n\n🔗 *Enlace de descarga:* ${shared.webViewLink}`;
                await sendText(from, driveMessage);
                await p.done('subido a drive');
                return;
            }
            if (shared && shared.finalFile && fs.existsSync(shared.finalFile)) {
                await p.phase('enviando', `${shared.sizeMBFloat.toFixed(1)}mb`);
                const customFileName = (flags.name || flags.n) ? `${(flags.name || flags.n).replace(/\.[a-zA-Z0-9]+$/, '')}.${format}` : null;
                const caption = isAdult
                    ? `> ahí está tu cochinada cerdo, lávate las manos \`${shared.sizeMBFloat.toFixed(2)}mb\`${shared.asDocument ? ' (documento)' : ''}`
                    : `> ahí quedó tu chingadera \`${shared.sizeMBFloat.toFixed(2)}mb\`${shared.asDocument ? ' (documento)' : ''}`;
                await sendMedia(from, shared.finalFile, caption, shared.asDocument, false, null, customFileName);
                await p.done(`${shared.sizeMBFloat.toFixed(1)}mb`);
                return;
            }
        } catch (e) {
            logger.warn(`[descargar] Falló descarga compartida para ${dedupKey}:`, e.message);
        } finally {
            entry.refCount--;
            if (entry.refCount <= 0 && entry.shouldCleanup) {
                entry.cleanup();
            }
        }
    }

    let resolveDedup = () => {};
    let rejectDedup = () => {};
    const dedupPromise = new Promise((resolve, reject) => {
        resolveDedup = resolve;
        rejectDedup = reject;
    });

    // ── Generar nombre único para la sesión ──
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const outputPrefix = path.join(TMP_DIR, sessionId);

    const dedupEntry = {
        promise: dedupPromise,
        refCount: 1,
        shouldCleanup: false,
        cleanup: () => {
            cleanup(...fs.readdirSync(TMP_DIR)
                .filter(f => f.startsWith(sessionId))
                .map(f => path.join(TMP_DIR, f))
            );
        }
    };
    inProgressDownloads.set(dedupKey, dedupEntry);

    try {
        const isSpotify = Boolean(url && (/spotify\.com|spotify\.link|^spotify:/i.test(url)));
        const cmd = isSpotify ? 'spotdl' : 'yt-dlp';
        const argsArray = buildArgs(url, format, quality, withSubs, outputPrefix, flags);
        logger.cmd(`${cmd} ${argsArray.join(' ')}`);

        await spawnWithProgress(cmd, argsArray, {
            timeout: 10 * 60 * 1000,
        });

        // ── Buscar el archivo generado ──
        const outputFile = findGeneratedFile(TMP_DIR, sessionId);

        if (!outputFile || !fs.existsSync(outputFile)) {
            throw new Error('el script no generó ningún archivo. el video puede ser privado o requerir login');
        }

        let finalFile = outputFile;
        let sizeMBFloat = fs.statSync(finalFile).size / (1024 * 1024);
        const maxMB = parseFloat(process.env.MAX_FILE_SIZE_MB ?? '64');

        // ── Comprimir si excede el límite (solo videos) ──
        if (sizeMBFloat > WHATSAPP_MAX_MB && !isAudio) {
            await p.phase('comprimiendo', `${sizeMBFloat.toFixed(1)}mb`);

            const compressedFile = outputFile.replace(/\.[^/.]+$/, '-comprimido.mp4');
            const compressArgs = [
                '-y', '-i', outputFile,
                '-vf', 'scale=-2:480',
                '-vcodec', 'libx264', '-crf', '32', '-maxrate', '650k', '-bufsize', '1300k', '-preset', 'ultrafast',
                '-c:a', 'aac', '-b:a', '96k',
                compressedFile
            ];

            logger.cmd(`ffmpeg ${compressArgs.join(' ')}`);

            await spawnWithProgress('ffmpeg', compressArgs, {
                timeout: 45 * 60 * 1000,
            });

            if (fs.existsSync(compressedFile) && fs.statSync(compressedFile).size > 0) {
                finalFile = compressedFile;
                sizeMBFloat = fs.statSync(finalFile).size / (1024 * 1024);
                logger.success(`Video comprimido a: ${sizeMBFloat.toFixed(2)} MB`);
            }
        }

        logger.success(`Archivo final listo: ${finalFile} (${sizeMBFloat.toFixed(2)} MB)`);

        // ── Auto-subida a Google Drive si excede el límite de WhatsApp ──
        if (sizeMBFloat > WHATSAPP_MAX_MB) {
            await p.phase('subiendo', 'google drive');
            const mimeType = isAudio ? (format === 'mp3' ? 'audio/mpeg' : `audio/${format}`) : 'video/mp4';
            const uploadName = (flags.name || flags.n)
                ? `${(flags.name || flags.n).replace(/\.[a-zA-Z0-9]+$/, '')}.${format}`
                : path.basename(finalFile);

            try {
                const driveRes = await drive.uploadFile(finalFile, mimeType, uploadName);
                if (driveRes?.webViewLink) {
                    const driveMsg = `> ☁️ *Archivo listo en Google Drive*\n> El archivo pesa *${sizeMBFloat.toFixed(2)} MB* (supera el límite de ${WHATSAPP_MAX_MB} MB de WhatsApp).\n\n🔗 *Enlace de descarga:* ${driveRes.webViewLink}`;
                    await sendText(from, driveMsg);
                    resolveDedup({ drive: true, webViewLink: driveRes.webViewLink, size: sizeMBFloat });
                    await p.done('subido a drive');
                    return;
                }
            } catch (driveErr) {
                logger.error('[descargar] Error en subida a Google Drive:', driveErr.message);
                if (sizeMBFloat > 100) {
                    throw new Error(`El archivo pesa ${sizeMBFloat.toFixed(1)} MB y falló la subida a Drive: ${driveErr.message}`);
                }
            }
        }

        let asDocument = false;
        if (sizeMBFloat > maxMB) {
            if (sizeMBFloat <= 200) {
                asDocument = true;
                logger.info(`[descargar] Archivo pesa ${sizeMBFloat.toFixed(2)}MB (>64MB), enviando como documento.`);
            } else {
                throw new Error(`El archivo pesa ${sizeMBFloat.toFixed(1)} MB y supera el límite de 200 MB.`);
            }
        }

        // ── Enviar el archivo ──
        await p.phase('enviando', `${sizeMBFloat.toFixed(1)}mb`);

        const customFileName = (flags.name || flags.n) ? `${(flags.name || flags.n).replace(/\.[a-zA-Z0-9]+$/, '')}.${format}` : null;
        const caption = isAdult
            ? `> ahí está tu cochinada cerdo, lávate las manos \`${sizeMBFloat.toFixed(2)}mb\`${asDocument ? ' (documento)' : ''}`
            : `> ahí quedó tu chingadera \`${sizeMBFloat.toFixed(2)}mb\`${asDocument ? ' (documento)' : ''}`;

        await sendMedia(from, finalFile,
            caption,
            asDocument,
            false,
            null,
            customFileName
        );

        resolveDedup({ finalFile, sizeMBFloat, asDocument });
        await p.done(`${sizeMBFloat.toFixed(1)}mb`);

    } catch (err) {
        rejectDedup(err);
        logger.error('descargar:', err.message);

        // Mensajes de error amigables
        let msg = err.message;
        if (err.message.includes('el script no generó ningún archivo')) {
            msg = isSearch ? searchFailureMessage({ status: 'unavailable' }) : 'no se pudo descargar esa porquería (puede ser privado o requerir login)';
        } else if (err.message.includes('Private video')) msg = 'video privado';
        else if (err.message.includes('not available')) msg = 'video no disponible en la región';
        else if (err.message.includes('Sign in') || err.message.includes('not a bot') || err.message.includes('LOGIN_REQUIRED')) {
            msg = 'ese video tiene restricción de edad o youtube pide login para verlo. escoge otro número de la lista';
        }
        else if (err.message.includes('ETIMEDOUT') || err.message.includes('timeout')) msg = 'timeout. intenta menor calidad';
        else if (err.message.includes('supera el límite')) msg = err.message;

        await p.fail(msg);

    } finally {
        inProgressDownloads.delete(dedupKey);
        dedupEntry.shouldCleanup = true;
        dedupEntry.refCount--;
        if (dedupEntry.refCount <= 0) {
            dedupEntry.cleanup();
        }
    }
}

module.exports = {
    handleDescargar,
    getSearchSession,
    setSearchSession,
    clearSearchSession,
    matchSelection,
    searchAdultList,
    searchYoutubeList,
    getDownloadSessionKey,
    inProgressDownloads,
    buildArgs,
    extractAdultUrl,
    ADULT_URL_REGEX
};
