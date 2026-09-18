'use strict';

const logger = require('./logger');

const chatHistories = new Map();
const MAX_HISTORY = 12;
const TTL_MS = 2 * 60 * 60 * 1000; // 2 horas

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

    chat.messages.push({
        role,
        content: safeContent,
        name: name || (role === 'assistant' ? 'Botsky' : 'Usuario'),
        timestamp: Date.now()
    });

    if (chat.messages.length > MAX_HISTORY) {
        chat.messages.splice(0, chat.messages.length - MAX_HISTORY);
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
                content: `${m.name || 'Usuario'}: ${m.content}`
            };
        } else {
            return {
                role: 'assistant',
                content: m.content
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
}

// Limpieza periódica de sesiones inactivas
setInterval(() => {
    const now = Date.now();
    for (const [key, chat] of chatHistories.entries()) {
        if (now - chat.lastActive > TTL_MS) {
            chatHistories.delete(key);
        }
    }
}, 30 * 60 * 1000).unref();

module.exports = {
    addMessage,
    getHistory,
    clearHistory
};
