'use strict';

const { spawn } = require('child_process');
const { sendText, editMessage } = require('./evolution');
const logger = require('./logger');

// ─── Iconos por fase ──────────────────────────────────────────────────────────
const ICONS = {
    descargando:    '📥',
    convirtiendo:   '🔄',
    comprimiendo:   '🗜️',
    transcribiendo: '🎤',
    procesando:     '⚙️',
    enviando:       '📤',
    buscando:       '🔍',
    extrayendo:     '📄',
    aplicando:      '🎛️',
};

/**
 * Tracker de progreso con edición de mensajes en tiempo real.
 *
 * Uso:
 *   const p = new Progress(from);
 *   await p.start('descargando', 'mp4 720p');   // envía mensaje inicial
 *   await p.update(45, '8.2MB');                 // edita con barra de progreso
 *   await p.phase('comprimiendo', '23.5mb');     // cambia la fase
 *   await p.done('15.4mb · 48s');                // marca como listo
 *   await p.fail('video privado');               // o marca como error
 */
class Progress {
    /**
     * @param {string} jid - Chat destino (JID)
     */
    constructor(jid) {
        this.jid = jid;
        this.key = null;           // Message key para editar
        this.phase_ = '';
        this.startTime = Date.now();
        this.lastEditAt = 0;
        this.minInterval = 3000;   // Mínimo 3s entre ediciones (rate limit de WhatsApp)
        this.ended = false;
    }

    /**
     * Renderiza la barra de progreso visual.
     * Usa ⬛/⬜ porque son emojis estándar que renderizan igual en todos los teléfonos.
     */
    _bar(percent) {
        const clamped = Math.max(0, Math.min(100, percent));
        const filled = Math.round(clamped / 10);
        return '⬛'.repeat(filled) + '⬜'.repeat(10 - filled);
    }

    /**
     * Envía el mensaje inicial de la fase. Guarda la key para editar después.
     * @param {string} phase  - Nombre de la fase ('descargando', 'convirtiendo', etc.)
     * @param {string} detail - Info extra opcional ('mp4 720p', '23.5mb', etc.)
     */
    async start(phase, detail = '') {
        // No-op: se usa el sistema de reacciones ⏳
    }

    /**
     * Actualiza el progreso editando el mensaje original.
     * Se auto-throttlea para no spamear WhatsApp.
     * @param {number} percent - Porcentaje (0-100)
     * @param {string} detail  - Info extra ('8.2MB', '2.1MB/s', etc.)
     */
    async update(percent, detail = '') {
        // No-op
    }

    /**
     * Cambia de fase editando el mensaje.
     * @param {string} phase  - Nueva fase
     * @param {string} detail - Info extra
     */
    async phase(phase, detail = '') {
        // No-op
    }

    /**
     * Marca como completado. Edita el mensaje con ✅.
     * @param {string} detail - Info final ('15.4mb · 48s')
     */
    async done(detail = '') {
        // No-op: se usa la reacción ✅
    }

    /**
     * Marca como error. Edita el mensaje con ❌.
     * @param {string} reason - Motivo del error
     */
    async fail(reason = '') {
        const err = new Error(reason);
        err.userMessage = reason;
        throw err;
    }
}

// ─── Helper: ejecutar proceso con progreso en tiempo real ─────────────────────

/**
 * Ejecuta un proceso hijo y parsea su salida para extraer progreso.
 * Soporta yt-dlp y ffmpeg de forma automática.
 *
 * @param {string}   cmd       - Comando a ejecutar ('yt-dlp', 'ffmpeg', etc.)
 * @param {string[]} args      - Argumentos
 * @param {object}   opts      - Opciones de spawn + { timeout }
 * @param {Function} onProgress - Callback (percent: number, detail: string)
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function spawnWithProgress(cmd, args, opts = {}, onProgress = null) {
    const timeout = opts.timeout ?? 10 * 60 * 1000;
    delete opts.timeout;

    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });

        let stdout = '';
        let stderr = '';
        let timer = null;
        let killed = false;

        if (timeout > 0) {
            timer = setTimeout(() => {
                killed = true;
                child.kill('SIGKILL');
                reject(new Error(`timeout: el proceso superó ${Math.round(timeout / 1000)}s`));
            }, timeout);
        }

        child.stdout.on('data', (d) => {
            stdout += d.toString();
        });

        child.stderr.on('data', (d) => {
            const chunk = d.toString();
            stderr += chunk;

            if (!onProgress) return;

            // ── Parsear progreso de yt-dlp ──
            // [download]  45.2% of   15.32MiB at    2.41MiB/s ETA 00:04
            const ytMatch = chunk.match(/\[download\]\s+(\d+\.?\d*)%\s+of\s+~?\s*(\S+)/);
            if (ytMatch) {
                onProgress(parseFloat(ytMatch[1]), ytMatch[2]);
                return;
            }

            // ── Parsear progreso de ffmpeg ──
            // time=00:01:23.45
            const ffMatch = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/);
            if (ffMatch) {
                const secs = parseInt(ffMatch[1]) * 3600 + parseInt(ffMatch[2]) * 60 + parseFloat(ffMatch[3]);
                onProgress(-1, `${Math.floor(secs)}s procesados`);
            }
        });

        child.on('error', (err) => {
            if (timer) clearTimeout(timer);
            if (!killed) reject(err);
        });

        child.on('close', (code) => {
            if (timer) clearTimeout(timer);
            if (killed) return;
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                reject(new Error(stderr.slice(-500) || `proceso terminó con código ${code}`));
            }
        });
    });
}

module.exports = { Progress, spawnWithProgress };
