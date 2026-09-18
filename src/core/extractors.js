'use strict';

const logger = require('../services/logger');

// ─── Mapa de Expresiones Regulares para Detección de Formatos ────────────────
const FORMAT_REGEX_MAP = [
    // Documentos
    { regex: /\b(pdf|pidief|pidef|pedeefe|pe\s*de\s*efe|pe-de-efe|pdfe|pfd|p\.d\.f)\b/i, fmt: 'pdf' },
    { regex: /\b(docx|word|uord|guor|wor|\.doc)\b/i,                                     fmt: 'docx' },
    { regex: /\b(xlsx|excel|exel|ecel|eksel|hoja\s*de\s*calculo|tabla|tablita)\b/i,      fmt: 'xlsx' },
    { regex: /\b(pptx|ppt|powerpoint|power\s*point|pitor|diapositiva|diapos)\b/i,         fmt: 'pptx' },
    { regex: /\b(odt|libre\s*office)\b/i,                                               fmt: 'odt' },
    { regex: /\b(txt|texto plano|bloc de notas)\b/i,                                    fmt: 'txt' },
    // Medios
    { regex: /\b(mp3|mp\s*tres|audio|musica|cancion|rola|rolita|temazo|temon)\b/i,      fmt: 'mp3' },
    { regex: /\b(mp4|video|videito|videocito|bideo|clip|clipcito|short|reel)\b/i,        fmt: 'mp4' },
    { regex: /\b(ogg|nota de voz|voice note|vn|opus)\b/i,                               fmt: 'ogg' },
    { regex: /\bwav\b/i,                                                                 fmt: 'wav' },
    { regex: /\b(flac|lossless|alta fidelidad)\b/i,                                      fmt: 'flac' },
    { regex: /\bgif\b/i,                                                                 fmt: 'gif' },
    { regex: /\bwebp\b/i,                                                                fmt: 'webp' },
    { regex: /\bm4a\b/i,                                                                 fmt: 'm4a' },
];

const EFECTO_MAP = {
    'ardilla': ['ardilla', 'alvin', 'chillon', 'pitufo', 'agudo', 'raton'],
    'lento':   ['lento', 'despacio', 'tortuga', 'slow', 'retrasado'],
    'grave':   ['grave', 'grueso', 'demonio', 'diablo', 'monstruo', 'ronco', 'hondo', 'oscuro'],
    'rapido':  ['rapido', 'veloz', 'flash', 'acelerado', 'fast'],
    'robot':   ['robot', 'autotune', 'ciborg', 'metalico', 'maquina'],
    'eco':     ['eco', 'cueva', 'estadio', 'repeticion', 'vacio'],
    'reversa': ['reversa', 'al reves', 'invertido', 'vuelta']
};

/**
 * Detecta formatos de audio, video o documento a partir del texto mediante regex.
 */
function detectFormatFromRegex(combinedText) {
    for (const { regex, fmt } of FORMAT_REGEX_MAP) {
        if (regex.test(combinedText)) {
            return fmt;
        }
    }
    return null;
}

/**
 * Extrae modificadores universales y específicos de cada comando (flags).
 */
function extractFlagsAndModifiers(cmd, rawText, combinedText, parsed) {
    if (['convertir', 'descargar'].includes(cmd)) {
        if (combinedText.match(/\b(alta(\s+calidad)?|hq|hd|4k|1080|1080p|720p|720|full\s*hd|excelente|maxima|rica\s*calidad|buena\s*calidad|claro|nitido|chido|perron|pesadito|rico)\b/i)) {
            parsed.flags.q = (cmd === 'descargar') ? '1080' : 'alta';
        } else if (combinedText.match(/\b(baja(\s+calidad)?|mala(\s+calidad)?|ligero|poco\s*peso|comprimido|fea|borroso|360|rapido|pesa\s*mucho)\b/i)) {
            parsed.flags.q = (cmd === 'descargar') ? '360' : 'baja';
        }

        if (combinedText.match(/subtitulos|letras|subs|cc|con texto|traducido|karaoke|ponle texto/i)) {
            parsed.flags.s = true;
        }
    }

    if (cmd === 'spotify') {
        if (combinedText.match(/flac|lossless|sin perdida|maxima calidad|hq|estudio|original|alta fidelidad/i)) parsed.flags.flac = true;
        if (combinedText.match(/como documento|en documento|archivo|docu|fichero|sin comprimir|pesado/i)) parsed.flags.c = true;
        if (combinedText.match(/como audio|nota de voz|audio normal|vn|voicenote|normal|mp3 normal|rapido/i)) parsed.flags.w = true;
    }

    if (cmd === 'sticker') {
        if (combinedText.match(/recorta|recortado|sin\s*fondo|sin\s*borde|cara|rostro|circulo|redondo|transparente|png|bolita|busto|silueta|perrona?/i)) parsed.flags.r = true;
        if (combinedText.match(/animado|movimiento|gif|video|que\s*se\s*mueva|con\s*movimiento|animacion/i)) parsed.flags.a = true;
    }

    if (cmd === 'pdf2img') {
        if (rawText.match(/zip|comprimido|carpeta|paquete|rar|todo junto|en un solo archivo/)) parsed.flags.zip = true;
    }

    if (cmd === 'efecto') {
        const words = rawText.split(/\s+/);
        let foundEffect = null;
        for (const word of words) {
            const cleanWord = word.replace(/[^a-z0-9]/g, '');
            for (const [realEf, aliases] of Object.entries(EFECTO_MAP)) {
                if (aliases.includes(cleanWord)) {
                    foundEffect = realEf;
                    logger.info(`Extrajo efecto automáticamente: ${realEf} (desde '${cleanWord}')`);
                    break;
                }
            }
            if (foundEffect) break;
        }

        if (foundEffect) {
            parsed.args = [foundEffect];
        }
    }

    if (cmd === 'unir') {
        if (rawText.match(/terminar|listo|ya|fin|acabe|mezclalos/)) parsed.flags.terminar = true;
    }
}

/**
 * Corrige sesgos contextuales entre comandos similares (ej: convertir vs doc vs pdf2img, o audio a transcribir).
 * @returns {string} El comando resultante ajustado
 */
function adjustCommandByContext(cmd, rawText, messageData, parsed) {
    let adjustedCmd = cmd;

    // 1. Corrección por Formato (Doc vs Multimedia)
    if (['convertir', 'doc'].includes(adjustedCmd) && parsed.flags.f) {
        const docFormats = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt'];
        const mediaFormats = ['mp3', 'mp4', 'gif', 'ogg', 'wav', 'audio'];
        const imgFormats = ['img'];

        if (docFormats.includes(parsed.flags.f)) {
            adjustedCmd = 'doc';
            logger.info(`Contexto Cruzado: Forzado a comando 'doc' por el formato ${parsed.flags.f}`);
        } else if (mediaFormats.includes(parsed.flags.f)) {
            adjustedCmd = 'convertir';
            logger.info(`Contexto Cruzado: Forzado a comando 'convertir' por el formato ${parsed.flags.f}`);
        } else if (imgFormats.includes(parsed.flags.f)) {
            const msgType = messageData?.messageType;
            if (msgType === 'documentMessage') {
                adjustedCmd = 'pdf2img';
                logger.info(`Contexto Cruzado: Forzado a comando 'pdf2img' por el formato ${parsed.flags.f} y tipo de adjunto`);
            } else {
                adjustedCmd = 'convertir';
                logger.info(`Contexto Cruzado: Forzado a comando 'convertir' por el formato ${parsed.flags.f} para multimedia`);
            }
        }
    }

    // 2. Corrección basada en Tipo de Adjunto (MIME / MessageType)
    const msgType = messageData?.messageType;
    if (msgType === 'audioMessage') {
        const isTranscriptionIntent = rawText.match(/\b(que dice|dice|habla|transcri\w*|texto|escribe|escucha\w*|resum\w*|leer|lee|dime|entiende|audio a texto)\b/) ||
                                      ['leer', 'doc', 'pdf2img'].includes(adjustedCmd);
        const hasExplicitConvertVerb = rawText.match(/\b(convertir|transformar|cambiar|formato|mutar|hazlo\s+(mp3|mp4|wav|ogg|flac)|a\s+(mp3|mp4|wav|ogg|flac))\b/);

        if (isTranscriptionIntent || (adjustedCmd === 'convertir' && !hasExplicitConvertVerb)) {
            adjustedCmd = 'transcribir';
            delete parsed.flags.f;
            logger.info(`Contexto Cruzado: Forzado a 'transcribir' porque el adjunto es un audio`);
        }
    } else if (msgType === 'imageMessage' || msgType === 'documentMessage') {
        const isOcrIntent = rawText.match(/\b(que dice|leer|lee|texto|extraer|sacar texto|ocr|copiar)\b/) ||
                            ['transcribir'].includes(adjustedCmd);
        if (isOcrIntent || (adjustedCmd === 'convertir' && rawText.includes('texto'))) {
            adjustedCmd = 'leer';
            delete parsed.flags.f;
            logger.info(`Contexto Cruzado: Forzado a 'leer' porque el adjunto es una imagen/documento`);
        }
    }

    return adjustedCmd;
}

module.exports = {
    detectFormatFromRegex,
    extractFlagsAndModifiers,
    adjustCommandByContext,
};
