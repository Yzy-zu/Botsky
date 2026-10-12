'use strict';

const logger = require('../services/logger');
const { sendText } = require('../services/evolution');

/**
 * Cola de tareas con 2 tiers y sub-prioridad dentro de cada tier.
 *
 * Tiers:
 *   - light:  Sticker, QR, OCR, efectos         (concurrency 4)
 *   - heavy:  yt-dlp, whisper, ffmpeg, spotdl    (concurrency 2)
 *
 * Prioridad dentro del tier (parámetro `priority` en add()):
 *   - 0 (normal): comportamiento FIFO habitual (descargas largas, etc.)
 *   - 1 (alta):   salta al frente de la cola del tier (transcripciones, efectos de voz, etc.)
 *
 * Comandos que no pasan por cola (directos): ayuda, info, nivel, top, moderación
 */
class TieredQueue {
    /**
     * @param {object} config - { tierName: { concurrency, maxPerUser } }
     */
    constructor(config) {
        this.tiers = {};
        for (const [name, opts] of Object.entries(config)) {
            this.tiers[name] = {
                concurrency: opts.concurrency,
                maxPerUser: opts.maxPerUser,
                running: 0,
                pending: [],
                userCount: {},
                _lastUpdated: new Date().toISOString(),
            };
        }
        
        // Limpieza periódica de userCounts antiguos
        this._cleanupInterval = setInterval(() => {
            this._cleanupOldUserCounts();
        }, 60 * 60 * 1000); // Cada hora
        if (this._cleanupInterval && typeof this._cleanupInterval.unref === 'function') {
            this._cleanupInterval.unref();
        }
    }
    
    _cleanupOldUserCounts() {
        const now = new Date();
        const hoursToKeep = 24;
        
        for (const tier of Object.values(this.tiers)) {
            const lastUpdated = new Date(tier._lastUpdated);
            if ((now - lastUpdated) > hoursToKeep * 60 * 60 * 1000) {
                tier.userCount = {};
                tier._lastUpdated = now.toISOString();
                logger.queue(`[${Object.keys(this.tiers).find(k => this.tiers[k] === tier)}] Limpieza de userCounts inactivos`);
            }
        }
    }
    
    destroy() {
        clearInterval(this._cleanupInterval);
    }

    /**
     * Agrega una tarea a la cola del tier correspondiente.
     * @param {string}   userId   - Identificador del usuario (JID)
     * @param {Function} task     - Función async
     * @param {string}   tierName - 'light' o 'heavy'
     * @param {string}   taskName - Nombre de la tarea para mostrar al usuario
     * @param {object}   [opts]   - Opciones adicionales: { priority: 0|1 }
     * @returns {Promise}
     */
    add(userId, task, tierName = 'heavy', taskName = 'Tarea', opts = {}) {
        const tier = this.tiers[tierName];
        if (!tier) {
            logger.warn(`Tier desconocido "${tierName}", usando heavy`);
            return this.add(userId, task, 'heavy', taskName, opts);
        }

        const userTotal = tier.userCount[userId] ?? 0;

        if (userTotal >= tier.maxPerUser) {
            return Promise.reject(
                new Error(
                    `> ⏳ Tienes ${userTotal} tareas en espera. Aguanta a que terminen antes de agregar más.`
                )
            );
        }

        tier.userCount[userId] = userTotal + 1;

        // Arq #4 fix: prioridad por tarea dentro del mismo tier.
        // priority=1 (alta) se inserta al inicio; priority=0 (normal) al final.
        // Permite que transcripciones cortas salten delante de descargas largas
        // sin necesidad de crear un tier intermedio.
        const priority = (typeof opts?.priority === 'number') ? opts.priority : 0;

        return new Promise((resolve, reject) => {
            const entry = { task, resolve, reject, userId, priority };

            if (priority > 0 && tier.pending.length > 0) {
                // Inserción ordenada: buscar el primer item de igual o menor prioridad
                // y colocar el nuevo entry justo antes de él.
                const insertAt = tier.pending.findIndex(e => e.priority < priority);
                if (insertAt === -1) {
                    tier.pending.push(entry);
                } else {
                    tier.pending.splice(insertAt, 0, entry);
                }
            } else {
                tier.pending.push(entry);
            }

            logger.queue(`[${tierName}] +1 (prio:${priority}) para ${userId} | pendientes: ${tier.pending.length} | corriendo: ${tier.running}/${tier.concurrency}`);

            this._run(tierName);
        });
    }

    _run(tierName) {
        const tier = this.tiers[tierName];

        while (tier.running < tier.concurrency && tier.pending.length > 0) {
            const { task, resolve, reject, userId } = tier.pending.shift();
            tier.running++;

            (async () => {
                try {
                    const result = await task();
                    resolve(result);
                } catch (err) {
                    reject(err);
                } finally {
                    tier.running--;
                    tier.userCount[userId] = Math.max(0, (tier.userCount[userId] ?? 1) - 1);
                    if (tier.userCount[userId] === 0) delete tier.userCount[userId];
                    logger.queue(`[${tierName}] tarea de ${userId} terminada | corriendo: ${tier.running}/${tier.concurrency}`);
                    this._run(tierName);
                }
            })();
        }
    }

    get stats() {
        const result = {};
        for (const [name, tier] of Object.entries(this.tiers)) {
            result[name] = {
                running: tier.running,
                pending: tier.pending.length,
                concurrency: tier.concurrency,
                users: { ...tier.userCount },
            };
        }
        return result;
    }
}


// ─── Instancia global ─────────────────────────────────────────────────────────
// Func #5 fix: cada tier lee su propia variable de entorno para que el diferencial
// protector (light más permisivo que heavy) se preserve al configurar límites custom.
// Retrocompatible: ambas hacen fallback a MAX_QUEUE_PER_USER si no se define la específica.
const queue = new TieredQueue({
    light: {
        concurrency: 4,
        maxPerUser: parseInt(process.env.MAX_QUEUE_LIGHT ?? process.env.MAX_QUEUE_PER_USER ?? '5', 10),
    },
    heavy: {
        concurrency: 2,
        maxPerUser: parseInt(process.env.MAX_QUEUE_HEAVY ?? process.env.MAX_QUEUE_PER_USER ?? '3', 10),
    },
});

queue.TieredQueue = TieredQueue;

module.exports = queue;
