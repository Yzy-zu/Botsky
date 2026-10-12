'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const logger = require('./logger');
const { createRikolinoReader } = require('./rikolinoLibrary');
const { cleanCategory } = require('./packImages');

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Obtiene una imagen de la carpeta local configurada (/home/petrov/fotos o FOTOS_DIR), con filtro anti-repetición.
 *
 * @param {string} [customDir] - Directorio alternativo opcional para pruebas
 * @param {string[]|Set<string>} [excludePhotoIds=[]] - IDs o nombres de archivos ya entregados
 * @returns {{ id: string, path: string, source: 'local', isTemporary: false, deckCycled?: boolean } | null}
 */
function getLocalImage(customDir = null, excludePhotoIds = []) {
    const dir = customDir || process.env.FOTOS_DIR || '/home/petrov/fotos';

    try {
        if (!fs.existsSync(dir)) {
            return null;
        }

        const entries = fs.readdirSync(dir);
        const images = entries.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return SUPPORTED_EXTENSIONS.has(ext);
        });

        if (images.length === 0) {
            return null;
        }

        const excludeSet = new Set(
            Array.isArray(excludePhotoIds) || excludePhotoIds instanceof Set ? excludePhotoIds : []
        );

        let candidates = images;
        let deckCycled = false;

        if (excludeSet.size > 0) {
            const unseen = images.filter(file => !excludeSet.has(file) && !excludeSet.has(path.basename(file)));
            if (unseen.length > 0) {
                candidates = unseen;
            } else {
                // Todas las fotos ya vistas: reiniciar baraja
                candidates = images;
                deckCycled = true;
            }
        }

        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        return {
            id: path.basename(chosen),
            path: path.join(dir, chosen),
            source: 'local',
            isTemporary: false,
            deckCycled
        };
    } catch (err) {
        logger.warn(`[COOPERACHA-IMAGES] Error leyendo carpeta local (${dir}): ${err.message}`);
        return null;
    }
}

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
    const tempFile = path.join(tmpDir, `coop_orig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);

    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 8000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Botsky/1.0'
        }
    });

    await fs.promises.writeFile(tempFile, Buffer.from(res.data));
    return tempFile;
}

/**
 * Obtiene una imagen de fuentes públicas de internet (Reddit JSON público, meme-api o picsum)
 * con manejo silencioso de errores de red.
 *
 * @param {string} [category] - Categoría o búsqueda opcional (ej: 'memes', 'gatos', 'cats')
 * @returns {Promise<{ path: string, source: 'web', isTemporary: true } | null>}
 */
async function getWebImage(category = null) {
    try {
        // 1. Si el usuario especificó una categoría, buscar primero por categoría
        if (category && typeof category === 'string' && category.trim()) {
            const cleanCat = category.trim().toLowerCase();
            try {
                const memeRes = await axios.get(`https://meme-api.com/gimme/${encodeURIComponent(cleanCat)}`, {
                    timeout: 6000,
                    headers: { 'User-Agent': 'Botsky/1.0' }
                });
                if (memeRes.data && memeRes.data.url) {
                    const savedPath = await downloadImageToTemp(memeRes.data.url);
                    return { path: savedPath, source: 'web', isTemporary: true };
                }
            } catch (catErr) {
                logger.warn(`[COOPERACHA-IMAGES] Búsqueda por categoría "${cleanCat}" falló en meme-api: ${catErr.message}`);
            }
        }

        // 2. Fallback general a meme-api (meme caliente aleatorio)
        try {
            const randomRes = await axios.get('https://meme-api.com/gimme', {
                timeout: 6000,
                headers: { 'User-Agent': 'Botsky/1.0' }
            });
            if (randomRes.data && randomRes.data.url) {
                const savedPath = await downloadImageToTemp(randomRes.data.url);
                return { path: savedPath, source: 'web', isTemporary: true };
            }
        } catch (rndErr) {
            logger.warn(`[COOPERACHA-IMAGES] Fallback random en meme-api falló: ${rndErr.message}`);
        }

        // 3. Fallback a picsum.photos
        try {
            const picsumUrl = 'https://picsum.photos/800/600';
            const savedPath = await downloadImageToTemp(picsumUrl);
            return { path: savedPath, source: 'web', isTemporary: true };
        } catch (picErr) {
            logger.warn(`[COOPERACHA-IMAGES] Fallback picsum falló: ${picErr.message}`);
        }

        return null;
    } catch (outerErr) {
        logger.warn(`[COOPERACHA-IMAGES] Error general obteniendo imagen web: ${outerErr.message}`);
        return null;
    }
}

/**
 * Gestión híbrida de fuentes de imagen:
 * Prioriza la carpeta local (/home/petrov/fotos) a menos que se especifique categoría
 * o la carpeta local no contenga imágenes válidas.
 *
 * @param {string} [category] - Categoría opcional
 * @param {object} [options] - Opciones (customDir, etc.)
 * @returns {Promise<{ path: string, source: 'local'|'web', isTemporary: boolean } | null>}
 */
async function getCooperachaImage(category = null, options = {}) {
    const customDir = options.customDir || process.env.FOTOS_DIR;
    const excludePhotoIds = options.excludePhotoIds || [];

    if (customDir) {
        const local = getLocalImage(customDir, excludePhotoIds);
        if (local) return local;

        // Fallback a fuentes web públicas solo cuando customDir está presente
        const web = await getWebImage(category);
        if (web) return web;

        return null;
    }

    // Sin customDir: Priorizar imágenes de la biblioteca privada Rikolino (Petrovsky)
    const cleanCat = cleanCategory(category);
    try {
        const rikolinoImages = await createRikolinoReader().getImages(cleanCat, {
            count: 1,
            randomize: true,
            excludePhotoIds
        });
        if (rikolinoImages && rikolinoImages.length > 0) {
            return rikolinoImages[0];
        }
    } catch (err) {
        logger.warn(`[COOPERACHA-IMAGES] Error consultando biblioteca Rikolino: ${err.message}`);
    }

    // Si Rikolino no tiene álbumes publicados o está vacío, probar carpeta local por defecto (solo si no se pidió categoría)
    if (!cleanCat) {
        const local = getLocalImage(null, excludePhotoIds);
        if (local) return local;
    }

    // Fallback a web pública deshabilitado cuando no se proporcione customDir
    return null;
}

module.exports = {
    getLocalImage,
    getWebImage,
    getCooperachaImage,
    downloadImageToTemp,
    SUPPORTED_EXTENSIONS
};
