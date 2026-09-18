'use strict';

const logger = require('../services/logger');
const { hasActiveSession } = require('../commands/documentos');
const { hasActiveSearchSession, getSessionKey } = require('../commands/buscar');

// ─── Tipos Multimedia y Comandos ──────────────────────────────────────────────
const MEDIA_TYPES = [
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'documentMessage',
    'documentWithCaptionMessage',
    'stickerMessage',
];

const COMMANDS_REQUIRING_MEDIA = [
    'efecto', 'leer', 'ocr', 'comprimir', 'sticker', 's',
    'pdf2img', 'extraer', 'transcribir', 'tr', 'convertir', 'cv'
];

const MEDIA_INTENT_REGEX = /\b(sticker|calca|pegatina|transcribe|escucha|leer|ocr|comprime|pdf|convierte)\b/i;

// ─── Mapeo de Votos de Encuestas ──────────────────────────────────────────────
const POLL_MAPPINGS = {
    // Menús de Categorías Principales
    '⚙️ Gestión del Servidor': 'maicra menu server',
    '🌍 Mundo y Clima': 'maicra menu mundo',
    '🎮 Modos y Dificultad': 'maicra menu jugadores',
    '📜 Reglas del Juego': 'maicra menu reglas',
    '🔙 Volver al Menú Principal': 'maicra menu',

    // Opciones de Servidor (Max 10)
    '🟢 Encender Servidor': 'maicra on',
    '🔴 Apagar Servidor': 'maicra off',
    '🔄 Reiniciar Servidor': 'maicra reiniciar',
    '📊 Estado y Recursos': 'maicra estado',
    '📡 Ping y Jugadores': 'maicra ping',
    '💾 Forzar Guardado': 'maicra cmd save-all',
    '🗑️ Limpiar Basura (Items)': 'maicra cmd kill @e[type=item]',
    '📜 Ver Logs (Últimos 10)': 'maicra logs',
    '⛔ Apagar de Emergencia': 'maicra kill',

    // Opciones de Mundo (Max 10)
    '☀️ Hacer de Día (6am)': 'maicra cmd time set day',
    '🌆 Atardecer (6pm)': 'maicra cmd time set sunset',
    '🌙 Hacer de Noche': 'maicra cmd time set night',
    '🌌 Medianoche (12am)': 'maicra cmd time set midnight',
    '🌧️ Activar Lluvia': 'maicra cmd weather rain',
    '☀️ Quitar Lluvia': 'maicra cmd weather clear',
    '🌩️ Activar Tormenta': 'maicra cmd weather thunder',
    '⏸️ Pausar Ciclo de Día': 'maicra cmd gamerule dodaylightcycle false',
    '▶️ Reanudar Ciclo de Día': 'maicra cmd gamerule dodaylightcycle true',

    // Opciones de Modos y Dificultad (Max 10)
    '🧑‍💻 Todos a Creativo': 'maicra cmd gamemode creative @a',
    '🗡️ Todos a Supervivencia': 'maicra cmd gamemode survival @a',
    '🗺️ Todos a Aventura': 'maicra cmd gamemode adventure @a',
    '🕊️ Dificultad: Pacífica': 'maicra cmd difficulty peaceful',
    '🟢 Dificultad: Fácil': 'maicra cmd difficulty easy',
    '🟡 Dificultad: Normal': 'maicra cmd difficulty normal',
    '🔴 Dificultad: Difícil': 'maicra cmd difficulty hard',

    // Reglas del Juego (Max 10)
    '🛡️ Quitar Fuego Amigo (PvP Off)': 'maicra cmd gamerule pvp false',
    '⚔️ Activar Fuego Amigo (PvP On)': 'maicra cmd gamerule pvp true',
    '🎒 Conservar Inventario': 'maicra cmd gamerule keepinventory true',
    '💥 Perder Inventario': 'maicra cmd gamerule keepinventory false',
    '🚫 Quitar Daño por Caída': 'maicra cmd gamerule falldamage false',
    '☠️ Activar Daño por Caída': 'maicra cmd gamerule falldamage true'
};

// ─── Cachés en Memoria con Autolimpieza ────────────────────────────────────────
const lastMediaByUser = new Map();
const mediaCacheById = new Map();
const processedPolls = new Map();

// Purgar encuestas procesadas (> 1 hora) cada 10 min
setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of processedPolls) {
        if (now - ts > 3600000) processedPolls.delete(id);
    }
}, 600000).unref();

// Purgar mediaCacheById (> 1 hora o > 500 items) cada 15 min
setInterval(() => {
    const now = Date.now();
    const MAX_ENTRIES = 500;
    for (const [key, value] of mediaCacheById) {
        if (now - value.timestamp > 3600000) mediaCacheById.delete(key);
    }
    if (mediaCacheById.size > MAX_ENTRIES) {
        const sorted = [...mediaCacheById.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toDelete = sorted.slice(0, mediaCacheById.size - MAX_ENTRIES);
        for (const [key] of toDelete) mediaCacheById.delete(key);
    }
}, 900000).unref();

// ─── Funciones Auxiliares de Extracción ────────────────────────────────────────

/**
 * Extrae texto de cualquier tipo de mensaje de WhatsApp / Baileys.
 */
function extractText(message) {
    if (!message) return '';
    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;

    for (const type of MEDIA_TYPES) {
        if (message[type]?.caption) return message[type].caption;
    }

    if (message.documentWithCaptionMessage?.message?.documentMessage?.caption) {
        return message.documentWithCaptionMessage.message.documentMessage.caption;
    }

    return '';
}

/**
 * Detecta el tipo de mensaje.
 */
function detectMessageType(message) {
    if (!message) return 'unknown';
    const types = [
        'conversation',
        'extendedTextMessage',
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'documentMessage',
        'documentWithCaptionMessage',
        'stickerMessage',
        'reactionMessage',
        'pollUpdateMessage'
    ];
    return types.find(t => t in message) ?? 'unknown';
}

function getCachedMediaById(messageId) {
    return mediaCacheById.get(messageId);
}

function getLastMediaByUser(userKey) {
    return lastMediaByUser.get(userKey);
}

// ─── Función Principal de Normalización ───────────────────────────────────────

/**
 * Normaliza y enriquece un mensaje entrante de Evolution API.
 * @param {object} data - data de Evolution API (messages.upsert)
 * @returns {object|null} Objeto normalizado con metadatos y estado de despacho
 */
function normalizeIncomingMessage(data) {
    if (!data) return null;

    const from = data.key?.remoteJid;
    if (!from) return null;

    const message = data.message;
    const messageType = data.messageType ?? detectMessageType(message);
    let text = extractText(message).trim();
    const pushName = data.pushName ?? 'Usuario';
    const isGroup = from.endsWith('@g.us');
    const participant = data.key?.participant || from;
    const cacheKey = isGroup ? participant : from;

    // ── 1. Guardar multimedia entrante en caché ──
    if (MEDIA_TYPES.includes(messageType)) {
        lastMediaByUser.set(cacheKey, { data, messageType });
        const messageId = data.key?.id;
        if (messageId) {
            mediaCacheById.set(messageId, { data, messageType, timestamp: Date.now() });
        }
    }

    // ── 2. Manejo de Reacciones ──
    const reaction = data.reactionMessage || message?.reactionMessage;
    if (messageType === 'reactionMessage' || reaction) {
        return {
            isReaction: true,
            reactionText: reaction?.text || '',
            targetMsgId: reaction?.key?.id || '',
            from,
            participant,
            isGroup,
            pushName,
            shouldDispatch: false
        };
    }

    // ── 3. Manejo del Prefijo /@ ──
    const PREFIX = '/@';
    let hasPrefix = false;
    let isPollCommand = false;

    if (text.startsWith(PREFIX)) {
        text = text.slice(PREFIX.length).trim();
        hasPrefix = true;
    }

    // ── 4. Manejo de Votos en Encuestas ──
    if (messageType === 'pollUpdateMessage' || data.pollUpdateMessage) {
        const vote = message?.pollUpdateMessage?.vote || data?.pollUpdateMessage?.vote || data?.vote || message?.pollUpdateMessage?.voters?.[0];
        const options = vote?.selectedOptions || vote?.options;

        if (options && Array.isArray(options) && options.length > 0) {
            const pollCreationKey = message?.pollUpdateMessage?.pollCreationMessageKey || null;
            const pollId = pollCreationKey?.id || data?.key?.id;
            const optionName = options[0].name || options[0];
            const cleanOption = optionName.toString().trim();

            if (pollId && cleanOption !== '🔙 Volver al Menú Principal') {
                if (processedPolls.has(pollId)) return null;
                processedPolls.set(pollId, Date.now());
            }

            if (POLL_MAPPINGS[cleanOption]) {
                text = POLL_MAPPINGS[cleanOption];
                hasPrefix = true;
                isPollCommand = true;
                logger.info(`[POLL] Voto procesado: ${cleanOption} -> ${text}`);
            }
        }
    }

    // ── 5. Resolución de Intención Implícita (sin prefijo) ──
    let shouldDispatch = true;

    if (!hasPrefix) {
        const sessionType = hasActiveSession(from, participant);
        const isImage = messageType?.toLowerCase().includes('image') ||
            (messageType?.toLowerCase().includes('document') &&
                (data.message?.documentMessage?.mimetype?.startsWith('image/') ||
                    data.message?.documentMessage?.fileName?.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/i) ||
                    data.message?.documentWithCaptionMessage?.message?.documentMessage?.mimetype?.startsWith('image/') ||
                    data.message?.documentWithCaptionMessage?.message?.documentMessage?.fileName?.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/i)));

        const isPdf = messageType?.toLowerCase().includes('document') &&
            (text.toLowerCase().endsWith('.pdf') ||
                (data.message?.documentMessage?.mimetype === 'application/pdf') ||
                (data.message?.documentWithCaptionMessage?.message?.documentMessage?.mimetype === 'application/pdf'));

        const driveSessionKey = getSessionKey(from, data);

        if (hasActiveSearchSession(driveSessionKey) && /^[1-5]$/.test(text.trim())) {
            text = `descargardrive ${text.trim()}`;
            hasPrefix = true;
        } else if (sessionType === 'pdf' && isImage) {
            text = 'pdf';
            hasPrefix = true;
        } else if (sessionType === 'unir' && isPdf) {
            text = 'unir';
            hasPrefix = true;
        } else if (!isGroup && text && text.trim()) {
            // En chat privado se permite plática directa sin prefijo
            hasPrefix = true;
        } else {
            shouldDispatch = false;
        }
    }

    // ── 6. Desempaquetado de Multimedia y Quotes ──
    let actualMessageData = data;
    let actualMessageType = messageType;

    if (messageType === 'documentWithCaptionMessage' && message.documentWithCaptionMessage?.message?.documentMessage) {
        actualMessageType = 'documentMessage';
        actualMessageData = {
            ...data,
            message: { documentMessage: message.documentWithCaptionMessage.message.documentMessage },
            messageType: 'documentMessage'
        };
    }

    // Buscar contextInfo exhaustivamente (sub-objetos y raíz)
    let contextInfo = null;
    if (message && typeof message === 'object') {
        for (const val of Object.values(message)) {
            if (val && typeof val === 'object' && val.contextInfo?.quotedMessage) {
                contextInfo = val.contextInfo;
                break;
            }
        }
    }
    if (!contextInfo && data.contextInfo?.quotedMessage) {
        contextInfo = data.contextInfo;
    }

    if (contextInfo?.quotedMessage) {
        const quoted = contextInfo.quotedMessage;
        const quotedType = detectMessageType(quoted);

        if (MEDIA_TYPES.includes(quotedType)) {
            let finalQuoted = quoted;
            let finalType = quotedType;

            if (quotedType === 'documentWithCaptionMessage' && quoted.documentWithCaptionMessage?.message?.documentMessage) {
                finalQuoted = { documentMessage: quoted.documentWithCaptionMessage.message.documentMessage };
                finalType = 'documentMessage';
            } else if (quotedType === 'documentMessage') {
                finalQuoted = { documentMessage: quoted.documentMessage };
                finalType = 'documentMessage';
            }

            actualMessageType = finalType;
            actualMessageData = {
                ...data,
                message: finalQuoted,
                messageType: finalType,
                quotedStanzaId: contextInfo.stanzaId,
                quotedParticipant: contextInfo.participant ?? data.key?.remoteJid,
            };
            logger.info(`[QUOTE] multimedia extraído: tipo=${finalType}, stanzaId=${contextInfo.stanzaId}`);
        }
    }

    // Fallback al último multimedia enviado por este usuario si el comando requiere media
    if (actualMessageType === messageType && !MEDIA_TYPES.includes(messageType) && lastMediaByUser.has(cacheKey)) {
        const parts = text.split(' ');
        const parsedCommand = parts[0].toLowerCase();
        const isMediaIntent = COMMANDS_REQUIRING_MEDIA.includes(parsedCommand) ||
            (parsedCommand === 'qr' && parts.length === 1) ||
            MEDIA_INTENT_REGEX.test(text);

        if (isMediaIntent) {
            const last = lastMediaByUser.get(cacheKey);
            let lastType = last.messageType;
            let lastData = last.data;
            let lastMsg = lastData.message;

            if (lastType === 'documentWithCaptionMessage' && lastMsg.documentWithCaptionMessage?.message?.documentMessage) {
                lastData = { ...lastData, message: { documentMessage: lastMsg.documentWithCaptionMessage.message.documentMessage } };
                lastType = 'documentMessage';
            }

            actualMessageType = lastType;
            actualMessageData = lastData;
            logger.info(`[MEDIA-FALLBACK] Usando último multimedia de ${participant} (${lastType}) para "${parsedCommand}"`);
        }
    }

    return {
        from,
        participant,
        isGroup,
        pushName,
        text,
        messageType,
        actualMessageType,
        actualMessageData,
        hasPrefix,
        isPollCommand,
        shouldDispatch,
        isReaction: false
    };
}

module.exports = {
    extractText,
    detectMessageType,
    normalizeIncomingMessage,
    getCachedMediaById,
    getLastMediaByUser,
    POLL_MAPPINGS,
    MEDIA_TYPES
};
