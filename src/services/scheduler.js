'use strict';

const logger = require('./logger');

const tasks = new Map(); // id -> { fn, intervalMinutes, lastRun, running }
let ticker = null;

/**
 * Registra una tarea de mantenimiento periódico coordinada (PERF-2).
 * @param {string} id - Identificador único de la tarea
 * @param {number} intervalMinutes - Frecuencia de ejecución en minutos (puede ser decimal, ej: 0.16 para 10s)
 * @param {Function} fn - Función síncrona o asíncrona a ejecutar
 */
function registerTask(id, intervalMinutes, fn) {
    if (typeof fn !== 'function') return;
    const num = Number(intervalMinutes);
    const safeInterval = (!isNaN(num) && num > 0) ? num : 1;
    tasks.set(id, {
        fn,
        intervalMinutes: safeInterval,
        lastRun: Date.now(),
        running: false
    });
}

/**
 * Registra una tarea especificando su frecuencia en segundos.
 */
function registerIntervalSeconds(id, seconds, fn) {
    const sec = Math.max(5, Number(seconds) || 10);
    return registerTask(id, sec / 60, fn);
}

function unregisterTask(id) {
    tasks.delete(id);
}

function tick() {
    const now = Date.now();
    for (const [id, task] of tasks.entries()) {
        if (task.running) continue;
        const elapsedMinutes = (now - task.lastRun) / 60000;
        if (elapsedMinutes >= task.intervalMinutes) {
            task.running = true;
            task.lastRun = now;
            try {
                const res = task.fn();
                if (res && typeof res.then === 'function') {
                    res.catch(err => {
                        logger.error(`[SCHEDULER] Error en tarea asíncrona "${id}":`, err?.message || err);
                    }).finally(() => {
                        task.running = false;
                    });
                } else {
                    task.running = false;
                }
            } catch (err) {
                logger.error(`[SCHEDULER] Error en tarea "${id}":`, err?.message || err);
                task.running = false;
            }
        }
    }
}

async function runAllMaintenance() {
    for (const [id, task] of tasks.entries()) {
        try {
            task.lastRun = Date.now();
            await task.fn();
        } catch (err) {
            logger.error(`[SCHEDULER] Error forzando mantenimiento en "${id}":`, err?.message || err);
        }
    }
}

function startScheduler() {
    if (ticker) return;
    // Evaluar cada 10 segundos para tareas de alta precisión como recordatorios
    ticker = setInterval(tick, 10 * 1000);
    ticker.unref();
}

function stopScheduler() {
    if (ticker) {
        clearInterval(ticker);
        ticker = null;
    }
}

// Inicializar automáticamente el ticker maestro unref
startScheduler();

module.exports = {
    registerTask,
    registerIntervalSeconds,
    unregisterTask,
    runAllMaintenance,
    tick,
    startScheduler,
    stopScheduler,
    getRegisteredTasks: () => Array.from(tasks.keys())
};
