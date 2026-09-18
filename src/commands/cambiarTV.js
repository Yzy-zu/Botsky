'use strict';

const { execSync } = require('child_process');
const { sendText } = require('../services/evolution');
const logger = require('../services/logger');

async function cambiarTele(from, telesita) {
    try {
        await sendText(from, 'Cambiando de canal...');
    } catch (err) {
        logger.warn('[TV] Error enviando mensaje de confirmación:', err.message);
    }

    try {
        execSync(`cd ~/tv && bash cambiarcanal.sh ${telesita}`, { stdio: 'ignore' });
        logger.info(`[TV] Canal cambiado a: ${telesita}`);
    } catch (err) {
        logger.error('[TV] Error ejecutando cambiarcanal.sh:', err.message);
    }
}

module.exports = { cambiarTele };
