'use strict';

const { execSync } = require('child_process');
const { sendText } = require('../services/evolution');
const logger = require('../services/logger');

/**
 * Apaga el servidor de forma limpia.
 * Solo ejecutable por números en ALLOWED_NUMBERS_ADMIN.
 */
async function handleApagar(from) {
    logger.warn(`[SISTEMA] Apagado remoto solicitado por ${from}`);

    try {
        await sendText(from, '✅ apagando el server ahorita... hasta luego 👋');
    } catch (_) {
        // Si falla el mensaje no importa, igual apagamos
    }

    // Pequeña pausa para que el mensaje salga antes de cortar
    setTimeout(() => {
        try {
            // Usando la contraseña de sudo proporcionada
            execSync('echo "" | sudo -S /sbin/shutdown -h now', { stdio: 'ignore' });
        } catch (err) {
            logger.error('[SISTEMA] Error al ejecutar shutdown:', err);
        }
    }, 2000);
}

module.exports = { handleApagar };
