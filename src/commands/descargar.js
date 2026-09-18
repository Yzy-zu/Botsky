'use strict';

const fs = require('fs');
const path = require('path');

const { sendMedia, sendText } = require('../services/evolution');
const { extractUrl } = require('../core/parser');
const logger = require('../services/logger');
const { Progress, spawnWithProgress } = require('../services/progress');
const { execFile } = require('child_process');

const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';
const DEFAULT_QUALITY = process.env.YTDLP_DEFAULT_QUALITY ?? '720';
const DEFAULT_AUDIO_QUALITY = process.env.YTDLP_DEFAULT_AUDIO_QUALITY ?? '192';

// Asegurar que el directorio temporal existe
fs.mkdirSync(TMP_DIR, { recursive: true });

// ─── Validaciones ──────────────────────────────────────────────────────────────

const VALID_FORMATS = new Set(['mp4', 'mp3', 'm4a', 'webm', 'ogg']);
const VALID_QUALITY = new Set(['144', '240', '360', '480', '720', '1080', 'best']);
const AUDIO_FORMATS = new Set(['mp3', 'm4a', 'ogg', 'wav']);

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
    'xvideos', 'pornhub', 'xnxx', 'redtube', 'onlyfans', 'rule34', 'pajero', 'paja'
];

// ─── Sesiones interactivas de búsqueda ────────────────────────────────────────
const searchSessions = new Map(); // from -> { results, isAdult, searchQuery, format, quality, timestamp }

function getSearchSession(from) {
    const s = searchSessions.get(from);
    if (!s) return null;
    if (Date.now() - s.timestamp > 15 * 60 * 1000) {
        searchSessions.delete(from);
        return null;
    }
    return s;
}

function setSearchSession(from, data) {
    searchSessions.set(from, { ...data, timestamp: Date.now() });
}

function clearSearchSession(from) {
    searchSessions.delete(from);
}

function matchSelection(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.trim().toLowerCase();
    const m = clean.match(/^(?:oye\s+)?(?:descarga(?:me)?|baja(?:me)?|pasa(?:me)?|manda(?:me)?|tumba(?:te)?|dame|quiero)?\s*(?:el\s+|el\s+n[uú]mero\s+|n[uú]mero\s+|num\s+|#|el\s+video\s+|video\s+)?\s*(\d{1,2})\b(?:\s+(?:de\s+la\s+lista|de\s+ahi))?(?:\s+(?:en\s+|a\s+)?(mp3|mp4))?(?:\s+porfa(?:vor)?)?$/i);
    if (m) {
        return { num: parseInt(m[1], 10), format: m[2] || null };
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

/**
 * Búsqueda en YouTube usando --flat-playlist (rápido, sin bot-check).
 */
function searchYoutubeList(query, limit = 8) {
    return new Promise((resolve) => {
        execFile('yt-dlp', [
            '--flat-playlist',
            '--print', '%(id)s\t%(title)s\t%(duration_string)s',
            `ytsearch${limit + 5}:${query}`
        ], { timeout: 15000 }, (err, stdout) => {
            if (err) {
                logger.error('[descargar] Error en searchYoutubeList:', err.message);
                return resolve([]);
            }
            const lines = stdout.trim().split('\n').filter(Boolean);
            const results = lines.map(line => {
                const [id, title, duration] = line.split('\t');
                const durStr = duration && duration !== 'NA' ? duration.trim() : 'N/A';
                const secs = parseDurationToSeconds(durStr);
                return {
                    title: (title || 'Video de YouTube').trim(),
                    url: `https://www.youtube.com/watch?v=${id}`,
                    duration: durStr,
                    estimatedSize: estimateSizeStr(secs)
                };
            }).filter(r => r.duration !== 'N/A' && !r.title.includes('🔴') && !r.title.toLowerCase().includes('directo') && !r.title.toLowerCase().includes('en vivo')).slice(0, limit);
            resolve(results);
        });
    });
}

/**
 * Búsqueda de videos para adultos en XVideos.
 */
async function searchAdultList(query, limit = 8) {
    const cleanQuery = query.replace(/noporsito|nopor|porno|video\s+de|video|descargame|baja|bajar/gi, '').trim() || query;
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
                if (hrefMatch && hrefMatch[1] && !hrefMatch[1].includes('videos-i-like') && !hrefMatch[1].includes('verification')) {
                    const dur = durMatch ? durMatch[1].trim() : 'N/A';
                    const secs = parseDurationToSeconds(dur);
                    results.push({
                        title: decodeHtmlEntities(hrefMatch[2]),
                        url: `https://www.xvideos.com${hrefMatch[1]}`,
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
    const outputTemplate = `${outputPrefix}.%(ext)s`;
    const isAudio = AUDIO_FORMATS.has(format);
    const isYoutube = url.includes('youtu.be') || url.includes('youtube.com') || url.startsWith('ytsearch');

    // Cookies de YouTube (configurar YOUTUBE_COOKIES_FILE en .env)
    const cookiesFile = process.env.YOUTUBE_COOKIES_FILE ?? '';
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
            '-o', outputTemplate,
            url
        ];
    } else {
        const q = quality === 'best' ? 'bestvideo+bestaudio/best' : `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`;
        args = [
            '--no-playlist',
            ...ytFlags,
            '-f', q,
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
async function handleDescargar({ flags, args }, from) {
    // ── Extraer parámetros ──
    let url = extractUrl(args);
    const p = new Progress(from);

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
    let isAdult = !!(flags.adult || flags.nopor);

    if (!url) {
        searchQuery = args.filter(a => a && !a.startsWith('-')).join(' ').trim();
        if (!searchQuery) {
            return p.fail('falta la url o el nombre de lo que quieres buscar, cabrón · usa `/@descargar [url o búsqueda]`');
        }

        // 1. ¿Es selección de una lista previa activa?
        const session = getSearchSession(from);
        const sel = matchSelection(searchQuery);
        if (session && sel) {
            const idx = sel.num - 1;
            if (idx >= 0 && idx < session.results.length) {
                const item = session.results[idx];
                url = item.url;
                isAdult = session.isAdult;
                if (sel.format) format = sel.format;
                session.timestamp = Date.now();
                logger.info(`[descargar] Seleccionó opción #${sel.num}: "${item.title}" (${url})`);
            } else {
                return p.fail(`ese número no está en la lista cabrón, escoge del 1 al ${session.results.length}`);
            }
        } else {
            // 2. Es una búsqueda nueva -> mostrar lista de opciones con duración y peso
            isSearch = true;
            const qLower = searchQuery.toLowerCase();
            if (!isAdult && ADULT_KEYWORDS.some(kw => qLower.includes(kw))) {
                isAdult = true;
            }

            const searchType = isAdult ? 'cochinadas' : `"${searchQuery}"`;
            await p.start('buscando', `${searchType}`);

            let results = [];
            if (isAdult) {
                results = await searchAdultList(searchQuery, 8);
            } else {
                results = await searchYoutubeList(searchQuery, 8);
            }

            if (!results || results.length === 0) {
                return p.fail(`no encontré ni madres de "${searchQuery}", escribe bien cabrón`);
            }

            // Guardar la sesión interactiva
            setSearchSession(from, { results, isAdult, searchQuery, format, quality });

            // Formatear mensaje estilo WhatsApp
            const header = isAdult
                ? `🔞 *Videos encontrados para:* "${searchQuery}"\n_Checa la duración y peso antes de pedir, no mames que te bajes una de 2 horas:_\n`
                : `🎬 *Videos encontrados para:* "${searchQuery}"\n_Checa la duración y peso antes de pedir, cabrón:_\n`;

            const itemsText = results.map((r, i) => {
                const sizePart = r.estimatedSize ? ` · ${r.estimatedSize}` : '';
                return `*${i + 1}.* ${r.title}\n   ⏱️ \`${r.duration}\`${sizePart}`;
            }).join('\n\n');

            const footer = `\n\n👉 _Responde con_ *el 1*, *el 2* _o_ *descárgame el 3* _(agrega mp3 si solo quieres audio)_`;

            await sendText(from, `${header}\n${itemsText}${footer}`);
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

    // ── Generar nombre único para la sesión ──
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const outputPrefix = path.join(TMP_DIR, sessionId);

    try {
        // ── Ejecutar yt-dlp con progreso en tiempo real ──
        const argsArray = buildArgs(url, format, quality, withSubs, outputPrefix, flags);
        logger.cmd(`yt-dlp ${argsArray.join(' ')}`);

        await spawnWithProgress('yt-dlp', argsArray, {
            timeout: 10 * 60 * 1000,
        }, (percent, detail) => {
            if (percent >= 0) {
                p.update(percent, detail);
            }
        });

        // ── Buscar el archivo generado ──
        const outputFile = findGeneratedFile(TMP_DIR, sessionId);

        if (!outputFile || !fs.existsSync(outputFile)) {
            throw new Error('el script no generó ningún archivo. el video puede ser privado o requerir login');
        }

        let finalFile = outputFile;
        let sizeMBFloat = fs.statSync(finalFile).size / (1024 * 1024);
        const maxMB = parseFloat(process.env.MAX_FILE_SIZE_MB ?? '64');

        // ── Comprimir si excede el límite ──
        if (sizeMBFloat > maxMB && !isAudio) {
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
            }, (percent, detail) => {
                if (percent >= 0) p.update(percent, detail);
            });

            if (fs.existsSync(compressedFile) && fs.statSync(compressedFile).size > 0) {
                finalFile = compressedFile;
                sizeMBFloat = fs.statSync(finalFile).size / (1024 * 1024);
                logger.success(`Video comprimido a: ${sizeMBFloat.toFixed(2)} MB`);
            }
        }

        logger.success(`Archivo final listo: ${finalFile} (${sizeMBFloat.toFixed(2)} MB)`);

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

        await p.done(`${sizeMBFloat.toFixed(1)}mb`);

    } catch (err) {
        logger.error('descargar:', err.message);

        // Mensajes de error amigables
        let msg = err.message;
        if (err.message.includes('el script no generó ningún archivo')) {
            msg = isSearch ? `no encontré ni madres de "${searchQuery}", escribe bien cabrón` : 'no se pudo descargar esa porquería (puede ser privado o requerir login)';
        } else if (err.message.includes('Private video')) msg = 'video privado';
        else if (err.message.includes('not available')) msg = 'video no disponible en la región';
        else if (err.message.includes('Sign in') || err.message.includes('not a bot') || err.message.includes('LOGIN_REQUIRED')) {
            msg = 'ese video tiene restricción de edad o youtube pide login para verlo. escoge otro número de la lista';
        }
        else if (err.message.includes('ETIMEDOUT') || err.message.includes('timeout')) msg = 'timeout. intenta menor calidad';
        else if (err.message.includes('supera el límite')) msg = err.message;

        await p.fail(msg);

    } finally {
        // ── Limpieza ──
        cleanup(...fs.readdirSync(TMP_DIR)
            .filter(f => f.startsWith(sessionId))
            .map(f => path.join(TMP_DIR, f))
        );
    }
}

module.exports = {
    handleDescargar,
    getSearchSession,
    setSearchSession,
    clearSearchSession,
    matchSelection,
    searchAdultList,
    searchYoutubeList
};
