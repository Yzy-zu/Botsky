'use strict';

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const logger = require('./logger');

const TEMP_DIR = process.env.TMP_DIR || '/tmp/whatsapp-bot';
// Limpiar archivos de más de 2 horas (7200000 ms)
const MAX_AGE_MS = 2 * 60 * 60 * 1000; 

async function cleanTempDirectory() {
    try {
        if (!fsSync.existsSync(TEMP_DIR)) return;

        const files = await fs.readdir(TEMP_DIR);
        const now = Date.now();
        let deletedCount = 0;

        for (const file of files) {
            const filePath = path.join(TEMP_DIR, file);
            try {
                const stats = await fs.stat(filePath);
                if (now - stats.mtimeMs > MAX_AGE_MS) {
                    await fs.unlink(filePath);
                    deletedCount++;
                }
            } catch (err) {
                // ignorar si el archivo fue borrado por otra promesa en paralelo
            }
        }

        if (deletedCount > 0) {
            logger.info(`🧹 Limpieza completada: se eliminaron ${deletedCount} archivos residuales en ${TEMP_DIR}`);
        }
    } catch (err) {
        logger.error('Error leyendo directorio temporal para limpieza:', err);
    }
}

function startCleanupCron() {
    // Ejecutar limpieza al iniciar
    cleanTempDirectory();
    // Ejecutar cada 12 horas (43200000 ms)
    setInterval(cleanTempDirectory, 12 * 60 * 60 * 1000);
    logger.info('🕒 Cronjob de limpieza temporal inicializado (cada 12 horas)');
}

module.exports = {
    startCleanupCron,
};
