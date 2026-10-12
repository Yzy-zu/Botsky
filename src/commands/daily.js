'use strict';

const { sendText } = require('../services/evolution');
const db = require('../services/db');
const logger = require('../services/logger');
const { getSenderJid } = require('../core/auth');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

// Tabla de probabilidades balanceadas
const PRIZES = [
    { min: 1, max: 3, title: '💎 Premio mayor', baseXp: 1000, desc: 'Hoy sí te cayó la buena.' },
    { min: 4, max: 15, title: '💰 Premio grande', baseXp: 300, desc: 'Nada mal, compa.' },
    { min: 16, max: 50, title: '💵 Premio medio', baseXp: 100, desc: 'Para ir sumando.' },
    { min: 51, max: 85, title: '🪙 Premio básico', baseXp: 40, desc: 'Poquito, pero suma.' },
    { min: 86, max: 95, title: '🎟️ Premio pequeño', baseXp: 15, desc: 'Salió para el cambio.' },
    { min: 96, max: 100, title: 'Sin premio', baseXp: 0, desc: 'Hoy no cayó premio. Tu racha sigue en pie.' }
];

/**
 * Determina el premio a partir de una tirada de 1 a 100.
 */
function pickPrize(roll) {
    return PRIZES.find(p => roll >= p.min && roll <= p.max) || PRIZES[PRIZES.length - 1];
}

/**
 * Formatea la diferencia en horas y minutos para el cooldown.
 */
function formatCooldownRemaining(diffMs) {
    const hours = Math.floor(diffMs / (60 * 60 * 1000));
    const mins = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
    if (hours > 0) {
        return `${hours} hora${hours === 1 ? '' : 's'} y ${mins} minuto${mins === 1 ? '' : 's'}`;
    }
    return `${mins} minuto${mins === 1 ? '' : 's'}`;
}

/**
 * Manejador principal de la Ruleta de la Suerte Diaria.
 */
async function handleDaily(parsed = {}, from, messageData = {}, { sendConfirmation = true } = {}) {
    const participant = messageData?.key?.participant || messageData?.participant || from;
    const userName = messageData?.pushName || 'Jugador';
    const now = Date.now();
    const respond = async (result, text) => {
        if (sendConfirmation) await sendText(from, text);
        return { ...result, mensaje: text, enviado_al_chat: sendConfirmation };
    };

    try {
        const claim = await db.getDailyClaim(participant);

        // 1. Verificar si aún está en cooldown de 24 horas
        if (claim && claim.last_claim && (now - claim.last_claim < ONE_DAY_MS)) {
            const diffMs = ONE_DAY_MS - (now - claim.last_claim);
            const timeLeftStr = formatCooldownRemaining(diffMs);
            return await respond({ success: false, status: 'cooldown', remaining_ms: diffMs, retry_at: claim.last_claim + ONE_DAY_MS, racha: claim.streak },
                `⏳ *Tu giro ya salió, compa.*\n` +
                `*${userName}*\n` +
                `Racha: *${claim.streak} días*\n\n` +
                `El siguiente está listo en *${timeLeftStr}*.`
            );
        }

        // 2. Calcular racha (streak)
        let newStreak = 1;
        if (claim && claim.last_claim) {
            const elapsed = now - claim.last_claim;
            if (elapsed <= TWO_DAYS_MS) {
                // Mantuvo la racha consecutiva
                newStreak = (claim.streak || 1) + 1;
            } else {
                // Pasaron más de 48 horas: se reinicia la racha a 1
                newStreak = 1;
            }
        }

        // Bonus de racha (+20 XP por día consecutivo, tope de 100 XP)
        const streakBonus = Math.min((newStreak - 1) * 20, 100);

        // 3. Tirada de la ruleta (RNG 1-100)
        const roll = Math.floor(Math.random() * 100) + 1;
        const prize = pickPrize(roll);

        // 4. Calcular ganancia total y actualizar SQLite
        const totalGain = prize.baseXp > 0 ? (prize.baseXp + streakBonus) : 0;

        if (totalGain > 0) {
            await db.addXp(participant, totalGain);
        }
        await db.recordDailyClaim(participant, now, newStreak);

        // Progresión orgánica: reclamar el daily demuestra lealtad y suma +2 de afinidad
        const senderJid = getSenderJid(from, messageData);
        const altJid = (senderJid && participant && senderJid !== participant) ? participant : null;
        db.adjustUserAffinity(senderJid || participant, userName, 2, 'Reclamó su giro diario en Botsky', altJid).catch(() => {});

        const updatedUser = await db.getOrCreateUser(participant);

        // 5. Formatear y enviar mensaje
        if (prize.baseXp > 0) {
            let msg =
                `🎰 *Tu daily*\n` +
                `*${userName}*\n\n` +
                `${prize.title}\n` +
                `Ganaste *+${prize.baseXp} XP*\n`;

            if (streakBonus > 0) {
                msg += `Racha de ${newStreak} días: *+${streakBonus} XP* extra\n`;
                msg += `Total: *+${totalGain} XP*\n`;
            }

            msg += `_${prize.desc}_\n\n` +
                   `Saldo: *${updatedUser.xp.toLocaleString('es-MX')} XP*\n` +
                   `Vuelve en 24 horas por otro giro.`;

            return await respond({ success: true, status: 'claimed', xp_ganados: totalGain, saldo: updatedUser.xp, racha: newStreak, retry_at: now + ONE_DAY_MS }, msg);
        } else {
            return await respond({ success: true, status: 'claimed', xp_ganados: totalGain, saldo: updatedUser.xp, racha: newStreak, retry_at: now + ONE_DAY_MS },
                `🎰 *Tu daily*\n` +
                `*${userName}*\n\n` +
                `${prize.title}\n` +
                `_${prize.desc}_\n` +
                `Racha: *${newStreak} días*\n\n` +
                `Saldo: *${updatedUser.xp.toLocaleString('es-MX')} XP*\n` +
                `Vuelve en 24 horas por otro giro.`
            );
        }
    } catch (err) {
        logger.error('[DAILY] Error en ruleta diaria:', err);
        return await respond({ success: false, status: 'error' }, 'No pude completar tu giro. Espera un momento y consulta de nuevo con daily.');
    }
}

module.exports = {
    handleDaily,
    pickPrize,
    formatCooldownRemaining,
    PRIZES,
    ONE_DAY_MS,
    TWO_DAYS_MS
};
