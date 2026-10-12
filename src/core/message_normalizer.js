'use strict';

const logger = require('../services/logger');
const { hasActiveSession } = require('../commands/documentos');
const { hasActiveSearchSession, getSessionKey } = require('../commands/buscar');
const { hasPendingContactChoice } = require('../commands/mensaje');
const { hasActiveRouletteLobby } = require('../commands/ruleta');
const { hasActiveBlackjackGame, hasActiveBlackjackTableLobby, hasActiveBlackjackTablePlaying } = require('../commands/blackjack');
const { hasActiveCooperacha } = require('../commands/cooperacha');
const { registerTask } = require('../services/scheduler');
const attachmentContext = require('../services/attachmentContext');

// ─── Tipos Multimedia y Comandos ──────────────────────────────────────────────
const MEDIA_TYPES = [
    'imageMessage',
    'videoMessage',
    'audioMessage',
    'documentMessage',
    'documentWithCaptionMessage',
    'stickerMessage',
];

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
    '⏸️ Pausar Ciclo de Día': 'maicra cmd gamerule doDayLightCycle false',
    '▶️ Reanudar Ciclo de Día': 'maicra cmd gamerule doDayLightCycle true',

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

// Purgar periódicamente encuestas y cachés multimedia de forma coordinada (PERF-2)
registerTask('media-caches-cleanup', 10, () => {
    const now = Date.now();

    // 1. Purgar encuestas procesadas (> 1 hora)
    for (const [id, ts] of processedPolls) {
        if (now - ts > 3600000) processedPolls.delete(id);
    }

    // 2. Purgar mediaCacheById (> 1 hora o > 500 items)
    const MAX_ENTRIES = 500;
    for (const [key, value] of mediaCacheById) {
        if (now - value.timestamp > attachmentContext.TTL_MS) mediaCacheById.delete(key);
    }
    if (mediaCacheById.size > MAX_ENTRIES) {
        const sorted = [...mediaCacheById.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toDelete = sorted.slice(0, mediaCacheById.size - MAX_ENTRIES);
        for (const [key] of toDelete) mediaCacheById.delete(key);
    }

    // 3. Purgar lastMediaByUser (> 30 min o > 200 entradas)
    const MAX_MEDIA_USERS = 200;
    for (const [key, value] of lastMediaByUser) {
        if (now - (value.timestamp || 0) > attachmentContext.TTL_MS) lastMediaByUser.delete(key);
    }
    if (lastMediaByUser.size > MAX_MEDIA_USERS) {
        const sorted = [...lastMediaByUser.entries()].sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
        const toDelete = sorted.slice(0, lastMediaByUser.size - MAX_MEDIA_USERS);
        for (const [key] of toDelete) lastMediaByUser.delete(key);
    }
});

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
    const cached = mediaCacheById.get(messageId);
    if (cached && Date.now() - cached.timestamp > attachmentContext.TTL_MS) {
        mediaCacheById.delete(messageId);
        return undefined;
    }
    return cached;
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
/**
 * Extrae una estructura mínima y limpia para caché multimedia (MEM-1 & MEM-2),
 * evitando retener en memoria el payload completo del webhook ni thumbnails pesados.
 */
function extractMinimalMediaData(data, messageType) {
    return attachmentContext.minimalMessageData(data, messageType);
}

function normalizeIncomingMessage(data) {
    if (!data) return null;

    const from = data.key?.remoteJid;
    if (!from || typeof from !== 'string') return null;

    const message = data.message;
    const messageType = data.messageType ?? detectMessageType(message);
    let text = extractText(message).trim();
    const pushName = data.pushName ?? 'Usuario';
    const isGroup = from.endsWith('@g.us');
    const participant = data.key?.participant || data.participant || from;
    const cacheKey = attachmentContext.getAttachmentContextKey(from, participant);

    // ── 1. Guardar multimedia entrante en caché (MEM-1 & MEM-2) ──
    if (MEDIA_TYPES.includes(messageType)) {
        const cleanData = extractMinimalMediaData(data, messageType);
        lastMediaByUser.set(cacheKey, { data: cleanData, messageType, timestamp: Date.now() });
        const messageId = data.key?.id;
        if (messageId) {
            mediaCacheById.set(messageId, { data: cleanData, messageType, timestamp: Date.now() });
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

    // ── 3. Manejo de Prefijos de Comandos (/@, /!, !, /, #, .) ──
    let hasPrefix = false;
    let isPollCommand = false;
    let isTaskDirectCommand = false;

    if (text.startsWith('/!')) {
        text = text.slice(2).trim();
        hasPrefix = true;
        isTaskDirectCommand = true;
    } else if (text.startsWith('/@')) {
        text = text.slice(2).trim();
        hasPrefix = true;
    } else {
        // Soporta prefijos estándar (!, /, #, .) consistentes con dispatcher
        const prefixMatch = text.match(/^([!/#.])([a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_].*)$/s);
        if (prefixMatch) {
            text = prefixMatch[2].trim();
            hasPrefix = true;
        }
    }

    // A preceding request can arrive in a separate webhook before its file.
    if (MEDIA_TYPES.includes(messageType)) {
        const instruction = attachmentContext.consumeInstruction({ from, participant });
        if (!text && instruction) {
            text = instruction.text;
            hasPrefix = hasPrefix || instruction.hasPrefix;
        }
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

    // Sessions describe context to Gemini; they never rewrite natural language.
    const sessions = {
        pdf: hasActiveSession(from, participant) || null,
        drive: hasActiveSearchSession(getSessionKey(from, data)),
        contact: hasPendingContactChoice(from, data),
        rouletteLobby: hasActiveRouletteLobby(from),
        blackjackLobby: hasActiveBlackjackTableLobby(from),
        blackjackHand: hasActiveBlackjackGame(from, participant) || hasActiveBlackjackTablePlaying(from),
        cooperacha: hasActiveCooperacha(from)
    };
    const shouldDispatch = Boolean(text.trim() || (!isGroup && MEDIA_TYPES.includes(messageType)));

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

    if (contextInfo?.quotedMessage && !MEDIA_TYPES.includes(messageType)) {
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
                contextInfo,
                messageType: finalType,
                quotedStanzaId: contextInfo.stanzaId,
                quotedParticipant: contextInfo.participant ?? data.key?.remoteJid,
                quotedFromMe: Boolean(contextInfo.participant && process.env.BOT_NUMBER &&
                    contextInfo.participant.split('@')[0].replace(/[^0-9]/g, '').replace(/^521/, '52') ===
                    process.env.BOT_NUMBER.replace(/[^0-9]/g, '').replace(/^521/, '52')),
            };
            logger.info(`[QUOTE] multimedia extraído: tipo=${finalType}, stanzaId=${contextInfo.stanzaId}`);
        }
    }

    // Resolve current, quoted and recent attachments through one bounded context.
    let attachment = null;
    let attachmentAmbiguity = null;
    if (MEDIA_TYPES.includes(actualMessageType)) {
        const source = MEDIA_TYPES.includes(messageType) ? 'current' : 'quoted';
        attachment = attachmentContext.rememberAttachment({
            from, participant, messageData: actualMessageData,
            messageType: actualMessageType, source
        });
    }
    if (attachment) {
        actualMessageType = attachment.messageType;
        actualMessageData = attachmentContext.attachToMessage(attachment, actualMessageData);
    }

    return {
        from,
        remoteJid: from,
        participant,
        isGroup,
        pushName,
        text,
        messageType,
        actualMessageType,
        actualMessageData,
        attachment,
        attachmentAmbiguity,
        sessions,
        hasPrefix,
        isPollCommand,
        isTaskDirectCommand,
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
