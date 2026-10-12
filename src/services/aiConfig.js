'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../../data/ai_config.json');

let cachedConfig = null;
let lastMtime = 0;
let lastCheck = 0;

/**
 * Lee la configuración dinámica de IA para Botsky.
 * Utiliza caché en memoria con invalidación basada en mtime (TTL 2 segundos).
 * Si el archivo no existe, devuelve un objeto vacío de forma transparente.
 *
 * @returns {object} Configuración activa
 */
function getAiConfig() {
    const now = Date.now();
    if (now - lastCheck < 2000 && cachedConfig) {
        return cachedConfig;
    }
    lastCheck = now;

    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return cachedConfig || {};
        }
        const stat = fs.statSync(CONFIG_FILE);
        if (stat.mtimeMs !== lastMtime || !cachedConfig) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
            cachedConfig = JSON.parse(raw);
            lastMtime = stat.mtimeMs;
        }
        return cachedConfig || {};
    } catch {
        return cachedConfig || {};
    }
}

module.exports = {
    getAiConfig,
    CONFIG_FILE
};
