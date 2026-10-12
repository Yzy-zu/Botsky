'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const logger = require('../services/logger');

const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';
const FONT_FILE = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';

/**
 * Descarga una miniatura a un archivo temporal local.
 * Si falla o da error de red/timeout, retorna false.
 */
async function downloadThumbnail(url, destPath) {
    if (!url) return false;
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(4000)
        });
        if (!res.ok) return false;
        const arrayBuf = await res.arrayBuffer();
        fs.writeFileSync(destPath, Buffer.from(arrayBuf));
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Genera un collage con las miniaturas de los videos numeradas del 1 al N.
 * 
 * @param {Array<{ title: string, thumbnailUrl?: string }>} items
 * @param {string} [outputPath] - Ruta opcional donde guardar el archivo final
 * @returns {Promise<string|null>} Ruta del archivo de imagen generado o null si falla
 */
async function generateThumbnailCollage(items, outputPath = null) {
    if (!items || !Array.isArray(items) || items.length === 0) {
        return null;
    }

    const hasAnyThumbnail = items.some(item => item && item.thumbnailUrl && typeof item.thumbnailUrl === 'string');
    if (!hasAnyThumbnail) {
        return null;
    }

    const n = Math.min(items.length, 8);
    const subItems = items.slice(0, n);
    const sessionId = `thumb-collage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const finalPath = outputPath || path.join(TMP_DIR, `${sessionId}.jpg`);

    const tempFiles = [];

    try {
        fs.mkdirSync(TMP_DIR, { recursive: true });

        // 1. Descargar miniaturas en paralelo
        const downloadedMap = await Promise.all(subItems.map(async (item, idx) => {
            const tempPath = path.join(TMP_DIR, `${sessionId}-item-${idx}.jpg`);
            tempFiles.push(tempPath);
            const success = await downloadThumbnail(item.thumbnailUrl, tempPath);
            return { idx, success, tempPath };
        }));

        // 2. Construir argumentos para FFmpeg
        const inputs = [];
        const filterChains = [];
        const fontArg = fs.existsSync(FONT_FILE) ? `:fontfile=${FONT_FILE}` : '';

        const W = 320;
        const H = 180;
        const cols = n === 1 ? 1 : 2;
        const positions = [];

        for (let i = 0; i < n; i++) {
            const dl = downloadedMap[i];
            if (dl && dl.success && fs.existsSync(dl.tempPath)) {
                inputs.push('-i', dl.tempPath);
            } else {
                // Fallback si la miniatura falló al descargar: fondo oscuro neutro
                inputs.push('-f', 'lavfi', '-i', `color=c=0x1E1E1E:s=${W}x${H}:d=1`);
            }

            // Escalar a 320x180 (forzando recorte si no es 16:9) y sobreponer número de alto contraste
            filterChains.push(
                `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
                `drawtext=text='${i + 1}':fontcolor=white:fontsize=36:box=1:boxcolor=black@0.85:boxborderw=8:x=12:y=12${fontArg}[v${i}]`
            );

            const col = i % cols;
            const row = Math.floor(i / cols);
            positions.push(`${col * W}_${row * H}`);
        }

        let finalFilter = '';
        if (n === 1) {
            finalFilter = `${filterChains[0]};[v0]copy[out]`;
        } else {
            const xstackInputs = filterChains.map((_, i) => `[v${i}]`).join('');
            const xstackLayout = positions.join('|');
            finalFilter = `${filterChains.join(';')};${xstackInputs}xstack=inputs=${n}:layout=${xstackLayout}:fill=black[out]`;
        }

        const ffmpegArgs = [
            '-y',
            ...inputs,
            '-filter_complex', finalFilter,
            '-map', '[out]',
            '-frames:v', '1',
            '-update', '1',
            '-q:v', '3',
            finalPath
        ];

        await new Promise((resolve, reject) => {
            execFile('ffmpeg', ffmpegArgs, { timeout: 15000 }, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });

        if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 0) {
            return finalPath;
        }

        return null;
    } catch (err) {
        logger.error('[thumbnailCollage] Error generando collage:', err.message);
        return null;
    } finally {
        // Limpiar archivos temporales de miniaturas individuales
        for (const file of tempFiles) {
            try {
                if (fs.existsSync(file)) fs.unlinkSync(file);
            } catch (_) {}
        }
    }
}

module.exports = {
    generateThumbnailCollage,
    downloadThumbnail
};
