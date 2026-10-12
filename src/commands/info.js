'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const { sendText } = require('../services/evolution');
const { extractUrl } = require('../core/parser');
const logger = require('../services/logger');

const execFileAsync = promisify(execFile);

/**
 * Formatea segundos a HH:MM:SS legible.
 */
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return 'Desconocida';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

/**
 * Formatea bytes a string legible.
 */
function formatSize(bytes) {
    if (!bytes || isNaN(bytes)) return 'Desconocido';
    const mb = bytes / (1024 * 1024);
    return mb > 1000 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(2)} MB`;
}

/**
 * @param {object} parsed - { command, flags, args }
 * @param {string} from   - JID del remitente
 */
async function handleInfo(parsed = {}, from) {
    if (!from) return;
    const safeParsed = parsed || {};
    const args = Array.isArray(safeParsed.args) ? safeParsed.args : [];
    const url = extractUrl(args);

    if (!url) {
        return sendText(from,
            'Pásame el enlace del video.\nUsa `info [enlace]`.'
        );
    }

    // Mensaje de carga eliminado

    try {
        logger.cmd(`yt-dlp --dump-json --no-playlist "${url}"`);

        const { stdout } = await execFileAsync('yt-dlp', ['--dump-json', '--no-playlist', url], {
            timeout: 30_000,
            maxBuffer: 10 * 1024 * 1024,
        });

        const info = JSON.parse(stdout.trim().split('\n')[0]); // primer resultado

        // ── Formatos de video disponibles ──
        const videoFormats = (info.formats ?? [])
            .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
            .map(f => f.height)
            .filter((v, i, a) => a.indexOf(v) === i) // unique
            .sort((a, b) => a - b)
            .map(h => `${h}p`);

        const hasAudio = (info.formats ?? []).some(f =>
            f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')
        );

        // ── Construir respuesta ──
        const lines = [
            `*${info.title ?? 'Sin título'}*`,
            ``,
            `Autor: ${info.uploader ?? info.channel ?? 'desconocido'}`,
            `Duración: ${formatDuration(info.duration)}`,
            `Fecha: ${info.upload_date
                ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6)}`
                : 'desconocida'}`,
            `Vistas: ${info.view_count?.toLocaleString('es-MX') ?? 'n/a'}`,
            `Me gusta: ${info.like_count?.toLocaleString('es-MX') ?? 'n/a'}`,
            ``,
            `Calidades: ${videoFormats.length > 0 ? videoFormats.join(', ') : 'n/a'}`,
            `Audio: ${hasAudio ? 'disponible' : 'no disponible'}`,
            `Sitio: ${info.extractor_key ?? info.extractor ?? 'desconocido'}`,
        ];

        if (info.description) {
            const desc = info.description.slice(0, 200).replace(/\n+/g, ' ');
            lines.push(``, `Descripción:`, desc + (info.description.length > 200 ? '...' : ''));
        }

        await sendText(from, lines.join('\n'));

    } catch (err) {
        logger.error('info:', err.message);

        let msg = 'No pude consultar ese video. Revisa que el enlace abra y prueba de nuevo.';
        if (err.message.includes('Private video')) msg = 'Ese video es privado. Pásame un enlace público.';
        if (err.message.includes('not available')) msg = 'Ese video ya no está disponible. Prueba con otro enlace.';

        await sendText(from, msg);
    }
}

/** Estado local del proceso; no consulta APIs ni pretende comprobarlas. */
async function handleBotStatus(parsed = {}, from) {
    if (!from) return;
    const uptimeSeconds = Math.floor(process.uptime());
    const queueStats = require('../core/queue').stats;
    const active = Object.values(queueStats).reduce((total, tier) => total + tier.running, 0);
    const pending = Object.values(queueStats).reduce((total, tier) => total + tier.pending, 0);
    const message = `Aquí ando 🐾\nLlevo activo ${uptimeSeconds === 0 ? '0s' : formatDuration(uptimeSeconds)}.\nTrabajos: ${active} en curso y ${pending} en espera.`;
    await sendText(from, message);
    return { success: true, estado: 'activo', uptime_segundos: uptimeSeconds, trabajos_activos: active, trabajos_en_espera: pending, enviado_al_chat: true };
}

module.exports = { handleInfo, handleBotStatus };
