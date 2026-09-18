'use strict';

/**
 * Valida si el mensaje cumple con los requisitos multimedia de una herramienta.
 *
 * @param {Object} tool - El objeto de la herramienta (desde tools.js).
 * @param {Object} msgData - La información multimedia del mensaje { hasMedia: boolean, type: string }.
 * @returns {Object} - Resultado de la validación { valid: boolean, reason: string | null }.
 */
function validateMedia(tool, msgData) {
    if (!tool.media.required) {
        return { valid: true, reason: null };
    }

    if (!msgData.hasMedia) {
        return { valid: false, reason: tool.media.errorMsg };
    }

    if (tool.media.types.includes('any')) {
        return { valid: true, reason: null };
    }

    if (!tool.media.types.includes(msgData.type)) {
        return { valid: false, reason: tool.media.errorMsg };
    }

    return { valid: true, reason: null };
}

module.exports = { validateMedia };
