'use strict';

/**
 * Genera una clave de sesión consistente para un usuario en un chat (DM o Grupo).
 * Formato unificado: `${from}_${participant}` en grupos, o `${from}` en chats privados.
 * @param {string} from - JID del chat (grupo o privado)
 * @param {object} [messageData] - Objeto del mensaje para extraer participant
 * @returns {string} Clave de sesión
 */
function getSessionKey(from, messageData = null) {
    const isGroup = typeof from === 'string' && from.endsWith('@g.us');
    if (isGroup) {
        const participant = messageData?.key?.participant || messageData?.participant || from;
        return `${from}_${participant}`;
    }
    return from;
}

module.exports = {
    getSessionKey,
    getDownloadSessionKey: getSessionKey
};
