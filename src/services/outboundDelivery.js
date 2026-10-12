'use strict';

const evolution = require('./evolution');
const logger = require('./logger');
const { isAuthorizedAdmin } = require('../core/auth');
const { deliverToRecipient, MAIN_GROUP_JID } = require('../commands/mensaje');

async function feedback(from, result) {
    if (result.enviado_al_chat) return result;
    const text = result.question || result.pregunta || result.confirmacion || result.error;
    if (!text) return result;
    try { await evolution.sendText(from, text); return { ...result, enviado_al_chat: true }; }
    catch (error) { logger.warn(`[ENVIO] No pude confirmar: ${error.message}`); return { ...result, enviado_al_chat: false }; }
}

/** The model chooses meaning; this boundary validates authorization and destination. */
async function deliverSemantic({ args = {}, from, messageData = {}, execute, payloadLabel = 'envío' } = {}) {
    const scope = args.destino_scope || (args.contacto ? 'contact' : null);
    if (!['current_chat', 'main_group', 'contact'].includes(scope)) {
        return feedback(from, { success: false, status: 'needs_clarification', needs_clarification: true,
            question: '¿A qué chat lo mando?', missing_fields: ['destino_scope'] });
    }
    if (scope !== 'current_chat' && !isAuthorizedAdmin(from, messageData)) {
        return feedback(from, { success: false, status: 'denied',
            error: 'Solo el creador y los administradores autorizados pueden enviar a otros chats.' });
    }
    if (scope === 'contact') {
        if (typeof args.contacto !== 'string' || !args.contacto.trim()) {
            return feedback(from, { success: false, status: 'needs_clarification', needs_clarification: true,
                question: '¿A qué contacto se lo mando?', missing_fields: ['contacto'] });
        }
        return deliverToRecipient({ contacto: args.contacto, from, messageData, execute, payloadLabel });
    }
    const jid = scope === 'main_group' ? MAIN_GROUP_JID : from;
    const target = { jid, user_name: scope === 'main_group' ? 'el grupo Gente del señor chiqui 🐓' : 'este chat', is_group: jid.endsWith('@g.us') };
    let result;
    try { result = await execute(target); }
    catch (error) {
        logger.warn(`[ENVIO] Falló la entrega: ${error.message}`);
        result = { success: false, status: 'send_failed', error: 'No tengo confirmación de entrega. Revisa el chat antes de reintentarlo.' };
    }
    // A successfully delivered local payload is itself its confirmation.
    if (result.success && jid === from) return { ...result, enviado_al_chat: true };
    return feedback(from, result);
}

module.exports = { deliverSemantic };
