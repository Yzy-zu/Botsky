'use strict';

const { spawn } = require('child_process');
const { sendReaction } = require('./evolution');
const logger = require('./logger');

/**
 * Tracker de progreso mediante reacciones nativas de WhatsApp (⏳ / ✅ / ❌).
 * No spamea mensajes ni genera sobrecosto de ediciones de texto.
 */
class Progress {
    /**
     * @param {string} jid - Chat destino (JID)
     * @param {object|null} [messageKey] - Key del mensaje original de WhatsApp para reaccionar
     */
    constructor(jid, messageKey = null) {
        this.jid = jid;
        this.key = messageKey;
        this.phase_ = '';
        this.startTime = Date.now();
        this.ended = false;
    }

    /**
     * Reacciona con ⏳ en el mensaje del usuario al iniciar la tarea.
     */
    async start(phase = '', detail = '') {
        this.phase_ = phase;
        if (this.key) {
            try {
                await sendReaction(this.jid, '⏳', this.key);
            } catch (_) {}
        }
    }

    async update(percent, detail = '') {
        // No-op para no saturar con llamadas de red
    }

    async phase(phase, detail = '') {
        this.phase_ = phase;
    }

    /**
     * Reacciona con ✅ al terminar exitosamente la tarea.
     */
    async done(detail = '') {
        this.ended = true;
        if (this.key) {
            try {
                await sendReaction(this.jid, '✅', this.key);
            } catch (_) {}
        }
    }

    /**
     * Reacciona con ❌ al fallar y lanza el error con mensaje descriptivo.
     */
    async fail(reason = '') {
        this.ended = true;
        if (this.key) {
            try {
                await sendReaction(this.jid, '❌', this.key);
            } catch (_) {}
        }
        const err = new Error(reason);
        err.userMessage = reason;
        throw err;
    }
}

// ─── Helper: ejecutar proceso con streaming eficiente ─────────────────────────

/**
 * Ejecuta un proceso hijo con buffers circulares acotados para evitar acumulación
 * excesiva de cadenas de texto en memoria RAM.
 *
 * @param {string}   cmd        - Comando a ejecutar ('yt-dlp', 'ffmpeg', etc.)
 * @param {string[]} args       - Argumentos
 * @param {object}   opts       - Opciones de spawn + { timeout }
 * @param {Function} onProgress - Callback opcional
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
            const chunk = d.toString();
            // Acotar stdout a máximo 30KB en memoria
            if (stdout.length < 30000) {
                stdout += chunk;
            } else {
                stdout = stdout.slice(-15000) + chunk;
            }
        });

        child.stderr.on('data', (d) => {
            const chunk = d.toString();
            // Acotar stderr a máximo 15KB en memoria
            if (stderr.length < 15000) {
                stderr += chunk;
            } else {
                stderr = stderr.slice(-8000) + chunk;
            }

            // Solo parsear regex si realmente hay un callback activo con lógica
            if (typeof onProgress === 'function' && onProgress.length > 0) {
                const ytMatch = chunk.match(/\[download\]\s+(\d+\.?\d*)%\s+of\s+~?\s*(\S+)/);
                if (ytMatch) {
                    onProgress(parseFloat(ytMatch[1]), ytMatch[2]);
                    return;
                }

                const ffMatch = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/);
                if (ffMatch) {
                    const secs = parseInt(ffMatch[1]) * 3600 + parseInt(ffMatch[2]) * 60 + parseFloat(ffMatch[3]);
                    onProgress(-1, `${Math.floor(secs)}s procesados`);
                }
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
