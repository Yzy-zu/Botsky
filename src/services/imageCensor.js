'use strict';

const { execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const logger = require('./logger');

/**
 * Genera una versión censurada (pixelada + desenfocada) de una imagen usando FFmpeg
 * de manera asíncrona y no bloqueante para el event loop.
 *
 * @param {string} inputPath - Ruta absoluta de la imagen original (JPG, PNG, WEBP, etc.)
 * @param {string} [outputPath] - Ruta de salida opcional. Si no se especifica, se crea en TMP_DIR.
 * @param {object} [options] - Opciones adicionales (filtro, intensidad).
 * @returns {Promise<string>} Ruta absoluta de la imagen censurada generada.
 */
async function generateCensoredImage(inputPath, outputPath = null, options = {}) {
    if (!inputPath || typeof inputPath !== 'string') {
        throw new Error('inputPath es requerido y debe ser una cadena válida');
    }

    if (!fs.existsSync(inputPath)) {
        throw new Error(`El archivo de imagen no existe: ${inputPath}`);
    }

    const tmpDir = process.env.TMP_DIR || path.join(os.tmpdir(), 'whatsapp-bot');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    const targetOutput = outputPath || path.join(
        tmpDir,
        `censored_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
    );

    // Filtro de censura blindado:
    // 1. Pixelado agresivo (pixelize w=36:h=36) que descompone cualquier anatomía o detalle fino.
    // 2. Barra negra opaca en la zona central media (drawbox x=0 y=ih*0.38 w=iw h=ih*0.24 color=black@0.95).
    // 3. Sello humorístico de censura centrado con drawtext.
    const defaultPrimaryFilter =
        'pixelize=w=36:h=36,' +
        'drawbox=x=0:y=ih*0.38:w=iw:h=ih*0.24:color=black@0.95:t=fill,' +
        "drawtext=text='CENSURADO POR BOTSKY (COOPEREN XP)':fontcolor=white:fontsize=h/22:x=(w-text_w)/2:y=h*0.38+(h*0.24-text_h)/2";

    const primaryFilter = options.filter || defaultPrimaryFilter;

    return new Promise((resolve, reject) => {
        execFile('ffmpeg', [
            '-y',
            '-i', inputPath,
            '-vf', primaryFilter,
            '-frames:v', '1',
            targetOutput
        ], (err, stdout, stderr) => {
            if (err) {
                logger.warn(`[IMAGE-CENSOR] Filtro primario con drawtext falló (${err.message}). Probando fallback con barra negra sólida y pixelado.`);
                // Fallback 1: Si drawtext falla por tema de fuentes/freetype, mantener la barra negra sólida y el pixelado
                const fallbackBox = 'pixelize=w=36:h=36,drawbox=x=0:y=ih*0.38:w=iw:h=ih*0.24:color=black:t=fill';
                execFile('ffmpeg', [
                    '-y',
                    '-i', inputPath,
                    '-vf', fallbackBox,
                    '-frames:v', '1',
                    targetOutput
                ], (err2) => {
                    if (!err2) return resolve(targetOutput);

                    logger.warn(`[IMAGE-CENSOR] Fallback con pixelize falló (${err2.message}). Intentando fallback con escala inversa y boxblur.`);
                    // Fallback 2: Escala a baja resolución extrema + boxblur profundo + barra negra
                    const fallbackScale = 'scale=iw/28:ih/28:flags=neighbor,scale=iw:ih:flags=neighbor,boxblur=20:5,drawbox=x=0:y=ih*0.38:w=iw:h=ih*0.24:color=black:t=fill';
                    execFile('ffmpeg', [
                        '-y',
                        '-i', inputPath,
                        '-vf', fallbackScale,
                        '-frames:v', '1',
                        targetOutput
                    ], (err3) => {
                        if (err3) {
                            logger.error(`[IMAGE-CENSOR] Fallback final de censura falló: ${err3.message}`);
                            return reject(err3);
                        }
                        resolve(targetOutput);
                    });
                });
                return;
            }
            resolve(targetOutput);
        });
    });
}

module.exports = {
    generateCensoredImage
};
