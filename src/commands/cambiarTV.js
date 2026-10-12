'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { sendText } = require('../services/evolution');
const logger = require('../services/logger');

async function cambiarTele(fromOrParsed, telesitaOrFrom, maybeMessageData) {
    let from;
    let telesita;

    if (typeof fromOrParsed === 'object' && fromOrParsed !== null && (Array.isArray(fromOrParsed.args) || fromOrParsed.flags !== undefined || fromOrParsed.command !== undefined)) {
        from = telesitaOrFrom;
        const argCanal = fromOrParsed.args?.[0];
        telesita = argCanal || 'https://futbol-libres.su/';
    } else {
        from = fromOrParsed;
        telesita = telesitaOrFrom;
    }

    if (!from) {
        logger.warn('[TV] No se especificó destinatario (from) para cambiarTele');
        return;
    }

    const homedir = os.homedir();
    const tvDir = process.env.TV_SCRIPT_DIR || path.join(homedir, 'tv');
    const scriptPath = path.join(tvDir, 'cambiarcanal.sh');

    if (!fs.existsSync(tvDir) || !fs.existsSync(scriptPath)) {
        logger.warn(`[TV] Directorio o script de TV no configurado: ${scriptPath}`);
        return await sendText(from, '> ⚠️ El script de control de TV no está configurado en este servidor.').catch(() => {});
    }

    try {
        await sendText(from, 'Cambiando de canal...');
    } catch (err) {
        logger.warn('[TV] Error enviando mensaje de confirmación:', err.message);
    }

    try {
        // Usar execFile en vez de exec para evitar inyección de shell
        await execFileAsync('bash', ['cambiarcanal.sh', String(telesita || '')], {
            cwd: tvDir,
            timeout: 15_000,
        });
        logger.info(`[TV] Canal cambiado a: ${telesita}`);
    } catch (err) {
        logger.error('[TV] Error ejecutando cambiarcanal.sh:', err.message);
    }
}

const handleCambiarTV = cambiarTele;

module.exports = {
    cambiarTele,
    handleCambiarTV
};
