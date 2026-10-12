'use strict';

const { sendText, getGroupInfo, updateParticipant } = require('../services/evolution');
const { isUserAdmin, isBotAdmin } = require('./moderacion');
const db = require('../services/db');
const logger = require('../services/logger');

const BOT_NUMBER = (process.env.BOT_NUMBER || '5214437367565').replace(/[^0-9]/g, '');
const NUCLEAR_XP_COST = 5000;
const KICK_DELAY_MS = 4000;

// Mutex de grupos con detonación activa
const activeDetonations = new Set();

let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function _setSleepFn(fn) { sleep = fn; }

/**
 * Determina si un participante del grupo es el bot.
 */
function isBotParticipant(p) {
    if (!p) return false;
    const cleanId = (p.id || '').replace(/[^0-9]/g, '');
    const cleanPhone = (p.phoneNumber || '').replace(/[^0-9]/g, '');
    return cleanId.includes(BOT_NUMBER) || cleanPhone.includes(BOT_NUMBER);
}

/**
 * Manejador principal del comando nuclear kamikaze.
 */
async function handleNuclear(parsed = {}, from, messageData = {}) {
    const isGroup = typeof from === 'string' && from.endsWith('@g.us');
    if (!isGroup) {
        return await sendText(from, '> ☢️ La bomba nuclear solo se puede detonar en grupos.');
    }

    if (activeDetonations.has(from)) {
        return await sendText(from, '> ⚠️ Ya hay una detonación nuclear en curso en este grupo. Espera el impacto.');
    }

    activeDetonations.add(from);

    const participant = messageData?.key?.participant || messageData?.participant || from;
    const userName = messageData?.pushName || 'El Atacante';

    try {
        // 1. Verificar XP del usuario
        const user = await db.getOrCreateUser(participant);
        if (user.xp < NUCLEAR_XP_COST) {
            activeDetonations.delete(from);
            return await sendText(from,
                `> ☢️ No tienes suficiente experiencia para detonar la bomba nuclear.\n` +
                `Necesitas *${NUCLEAR_XP_COST.toLocaleString('es-MX')} XP* y tienes *${user.xp.toLocaleString('es-MX')} XP*.`
            );
        }

        // 2. Obtener información y verificar permisos del bot
        let groupData = null;
        try {
            const res = await getGroupInfo(from);
            groupData = res?.data || res;
        } catch (e) {
            activeDetonations.delete(from);
            logger.error(`[NUCLEAR] Error al obtener info del grupo: ${e.message}`);
            return await sendText(from, `> ❌ Error al verificar permisos del grupo: ${e.message}`);
        }

        if (!isBotAdmin(groupData)) {
            activeDetonations.delete(from);
            return await sendText(from, '> ☢️ Botsky requiere permisos de *Administrador* para activar el protocolo nuclear.');
        }

        const participants = groupData?.participants || [];
        if (participants.length === 0) {
            activeDetonations.delete(from);
            return await sendText(from, '> ⚠️ No se pudo leer la lista de participantes del grupo.');
        }

        // 3. Consumir XP del atacante
        await db.subtractXp(participant, NUCLEAR_XP_COST);
        // Alerta de detonación y cuenta regresiva
        await sendText(from,
            `🚨 *¡¡ALERTA NUCLEAR ACTIVADA!!* 🚨\n\n` +
            `Detonada por: *${userName}*\n` +
            `Costo: *${NUCLEAR_XP_COST} XP* consumidos (Sacrificio Kamikaze).\n\n` +
            `⚠️ Protocolo de aniquilación iniciado.\n` +
            `Detonación en 5 segundos... Todos los no-administradores serán purgados.`
        );

        await sleep(5000);

        // 4. Filtrar objetivos
        // - El bot no se purga
        // - Los admins (excepto el atacante) sobreviven en el búnker
        // - El atacante muere: si es admin, se degrada primero para poder expulsarlo
        const attackerIsAdmin = isUserAdmin(groupData, participant);
        if (attackerIsAdmin) {
            try {
                await updateParticipant(from, 'demote', [participant]);
                logger.info(`[NUCLEAR] Atacante admin degradado para sacrificio kamikaze: ${participant}`);
            } catch (err) {
                logger.warn(`[NUCLEAR] No se pudo degradar al atacante admin: ${err.message}`);
            }
        }

        const targetsToKick = [];
        const adminSurvivors = [];

        for (const p of participants) {
            if (isBotParticipant(p)) continue;

            const isCurrentAttacker = (p.id && p.id.includes(participant.replace(/@.*/, ''))) ||
                                      (p.phoneNumber && p.phoneNumber.includes(participant.replace(/@.*/, '')));

            const isAdmin = p.admin === 'admin' || p.admin === 'superadmin';

            if (isCurrentAttacker) {
                // El atacante siempre entra a la lista de purga (Kamikaze)
                targetsToKick.push({
                    jid: p.id || participant,
                    name: userName
                });
            } else if (isAdmin) {
                // Administradores protegidos en el búnker
                adminSurvivors.push(p);
            } else {
                // Miembros normales purgados
                targetsToKick.push({
                    jid: p.id,
                    name: p.id?.split('@')[0] || 'Miembro'
                });
            }
        }

        if (targetsToKick.length === 0) {
            return await sendText(from, '> ☢️ No hay miembros vulnerables que purgar en este grupo (solo hay administradores protegidos).');
        }

        // 5. Secuencia de expulsión con retardo de 4 segundos
        let purgedCount = 0;
        for (const target of targetsToKick) {
            try {
                await updateParticipant(from, 'remove', [target.jid]);
                purgedCount++;
                logger.info(`[NUCLEAR] Purgado: ${target.jid} (${purgedCount}/${targetsToKick.length})`);
            } catch (kickErr) {
                logger.error(`[NUCLEAR] Error al purgar a ${target.jid}: ${kickErr.message}`);
            }
            await sleep(KICK_DELAY_MS);
        }

        // 6. Conclusión
        await sendText(from,
            `☢️ *DETONACIÓN NUCLEAR CONCLUIDA*\n\n` +
            `💥 Bajas totales: *${purgedCount} miembros purgados* (incluyendo al atacante).\n` +
            `🛡️ Sobrevivientes: *${adminSurvivors.length} administradores* protegidos en el búnker.`
        );
    } catch (err) {
        logger.error('[NUCLEAR] Error durante la detonación nuclear:', err);
        await sendText(from, `> ❌ Error en el protocolo nuclear: ${err.message}`);
    } finally {
        activeDetonations.delete(from);
    }
}

module.exports = {
    handleNuclear,
    activeDetonations,
    NUCLEAR_XP_COST,
    KICK_DELAY_MS,
    _setSleepFn
};
