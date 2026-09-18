'use strict';

const logger = require('../services/logger');
const { sendText } = require('../services/evolution');

/**
 * Cola de tareas con 3 niveles de prioridad.
 *
 * Tiers:
 *   - light:  Sticker, QR, OCR, efectos         (concurrency 4)
 *   - heavy:  yt-dlp, whisper, ffmpeg, spotdl    (concurrency 2)
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
            };
        }
    }

    /**
     * Agrega una tarea a la cola del tier correspondiente.
     * @param {string}   userId   - Identificador del usuario (JID)
     * @param {Function} task     - Función async
     * @param {string}   tierName - 'light' o 'heavy'
     * @param {string}   taskName - Nombre de la tarea para mostrar al usuario
     * @returns {Promise}
     */
    add(userId, task, tierName = 'heavy', taskName = 'Tarea') {
        const tier = this.tiers[tierName];
        if (!tier) {
            logger.warn(`Tier desconocido "${tierName}", usando heavy`);
            return this.add(userId, task, 'heavy', taskName);
        }

        const userTotal = tier.userCount[userId] ?? 0;

        if (userTotal >= tier.maxPerUser) {
            return Promise.reject(
                new Error(
                    `hay ${userTotal} tareas en espera espera a que terminen antes de agregar mas`
                )
            );
        }

        tier.userCount[userId] = userTotal + 1;

        return new Promise((resolve, reject) => {
            tier.pending.push({ task, resolve, reject, userId });
            logger.queue(`[${tierName}] +1 para ${userId} | pendientes: ${tier.pending.length} | corriendo: ${tier.running}/${tier.concurrency}`);
            
            // Si la herramienta está ocupada, avisarle al usuario su lugar en la fila
            if (tier.running >= tier.concurrency) {
                const pos = tier.pending.length;
                // Mensaje de cola eliminado; ahora se representa con la reacción ⏳
            }

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
const queue = new TieredQueue({
    light: {
        concurrency: 4,
        maxPerUser: parseInt(process.env.MAX_QUEUE_PER_USER ?? '5', 10),
    },
    heavy: {
        concurrency: 2,
        maxPerUser: parseInt(process.env.MAX_QUEUE_PER_USER ?? '3', 10),
    },
});

module.exports = queue;
