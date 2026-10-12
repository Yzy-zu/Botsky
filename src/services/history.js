'use strict';

const logger = require('./logger');
const { registerTask } = require('./scheduler');
const db = require('./db');

const chatHistories = new Map();
const MAX_HISTORY = 12;
const TTL_MS = 2 * 60 * 60 * 1000; // 2 horas

// ─── Hidratación inicial desde SQLite (Sobrevive a reinicios de PM2) ───────────
let isHydrated = false;
function hydrateFromDb() {
    if (isHydrated || !db || typeof db.getActiveChatHistories !== 'function') return;
    const sinceTimestamp = Date.now() - TTL_MS;
    db.getActiveChatHistories(sinceTimestamp).then(rows => {
        if (!Array.isArray(rows) || rows.length === 0) return;
        for (const row of rows) {
            const key = normalizeKey(row.chat_id);
            if (!key) continue;
            if (!chatHistories.has(key)) {
                chatHistories.set(key, { messages: [], lastActive: row.timestamp });
            }
            const chat = chatHistories.get(key);
            chat.messages.push({
                role: row.role,
                content: row.content,
                name: row.name,
                timestamp: row.timestamp
            });
            if (row.timestamp > chat.lastActive) {
                chat.lastActive = row.timestamp;
            }
            if (chat.messages.length > MAX_HISTORY) {
                chat.messages.splice(0, chat.messages.length - MAX_HISTORY);
            }
        }
        isHydrated = true;
        logger.info(`[HISTORY] Hidratados ${rows.length} mensajes previos desde SQLite para ${chatHistories.size} chats`);
    }).catch(err => {
        logger.warn(`[HISTORY] No se pudo hidratar historial desde SQLite: ${err.message}`);
    });
}
hydrateFromDb();

function normalizeKey(chatId) {
    if (!chatId) return '';
    // Si viene con :XX (ej: 5214435810175:40@s.whatsapp.net), limpiar el sufijo de dispositivo
    return String(chatId).replace(/:[0-9]+@/, '@').trim();
}

/**
 * Agrega un mensaje al historial del chat (from / to / jid).
 * @param {string} chatId  - JID del chat (grupo o DM)
 * @param {"user"|"assistant"} role
 * @param {string} content - Contenido del mensaje o respuesta
 * @param {string} [name]  - Nombre de quien envía (para usuarios)
 */
function addMessage(chatId, role, content, name = null) {
    if (!chatId || !content || typeof content !== 'string') return;
    const key = normalizeKey(chatId);
    if (!key) return;

    // Perf #4 fix: verificar TTL ANTES de reutilizar el entry existente.
    // Sin este check, getHistory() borraba el historial expirado pero addMessage()
    // lo recreaba de inmediato con el nuevo mensaje como si el historial fuera fresco,
    // haciendo que el TTL de getHistory no tuviera efecto real en addMessage.
    const existing = chatHistories.get(key);
    if (existing && Date.now() - existing.lastActive > TTL_MS) {
        chatHistories.delete(key);
    }

    if (!chatHistories.has(key)) {
        chatHistories.set(key, { messages: [], lastActive: Date.now() });
    }

    const chat = chatHistories.get(key);
    chat.lastActive = Date.now();

    // Evitar duplicar exactamente el mismo mensaje si entra dos veces
    const last = chat.messages[chat.messages.length - 1];
    if (last && last.role === role && last.content === content) {
        return;
    }

    // Truncar contenido muy largo (ej: logs o OCR gigante) para no quemar tokens de Groq
    const safeContent = content.length > 600 ? content.slice(0, 600) + '... [truncado]' : content;

    const now = Date.now();
    chat.messages.push({
        role,
        content: safeContent,
        name: name || (role === 'assistant' ? 'Botsky' : 'Usuario'),
        timestamp: now
    });

    if (chat.messages.length > MAX_HISTORY) {
        chat.messages.splice(0, chat.messages.length - MAX_HISTORY);
    }

    // Persistir de forma asíncrona en SQLite para sobrevivir reinicios
    if (db && typeof db.saveChatMessage === 'function') {
        db.saveChatMessage(key, role, safeContent, name, now).catch(err => {
            logger.warn(`[HISTORY] Error guardando mensaje en SQLite para ${key}: ${err.message}`);
        });
    }
}

/**
 * Obtiene el historial formateado para la API de Chat (Groq / OpenAI).
 * @param {string} chatId
 * @param {number} limit
 * @returns {Array<{ role: string, content: string }>}
 */
function getHistory(chatId, limit = 8) {
    if (!chatId) return [];
    const key = normalizeKey(chatId);
    if (!chatHistories.has(key)) return [];

    const chat = chatHistories.get(key);
    if (Date.now() - chat.lastActive > TTL_MS) {
        chatHistories.delete(key);
        return [];
    }

    const msgs = chat.messages.slice(-limit);
    return msgs.map(m => {
        if (m.role === 'user') {
            return {
                role: 'user',
                content: `${m.name || 'Usuario'}: ${m.content}`,
                name: m.name || 'Usuario',
                timestamp: m.timestamp
            };
        } else {
            return {
                role: 'assistant',
                content: m.content,
                name: 'Botsky',
                timestamp: m.timestamp
            };
        }
    });
}

/**
 * Limpia el historial de un chat en particular.
 */
function clearHistory(chatId) {
    if (!chatId) return;
    const key = normalizeKey(chatId);
    chatHistories.delete(key);
    if (db && typeof db.clearChatHistory === 'function') {
        db.clearChatHistory(key).catch(() => {});
    }
}

// Limpieza periódica coordinada de sesiones inactivas (PERF-2)
registerTask('history-cleanup', 30, () => {
    const now = Date.now();
    for (const [key, chat] of chatHistories.entries()) {
        if (now - chat.lastActive > TTL_MS) {
            chatHistories.delete(key);
        }
    }
    if (db && typeof db.purgeExpiredChatHistory === 'function') {
        db.purgeExpiredChatHistory(now - TTL_MS).catch(() => {});
    }
});

module.exports = {
    addMessage,
    getHistory,
    clearHistory
};
