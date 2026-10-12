'use strict';

const { sendText } = require('../services/evolution');
const db = require('../services/db');
const logger = require('../services/logger');
const { getSenderJid } = require('../core/auth');

/**
 * Genera una barra visual de progreso de afinidad (-100 a +100).
 */
function renderBar(score) {
    // Normalizar de [-100, 100] a [0, 10]
    const normalized = Math.round(((score + 100) / 200) * 10);
    const filled = Math.max(0, Math.min(10, normalized));
    const empty = 10 - filled;
    return '🟩'.repeat(filled) + '⬛'.repeat(empty);
}

/**
 * Manejador del comando de afinidad / karma social con Botsky.
 */
async function handleAfinidad(parsed = {}, from, messageData = {}) {
    const senderJid = getSenderJid(from, messageData);
    const rawParticipant = messageData?.key?.participant || messageData?.participant;
    const participant = senderJid || rawParticipant || from;
    const altJid = (senderJid && rawParticipant && senderJid !== rawParticipant) ? rawParticipant : null;
    const userName = messageData?.pushName || 'Compa';

    try {
        const aff = await db.getUserAffinity(participant, userName, altJid);
        const { score, mood, grievances, favors, last_reason } = aff;

        let moodTitle = '😒 Desconfiado y Grosero';
        let moodAdvice = 'Por defecto Botsky es malencarado y no confía en nadie. Háblale con respeto, agradécele o cotorrea chido para ganarte su confianza.';

        if (mood === 'rencoroso') {
            moodTitle = '🤬 Rencoroso y Encabronado';
            moodAdvice = 'Estás en su lista negra cabrón. Botsky no olvida las mentadas de madre. Si quieres que se le baje el coraje, pídele una disculpa sincera.';
        } else if (mood === 'neutral') {
            moodTitle = '😐 Neutral con Reservas';
            moodAdvice = 'Ya te empieza a tolerar un poco más, pero no te confíes. Sigue tratándolo bien para subir de nivel.';
        } else if (mood === 'camarada') {
            moodTitle = '🤝 Camarada / Compa del Alma';
            moodAdvice = '¡Te ganaste el respeto absoluto de Botsky! Tienes su lealtad, te cumple favores de buenas y te aguanta la carrilla.';
        }

        const message = 
            `📊 *NIVEL DE AFINIDAD CON BOTSKY*\n\n` +
            `👤 *Usuario:* ${userName}\n` +
            `🎭 *Estado:* ${moodTitle}\n` +
            `📈 *Afinidad:* *${score > 0 ? '+' + score : score}/100*\n` +
            `[${renderBar(score)}]\n\n` +
            `📝 *Historial:* \n` +
            `• Ofensas acumuladas: *${grievances}*\n` +
            `• Interacciones positivas: *${favors}*\n` +
            `• Último registro: _"${last_reason}"_\n\n` +
            `💡 *Consejo:* ${moodAdvice}`;

        await sendText(from, message);
    } catch (err) {
        logger.error(`[AFINIDAD] Error al consultar afinidad: ${err.message}`);
        await sendText(from, 'No pude consultar tu nivel de afinidad en este momento, compa.');
    }
}

module.exports = {
    handleAfinidad,
    renderBar
};
