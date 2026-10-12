'use strict';

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const logger = require('./logger');
const { registerTask } = require('./scheduler');
const db = require('./db');

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

const SCHOOL_MEDIA_DIR = path.join(process.cwd(), 'data', 'school_media');
// Limpiar imágenes escolares de tareas de más de 7 días (604800000 ms)
const MAX_SCHOOL_MEDIA_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function cleanSchoolMediaDirectory() {
    try {
        if (!fsSync.existsSync(SCHOOL_MEDIA_DIR)) return;

        const files = await fs.readdir(SCHOOL_MEDIA_DIR);
        const now = Date.now();
        let deletedCount = 0;

        for (const file of files) {
            const filePath = path.join(SCHOOL_MEDIA_DIR, file);
            try {
                const stats = await fs.stat(filePath);
                if (now - stats.mtimeMs > MAX_SCHOOL_MEDIA_AGE_MS) {
                    await fs.unlink(filePath);
                    deletedCount++;
                }
            } catch (_) {}
        }

        if (deletedCount > 0) {
            logger.info(`🧹 Limpieza completada: se eliminaron ${deletedCount} imágenes residuales en ${SCHOOL_MEDIA_DIR}`);
        }
    } catch (err) {
        logger.error('Error leyendo directorio de multimedia escolar para limpieza:', err);
    }
}

async function runWalCheckpoint() {
    try {
        if (db && typeof db.checkpointWal === 'function') {
            await db.checkpointWal();
        }
    } catch (err) {
        logger.error('Error ejecutando checkpoint WAL en scheduler:', err);
    }
}

function startCleanupCron() {
    // Ejecutar limpieza y checkpoint al iniciar
    cleanTempDirectory().catch(() => {});
    cleanSchoolMediaDirectory().catch(() => {});
    runWalCheckpoint().catch(() => {});

    // Ejecutar coordinado en el scheduler (PERF-2)
    registerTask('temp-dir-cleanup', 720, cleanTempDirectory);
    registerTask('school-media-cleanup', 720, cleanSchoolMediaDirectory);
    registerTask('sqlite-wal-checkpoint', 60, runWalCheckpoint);
    logger.info('🕒 Cronjob de limpieza temporal e higiene WAL inicializado');
}

module.exports = {
    startCleanupCron,
    cleanTempDirectory,
    cleanSchoolMediaDirectory,
    runWalCheckpoint
};
