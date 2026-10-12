'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const logger = require('./logger');
const { createRikolinoReader } = require('./rikolinoLibrary');

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm']);

/**
 * Descarga una imagen desde una URL pública y la guarda en un archivo temporal.
 *
 * @param {string} url - URL de la imagen
 * @returns {Promise<string>} Ruta absoluta del archivo temporal guardado
 */
async function downloadImageToTemp(url) {
    const tmpDir = process.env.TMP_DIR || path.join(os.tmpdir(), 'whatsapp-bot');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    const extMatch = url.match(/\.(jpe?g|png|webp)(?:\?.*)?$/i);
    const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '.jpg';
    const tempFile = path.join(tmpDir, `pack_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);

    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 8000,
        maxContentLength: 50 * 1024 * 1024,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Botsky/1.0'
        }
    });

    const buffer = Buffer.from(res.data);
    if (!buffer || buffer.length === 0) {
        throw new Error(`Buffer vacío recibido de ${url}`);
    }

    await fs.promises.writeFile(tempFile, buffer);
    return tempFile;
}

/**
 * Sanea y extrae una categoría limpia eliminando preposiciones, muletillas y palabras de cortesía.
 *
 * @param {string} rawCat
 * @returns {string|null}
 */
function cleanCategory(rawCat) {
    if (!rawCat || typeof rawCat !== 'string') return null;
    let cat = rawCat.trim().replace(/^[,\s.!?]+|[,\s.!?]+$/g, '');
    cat = cat.replace(/^de\s+/i, '').replace(/[\/\\]/g, '').trim();
    cat = cat.replace(/\s+(?:por\s+favor|porfa|porfis|paro|pls|plox|please|wey?|compa|carnal)$/i, '').trim();
    if (/^(?:por\s+favor|porfa|porfis|paro|pls|plox|please|wey?|compa|carnal)$/i.test(cat) || !cat) {
        return null;
    }
    return cat.replace(/[.!?,;:]+$/g, '').trim().toLowerCase() || null;
}

/**
 * Obtiene imágenes disponibles de la carpeta local (/home/petrov/fotos o FOTOS_DIR).
 * Soporta archivos directos y subdirectorios por categoría, con filtro anti-repetición.
 *
 * @param {string} [customDir] - Directorio alternativo opcional para pruebas
 * @param {number} [count=5] - Cantidad máxima a obtener
 * @param {string} [category=null] - Categoría opcional para priorizar nombres
 * @param {string[]|Set<string>} [excludePhotoIds=[]] - IDs o nombres de archivos ya entregados
 * @returns {{ id: string, path: string, source: 'local', isTemporary: false, deckCycled?: boolean }[]}
 */
function getLocalPackImages(customDir = null, count = 5, category = null, excludePhotoIds = []) {
    const dir = customDir || process.env.FOTOS_DIR || '/home/petrov/fotos';

    try {
        if (!fs.existsSync(dir)) {
            return [];
        }

        const baseDir = path.resolve(dir);
        let searchDir = baseDir;
        const cleanCat = cleanCategory(category);
        if (cleanCat && !cleanCat.includes('..')) {
            const subDir = path.resolve(baseDir, cleanCat);
            if (subDir.startsWith(baseDir + path.sep) && fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
                searchDir = subDir;
            }
        }

        const entries = fs.readdirSync(searchDir, { withFileTypes: true });
        let images = [];
        for (const entry of entries) {
            if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (SUPPORTED_EXTENSIONS.has(ext)) {
                    images.push(entry.name);
                }
            } else if (entry.isDirectory() && (!cleanCat || entry.name.toLowerCase().includes(cleanCat))) {
                try {
                    const subFiles = fs.readdirSync(path.join(searchDir, entry.name));
                    for (const sf of subFiles) {
                        const ext = path.extname(sf).toLowerCase();
                        if (SUPPORTED_EXTENSIONS.has(ext)) {
                            images.push(path.join(entry.name, sf));
                        }
                    }
                } catch (_) {}
            }
        }

        if (images.length === 0) {
            return [];
        }

        // Si se especificó categoría y no usamos ya un subdirectorio dedicado,
        // filtrar estrictamente por la categoría
        if (cleanCat && searchDir === baseDir) {
            images = images.filter(f => f.toLowerCase().includes(cleanCat));
        }

        if (images.length === 0) {
            return [];
        }

        // Filtro anti-repetición (Sampling without replacement)
        const excludeSet = new Set(
            Array.isArray(excludePhotoIds) || excludePhotoIds instanceof Set ? excludePhotoIds : []
        );

        let selectedFiles = [];
        let deckCycled = false;

        if (excludeSet.size > 0) {
            const unseen = images.filter(f => !excludeSet.has(f) && !excludeSet.has(path.basename(f)));
            if (unseen.length >= count) {
                selectedFiles = [...unseen];
                // Desordenar unseen
                for (let i = selectedFiles.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [selectedFiles[i], selectedFiles[j]] = [selectedFiles[j], selectedFiles[i]];
                }
            } else if (unseen.length > 0) {
                const seenPool = images.filter(f => excludeSet.has(f) || excludeSet.has(path.basename(f)));
                for (let i = unseen.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [unseen[i], unseen[j]] = [unseen[j], unseen[i]];
                }
                for (let i = seenPool.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [seenPool[i], seenPool[j]] = [seenPool[j], seenPool[i]];
                }
                selectedFiles = [...unseen, ...seenPool];
                deckCycled = true;
            } else {
                // Todas vistas: reinicio de baraja
                selectedFiles = [...images];
                deckCycled = true;
                for (let i = selectedFiles.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [selectedFiles[i], selectedFiles[j]] = [selectedFiles[j], selectedFiles[i]];
                }
            }
        } else {
            selectedFiles = [...images];
            for (let i = selectedFiles.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [selectedFiles[i], selectedFiles[j]] = [selectedFiles[j], selectedFiles[i]];
            }
        }

        const selected = selectedFiles.slice(0, count);
        return selected.map(file => {
            const ext = path.extname(file).toLowerCase();
            const isVideo = ext === '.mp4' || ext === '.webm';
            const mime = ext === '.mp4' ? 'video/mp4' : ext === '.webm' ? 'video/webm' : (ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg');
            return {
                id: path.basename(file),
                path: path.join(searchDir, file),
                mime,
                isVideo,
                source: 'local',
                isTemporary: false,
                deckCycled
            };
        });
    } catch (err) {
        logger.warn(`[PACK-IMAGES] Error leyendo carpeta local (${dir}): ${err.message}`);
        return [];
    }
}

/**
 * Obtiene imágenes de fuentes públicas de internet con manejo silencioso de errores.
 * Intenta meme-api (por categoría o general) y luego picsum.photos como respaldo.
 *
 * @param {string} [category=null] - Categoría opcional
 * @param {number} [count=3] - Cantidad requerida
 * @returns {Promise<{ path: string, source: 'web', isTemporary: true }[]>}
 */
async function getWebPackImages(category = null, count = 3) {
    const results = [];
    const seenUrls = new Set();
    const needed = Math.max(1, count);
    const cleanCat = cleanCategory(category);

    // Helper para consultar meme-api
    const fetchMemesFromEndpoint = async (endpoint) => {
        try {
            const memeRes = await axios.get(endpoint, {
                timeout: 7000,
                headers: { 'User-Agent': 'Botsky/1.0' }
            });

            const memes = Array.isArray(memeRes.data?.memes)
                ? memeRes.data.memes
                : (memeRes.data?.url ? [memeRes.data] : []);

            for (const item of memes) {
                if (item?.url && !seenUrls.has(item.url) && results.length < needed) {
                    seenUrls.add(item.url);
                    try {
                        const savedPath = await downloadImageToTemp(item.url);
                        results.push({ path: savedPath, source: 'web', isTemporary: true });
                    } catch (dlErr) {
                        logger.warn(`[PACK-IMAGES] Error descargando meme ${item.url}: ${dlErr.message}`);
                    }
                }
            }
        } catch (apiErr) {
            logger.warn(`[PACK-IMAGES] Error consultando meme-api (${endpoint}): ${apiErr.message}`);
        }
    };

    // 1. Intentar con meme-api por categoría (si se proporcionó)
    if (cleanCat) {
        await fetchMemesFromEndpoint(`https://meme-api.com/gimme/${encodeURIComponent(cleanCat)}/${needed}`);
    }

    // 2. Si no hay categoría o no arrojó suficientes, intentar endpoint general de meme-api
    if (results.length < needed) {
        const remainingMemes = needed - results.length;
        await fetchMemesFromEndpoint(`https://meme-api.com/gimme/${remainingMemes}`);
    }

    // 3. Si aún faltan imágenes, recurrir a picsum.photos con seeds únicos en paralelo
    if (results.length < needed) {
        const remaining = needed - results.length;
        const downloadPromises = [];
        for (let i = 0; i < remaining; i++) {
            const seed = `botsky_pack_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`;
            const picsumUrl = `https://picsum.photos/seed/${seed}/800/600`;
            downloadPromises.push(
                downloadImageToTemp(picsumUrl)
                    .then(savedPath => ({ path: savedPath, source: 'web', isTemporary: true }))
                    .catch(picErr => {
                        logger.warn(`[PACK-IMAGES] Fallback picsum falló (seed ${seed}): ${picErr.message}`);
                        return null;
                    })
            );
        }
        const downloaded = await Promise.all(downloadPromises);
        for (const item of downloaded) {
            if (item && results.length < needed) {
                results.push(item);
            } else if (item && item.isTemporary && item.path) {
                fs.promises.unlink(item.path).catch(() => {});
            }
        }
    }

    return results;
}

/**
 * Fuente predeterminada: álbumes publicados de Rikolino, sin respaldo web.
 * customDir explícito conserva el proveedor local/web legado para pruebas.
 *
 * @param {string} [category=null] - Categoría o tema opcional
 * @param {object} [options={}] - Opciones ({ count, customDir })
 * @returns {Promise<{ path: string, source: 'rikolino'|'local'|'web', isTemporary: boolean }[]>}
 */
async function getPackImages(category = null, options = {}) {
    const targetCount = options.count ?? (Math.floor(Math.random() * 3) + 3); // 3 a 5 imágenes
    const excludePhotoIds = options.excludePhotoIds || [];

    const activeCustomDir = options.customDir || process.env.FOTOS_DIR;
    if (!activeCustomDir) {
        return createRikolinoReader().getImages(cleanCategory(category), {
            count: targetCount,
            randomize: true,
            excludePhotoIds
        });
    }

    // 1. Proveedor legado solo cuando customDir o FOTOS_DIR se solicita explícitamente
    const local = getLocalPackImages(activeCustomDir, targetCount, category, excludePhotoIds);
    if (local.length >= targetCount) {
        return local.slice(0, targetCount);
    }

    // 2. Si faltan archivos, complementar desde la web
    const neededFromWeb = targetCount - local.length;
    let web = [];
    try {
        web = await getWebPackImages(category, neededFromWeb);
    } catch (err) {
        logger.warn(`[PACK-IMAGES] Error obteniendo imágenes web de respaldo: ${err.message}`);
    }

    const combined = [...local, ...web];
    return combined.slice(0, targetCount);
}

module.exports = {
    getPackImages,
    getLocalPackImages,
    getWebPackImages,
    downloadImageToTemp,
    cleanCategory,
    SUPPORTED_EXTENSIONS
};
