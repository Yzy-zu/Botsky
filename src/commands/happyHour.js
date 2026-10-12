'use strict';

const evolution = require('../services/evolution');
const happyHour = require('../services/happyHour');
const { isAuthorizedAdmin, getSenderJid } = require('../core/auth');
const logger = require('../services/logger');

/**
 * Manejador del comando !horafeliz (control y consulta del evento).
 *
 * @param {object} parsed - Objeto parseado ({ args, flags, raw })
 * @param {string} from - JID del chat entrante (grupo o privado)
 * @param {object} messageData - Metadatos del webhook
 * @returns {Promise<object>}
 */
async function handleHoraFeliz(parsed = {}, from, messageData = {}) {
    if (!from) return null;

    const sub = (parsed.args?.[0] || parsed.flags?.accion || 'status').toLowerCase();
    const senderJid = getSenderJid(from, messageData);

    // 1. Activar Hora Feliz (Estrictamente Administrador Autorizado)
    if (sub === 'on' || sub === 'iniciar' || sub === 'activar' || sub === 'prender') {
        if (!isAuthorizedAdmin(from, messageData)) {
            const deniedMsg = '> ❌ Acceso denegado. Solo administradores pueden activar o desactivar la Hora Feliz.';
            await evolution.sendText(from, deniedMsg);
            return { success: false, reason: 'FORBIDDEN', message: deniedMsg };
        }

        let duration = 60;
        const argDuration = parsed.args?.[1] || parsed.flags?.duracion || parsed.flags?.duration || parsed.flags?.minutos;
        if (argDuration) {
            const parsedNum = parseInt(argDuration, 10);
            if (Number.isFinite(parsedNum) && parsedNum > 0) {
                duration = parsedNum;
            }
        }

        const result = await happyHour.startHappyHour({
            durationMinutes: duration,
            groupJid: from,
            adminJid: senderJid,
            broadcast: true
        });

        return { success: true, action: 'on', durationMinutes: duration, result };
    }

    // 2. Desactivar Hora Feliz (Estrictamente Administrador Autorizado)
    if (sub === 'off' || sub === 'apagar' || sub === 'detener' || sub === 'cancelar' || sub === 'desactivar') {
        if (!isAuthorizedAdmin(from, messageData)) {
            const deniedMsg = '> ❌ Acceso denegado. Solo administradores pueden activar o desactivar la Hora Feliz.';
            await evolution.sendText(from, deniedMsg);
            return { success: false, reason: 'FORBIDDEN', message: deniedMsg };
        }

        const result = await happyHour.stopHappyHour({
            groupJid: from,
            reason: 'admin_command',
            broadcast: true
        });

        return { success: true, action: 'off', result };
    }

    // 2.5 Forzar Lluvia / Drop manual (Solo Admin)
    if (sub === 'lluvia' || sub === 'drop') {
        if (!isAuthorizedAdmin(from, messageData)) {
            const deniedMsg = '> ❌ Acceso denegado. Solo administradores pueden forzar una lluvia de medios.';
            await evolution.sendText(from, deniedMsg);
            return { success: false, reason: 'FORBIDDEN', message: deniedMsg };
        }
        if (!happyHour.isHappyHourActive(from)) {
            await happyHour.startHappyHour({ durationMinutes: 60, groupJid: from, adminJid: senderJid, broadcast: true });
        }
        const res = await happyHour.triggerRainDrop(from, { force: true });
        return { success: true, action: 'lluvia', sent: res.sent };
    }

    // 2.6 Forzar AirDrop Express manual (Solo Admin)
    if (sub === 'airdrop') {
        if (!isAuthorizedAdmin(from, messageData)) {
            const deniedMsg = '> ❌ Acceso denegado. Solo administradores pueden lanzar un AirDrop Express.';
            await evolution.sendText(from, deniedMsg);
            return { success: false, reason: 'FORBIDDEN', message: deniedMsg };
        }
        if (!happyHour.isHappyHourActive(from)) {
            await happyHour.startHappyHour({ durationMinutes: 60, groupJid: from, adminJid: senderJid, broadcast: true });
        }
        await happyHour.triggerAirDrop(from);
        return { success: true, action: 'airdrop' };
    }

    // 3. Consulta de Estado (Público para cualquier miembro del grupo o chat)
    const status = happyHour.getHappyHourStatus(from);
    if (status.active) {
        const statusMsg =
            `🎉 *ESTADO DE LA HORA FELIZ* 🍻\n\n` +
            `• *Estado:* ¡ACTIVA! 🔥\n` +
            `• *Tiempo restante:* ${status.remainingMinutes} min (${status.remainingSeconds}s)\n` +
            `• *Bono de Experiencia:* +${status.xpMultiplier} XP por mensaje en grupo\n` +
            `• *Mercado Negro:* Packs a *${status.packCost} XP* (¡50% OFF, 4 a 6 fotos/vídeos!)\n` +
            `• *AirDrop Express:* ${status.airdropActive ? '🚨 ¡CAJA ACTIVA! El primero en poner YOO gana' : 'En espera de sorpresa'}\n\n` +
            `¡Aprovechen los beneficios mientras dure! 💃⚡`;
        await evolution.sendText(from, statusMsg);
        return { success: true, action: 'status', status };
    }

    const inactiveMsg =
        `💤 *La Hora Feliz no está activa en este momento.*\n\n` +
        `Los beneficios actuales son los estándar:\n` +
        `• +1 XP por mensaje en grupos\n` +
        `• Packs del Mercado Negro a 150 XP\n\n` +
        `💡 *Un administrador puede activarla con:* *!horafeliz on [minutos]*`;
    await evolution.sendText(from, inactiveMsg);
    return { success: true, action: 'status', status };
}

module.exports = {
    handleHoraFeliz
};
