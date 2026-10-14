'use strict';

const db = require('./db');
const evolution = require('./evolution');
const logger = require('./logger');

/**
 * Estado en memoria del sistema de Hora Feliz.
 */
const state = {
    active: false,
    groupJid: null,
    startedAt: null,
    activeUntil: 0,
    durationMinutes: 60,
    xpMultiplier: 20,
    discountPercent: 50,
    messagesSinceLastRain: 0,
    lastRainAt: 0,
    activeAirdrop: null,
    rainPhotoIds: new Set()
};

/**
 * Registro de temporizadores activos (.unref() para compatibilidad con Node test runner).
 */
let rainInFlight = null;

const timers = {
    expire: null,
    rain: null,
    airdrop: null
};

/**
 * Limpia todos los temporizadores activos en memoria.
 */
function clearTimers() {
    if (timers.expire) {
        clearTimeout(timers.expire);
        timers.expire = null;
    }
    if (timers.rain) {
        clearInterval(timers.rain);
        timers.rain = null;
    }
    if (timers.airdrop) {
        clearTimeout(timers.airdrop);
        timers.airdrop = null;
    }
}

/**
 * Reinicia el estado completo en memoria (utilizado en pruebas y al finalizar evento).
 */
function resetInMemoryState() {
    clearTimers();
    state.active = false;
    state.groupJid = null;
    state.startedAt = null;
    state.activeUntil = 0;
    state.durationMinutes = 60;
    state.xpMultiplier = 20;
    state.discountPercent = 50;
    state.messagesSinceLastRain = 0;
    state.lastRainAt = 0;
    state.activeAirdrop = null;
    state.rainPhotoIds = new Set();
}

/**
 * Inicializa y recupera el estado de Hora Feliz desde SQLite tras reinicios del proceso (R1).
 * @returns {Promise<void>}
 */
async function initHappyHourRecovery() {
    try {
        const row = await db.getHappyHourState();
        if (row && row.is_active === 1) {
            const now = Date.now();
            if (now < row.active_until) {
                const remainingMs = row.active_until - now;
                state.active = true;
                state.groupJid = row.group_jid || null;
                state.startedAt = row.started_at || (now - ((row.duration_minutes || 60) * 60 * 1000 - remainingMs));
                state.activeUntil = row.active_until;
                state.durationMinutes = row.duration_minutes || 60;
                state.xpMultiplier = row.xp_multiplier || 20;
                state.discountPercent = row.discount_percent || 50;
                state.messagesSinceLastRain = 0;
                state.lastRainAt = now;
                state.rainPhotoIds = new Set();

                if (row.airdrop_active === 1 && !row.airdrop_claimed) {
                    state.activeAirdrop = {
                        active: true,
                        claimed: false,
                        winnerJid: null,
                        winnerName: null,
                        prizeXp: 500,
                        triggeredAt: now
                    };
                } else {
                    state.activeAirdrop = null;
                }

                clearTimers();

                timers.expire = setTimeout(() => {
                    stopHappyHour({ groupJid: state.groupJid, reason: 'expired' }).catch(err => {
                        logger.error('[HappyHour] Error en expiración programada:', err.message);
                    });
                }, remainingMs);
                timers.expire.unref();

                timers.rain = setInterval(() => {
                    triggerRainDrop(state.groupJid, { force: true }).catch(err => {
                        logger.error('[HappyHour] Error en lluvia periódica:', err.message);
                    });
                }, 4 * 60 * 1000);
                timers.rain.unref();

                if (!state.activeAirdrop && remainingMs > 30_000) {
                    const delay = Math.min(60_000, Math.floor(remainingMs / 2));
                    timers.airdrop = setTimeout(() => {
                        triggerAirDrop(state.groupJid).catch(err => {
                            logger.error('[HappyHour] Error en airdrop programado:', err.message);
                        });
                    }, delay);
                    timers.airdrop.unref();
                }

                logger.info(`[HappyHour] Estado restaurado desde SQLite: ${Math.ceil(remainingMs / 60000)} min restantes en ${state.groupJid || 'todos'}`);
            } else {
                logger.info('[HappyHour] Evento expiró mientras el bot estaba apagado. Restaurando estado a inactivo.');
                await db.resetHappyHourState();
                resetInMemoryState();
            }
        }
    } catch (err) {
        logger.error('[HappyHour] Error en recuperación de estado:', err.message);
    }
}

/**
 * Inicia la Hora Feliz, persistiendo en SQLite, programando temporizadores y anunciando al grupo (R1).
 *
 * @param {object} params
 * @param {number} [params.durationMinutes=60] - Duración del evento en minutos
 * @param {string} [params.groupJid] - JID del grupo donde opera el evento
 * @param {string} [params.adminJid] - JID del administrador que invocó la orden
 * @param {boolean} [params.broadcast=true] - Si se debe enviar mensaje festivo al grupo
 * @returns {Promise<{ success: boolean, message: string, durationMinutes: number }>}
 */
async function startHappyHour({ durationMinutes = 60, groupJid = null, adminJid = null, broadcast = true } = {}) {
    const rawNum = Number(durationMinutes);
    const validMinutes = Number.isFinite(rawNum) && rawNum > 0 ? Math.min(Math.max(Math.round(rawNum), 1), 1440) : 60;
    const now = Date.now();
    const activeUntil = now + (validMinutes * 60 * 1000);

    clearTimers();

    state.active = true;
    state.groupJid = groupJid || null;
    state.startedAt = now;
    state.activeUntil = activeUntil;
    state.durationMinutes = validMinutes;
    state.xpMultiplier = 20;
    state.discountPercent = 50;
    state.messagesSinceLastRain = 0;
    state.lastRainAt = now;
    state.activeAirdrop = null;
    state.rainPhotoIds = new Set();

    await db.saveHappyHourState({
        is_active: 1,
        group_jid: state.groupJid,
        started_at: state.startedAt,
        active_until: activeUntil,
        duration_minutes: validMinutes,
        xp_multiplier: 20,
        discount_percent: 50,
        airdrop_active: 0,
        airdrop_claimed: 0,
        airdrop_winner_jid: null
    });

    timers.expire = setTimeout(() => {
        stopHappyHour({ groupJid: state.groupJid, reason: 'expired' }).catch(err => {
            logger.error('[HappyHour] Error al expirar:', err.message);
        });
    }, validMinutes * 60 * 1000);
    timers.expire.unref();

    timers.rain = setInterval(() => {
        triggerRainDrop(state.groupJid, { force: true }).catch(err => {
            logger.error('[HappyHour] Error al disparar lluvia periódica:', err.message);
        });
    }, 4 * 60 * 1000);
    timers.rain.unref();

    // Drop inicial de bienvenida a los 10 segundos
    setTimeout(() => {
        triggerRainDrop(state.groupJid, { force: true }).catch(() => {});
    }, 10_000).unref();

    // AirDrop Express sorpresa a los 60 segundos
    const airdropDelay = Math.min(60_000, Math.max(10_000, Math.floor(validMinutes * 60 * 1000 * 0.05)));
    timers.airdrop = setTimeout(() => {
        triggerAirDrop(state.groupJid).catch(err => {
            logger.error('[HappyHour] Error al disparar AirDrop sorpresa:', err.message);
        });
    }, airdropDelay);
    timers.airdrop.unref();

    const startMsg =
        `🎉🍻 *¡¡HORA FELIZ BOTSKY ACTIVADA!!* 🍻🎉\n\n` +
        `¡El descontrol ha comenzado, compas! Durante los próximos *${validMinutes} minutos*, la economía está rota:\n\n` +
        `✨ *+20 XP por mensaje* en este grupo (¡a cotorrear se ha dicho!).\n` +
        `📦 *50% DE DESCUENTO en Packs del Mercado Negro* (solo *75 XP* por 4 a 6 fotos/vídeos exclusivos con View Once al privado).\n` +
        `🌧️ *Lluvia de media* periódica directa en el grupo.\n` +
        `🚨 *AirDrops Express sorpresa* donde el más rápido en escribir "YOO" se llevará 500 XP y un pack gratis.\n\n` +
        `¡Aprovéchenla antes de que se acabe! 🍾🔥`;

    if (broadcast && state.groupJid) {
        evolution.sendText(state.groupJid, startMsg).catch(err => {
            logger.error('[HappyHour] Error enviando anuncio de inicio:', err.message);
        });
    }

    logger.info(`[HappyHour] Activada por ${validMinutes} minutos en ${state.groupJid || 'global'}`);

    return {
        success: true,
        message: startMsg,
        durationMinutes: validMinutes
    };
}

/**
 * Detiene la Hora Feliz, restableciendo la persistencia y enviando aviso de clausura (R1).
 *
 * @param {object} params
 * @param {string} [params.groupJid]
 * @param {string} [params.reason='manual']
 * @param {boolean} [params.broadcast=true]
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function stopHappyHour({ groupJid = null, reason = 'manual', broadcast = true } = {}) {
    if (!state.active) {
        return { success: false, message: 'La Hora Feliz no está activa en este momento.' };
    }

    const targetGroup = groupJid || state.groupJid;

    resetInMemoryState();

    await db.resetHappyHourState();

    const stopMsg =
        `🛑⏰ *¡LA HORA FELIZ HA TERMINADO!* ⏰🛑\n\n` +
        `Se acabó la fiesta y el descontrol. Los beneficios regresan a sus valores normales:\n\n` +
        `• Ganancia por mensaje: *+1 XP*\n` +
        `• Packs del Mercado Negro: *150 XP*\n\n` +
        `¡Gracias por participar y a seguir juntando lana para la próxima! 🍻💤`;

    if (broadcast && targetGroup) {
        evolution.sendText(targetGroup, stopMsg).catch(err => {
            logger.error('[HappyHour] Error enviando anuncio de fin:', err.message);
        });
    }

    logger.info(`[HappyHour] Desactivada (${reason}) en ${targetGroup || 'global'}`);

    return {
        success: true,
        message: stopMsg
    };
}

/**
 * Consulta rápida y síncrona si la Hora Feliz está activa (R3).
 * Soporta evaluación por JID de grupo o participante.
 *
 * @param {string} [target=null] - JID de grupo o de usuario
 * @param {string} [contextGroup=null] - JID de grupo en contexto si target es usuario
 * @returns {boolean}
 */
function isHappyHourActive(target = null, contextGroup = null) {
    if (!state.active) return false;
    if (Date.now() >= state.activeUntil) {
        stopHappyHour({ reason: 'expired' }).catch(() => {});
        return false;
    }

    const checkGroup =
        (typeof target === 'string' && target.endsWith('@g.us'))
            ? target
            : (typeof contextGroup === 'string' && contextGroup.endsWith('@g.us') ? contextGroup : null);

    if (checkGroup && state.groupJid && state.groupJid !== checkGroup) {
        return false;
    }

    return true;
}

/**
 * Consulta el estado y parámetros detallados de la Hora Feliz (R1).
 *
 * @param {string} [groupJid=null]
 * @returns {{ active: boolean, remainingMinutes: number, remainingSeconds: number, xpMultiplier: number, packCost: number, airdropActive: boolean, groupJid: string|null }}
 */
function getHappyHourStatus(groupJid = null) {
    if (!isHappyHourActive(groupJid)) {
        return {
            active: false,
            remainingMinutes: 0,
            remainingSeconds: 0,
            xpMultiplier: 1,
            packCost: 150,
            airdropActive: false,
            groupJid: null
        };
    }

    const remainingMs = Math.max(0, state.activeUntil - Date.now());
    return {
        active: true,
        remainingMinutes: Math.ceil(remainingMs / (60 * 1000)),
        remainingSeconds: Math.ceil(remainingMs / 1000),
        xpMultiplier: state.xpMultiplier,
        packCost: 75,
        airdropActive: Boolean(state.activeAirdrop && state.activeAirdrop.active && !state.activeAirdrop.claimed),
        groupJid: state.groupJid
    };
}

/**
 * Notificación de mensaje entrante en grupo para seguimiento de actividad y lluvia (R2).
 *
 * @param {object} norm - Mensaje normalizado
 * @returns {Promise<void>}
 */
async function onIncomingGroupMessage(norm) {
    if (!isHappyHourActive(norm?.from)) return;
    state.messagesSinceLastRain++;

    if (state.messagesSinceLastRain >= 5 && (Date.now() - state.lastRainAt >= 90 * 1000)) {
        await triggerRainDrop(norm.from).catch(() => {});
    }
}

/**
 * Despacha una lluvia de medios (1-2 fotos/vídeos) con copys festivos al grupo (R2).
 * Protege contra saturación omitiendo el envío si no ha habido mensajes nuevos en el chat (salvo options.force).
 *
 * @param {string} [groupJid=null]
 * @param {object} [options={}]
 * @returns {Promise<{ sent: number, items: Array }>}
 */
async function triggerRainDrop(groupJid = null, options = {}) {
    const targetGroup = groupJid || state.groupJid;
    if (!targetGroup || !isHappyHourActive(targetGroup)) {
        return { sent: 0, items: [] };
    }

    const deck = state.rainPhotoIds;
    if (rainInFlight === deck) return { sent: 0, items: [] };
    rainInFlight = deck;
    try { return await sendRainDrop(targetGroup, options); }
    finally { if (rainInFlight === deck) rainInFlight = null; }
}

async function sendRainDrop(targetGroup, options) {
    // Capture this event's deck so a late send cannot pollute a new event.
    const seen = state.rainPhotoIds;
    // Protección contra saturación durante períodos de inactividad
    if (!options.force && state.messagesSinceLastRain === 0) {
        logger.info(`[HappyHour-Rain] Omitiendo lluvia en ${targetGroup} por inactividad de chat.`);
        return { sent: 0, items: [] };
    }

    state.messagesSinceLastRain = 0;
    state.lastRainAt = Date.now();

    const count = Math.floor(Math.random() * 2) + 1; // 1 o 2 elementos
    let items = [];

    try {
        const { createRikolinoReader } = require('./rikolinoLibrary');
        const reader = createRikolinoReader();
        items = await reader.getImages(null, { count, randomize: true, excludePhotoIds: [...seen] });
    } catch (rikErr) {
        logger.warn(`[HappyHour-Rain] Rikolino reader no disponible: ${rikErr.message}. Usando proveedor de packs.`);
    }

    if (!items || items.length === 0) {
        try {
            const packImages = require('./packImages');
            items = await packImages.getPackImages(null, { count, excludePhotoIds: [...seen] });
        } catch (packErr) {
            logger.warn(`[HappyHour-Rain] Proveedor de fotos alternativo falló: ${packErr.message}`);
        }
    }

    if (!items || items.length === 0) {
        logger.warn(`[HappyHour-Rain] No se encontraron elementos multimedia para la lluvia en ${targetGroup}.`);
        return { sent: 0, items: [] };
    }

    const identity = item => item?.id || item?.path;
    const unique = new Set();
    items = items.filter(item => {
        const id = identity(item);
        if (!item?.path || !id || unique.has(id)) return false;
        unique.add(id); return true;
    });
    // A provider may fill the last partial batch with already-seen photos.
    // Finish the unseen tail first; start another cycle only when it is empty.
    const unseen = items.filter(item => !seen.has(identity(item)));
    let restartDeck = items.length > 0 && unseen.length === 0;
    if (unseen.length) items = unseen;

    const RAIN_CAPTIONS = [
        '🌧️ ¡LLUVIA DE MEDIA! 🌧️\nDisfruten la cortesía de la Hora Feliz, compas. 🔥',
        '🍻 ¡Cortesía de la Hora Feliz! 🍻\nUn regalito para alegrar el cotorreo.',
        '🌧️ ¡Aguacero de contenido en la Hora Feliz! 🌧️\nSigan cotorreando para más sorpresas. 💃',
        '🔥 ¡Media rain directa al grupo! 🔥\nCortesía de Botsky en esta Hora Feliz.'
    ];

    let sentCount = 0;
    for (const item of items) {
        if (state.rainPhotoIds !== seen || !isHappyHourActive(targetGroup)) break;
        if (item?.path) {
            const caption = RAIN_CAPTIONS[Math.floor(Math.random() * RAIN_CAPTIONS.length)];
            try {
                await evolution.sendMedia(targetGroup, item.path, caption);
                if (restartDeck) { seen.clear(); restartDeck = false; }
                seen.add(identity(item));
                sentCount++;
            } catch (err) {
                logger.error(`[HappyHour-Rain] Error enviando medio a ${targetGroup}:`, err.message);
            }
        }
    }

    logger.info(`[HappyHour-Rain] Despachados ${sentCount} medios a ${targetGroup}`);
    return { sent: sentCount, items };
}

/**
 * Dispara el evento sorpresa de AirDrop Express en el grupo (R4).
 *
 * @param {string} [groupJid=null]
 * @returns {Promise<boolean>}
 */
async function triggerAirDrop(groupJid = null) {
    const targetGroup = groupJid || state.groupJid;
    if (!targetGroup || !isHappyHourActive(targetGroup)) return false;

    state.activeAirdrop = {
        active: true,
        claimed: false,
        winnerJid: null,
        winnerName: null,
        prizeXp: 500,
        triggeredAt: Date.now()
    };

    await db.saveHappyHourState({
        airdrop_active: 1,
        airdrop_claimed: 0,
        airdrop_winner_jid: null
    }).catch(err => {
        logger.error('[HappyHour-AirDrop] Error persistiendo airdrop en SQLite:', err.message);
    });

    const dropMsg =
        `🚨🚨 *¡¡AIRDROP EXPRESS DE HORA FELIZ!!* 🚨🚨\n\n` +
        `🎁 ¡Una caja de suministros ha caído en el grupo!\n\n` +
        `👉 *¡El primero que responda exactamente "YOO" se lleva 500 XP y un pack privado gratis!* 👈\n\n` +
        `¡Rápido antes de que te lo ganen! ⚡💨`;

    await evolution.sendText(targetGroup, dropMsg).catch(err => {
        logger.error('[HappyHour-AirDrop] Error anunciando airdrop:', err.message);
    });

    logger.info(`[HappyHour-AirDrop] AirDrop Express disparado en ${targetGroup}`);
    return true;
}

/**
 * Consulta si un AirDrop Express está actualmente activo y sin reclamar (R4).
 *
 * @param {string} [groupJid=null]
 * @returns {boolean}
 */
function isAirdropActive(groupJid = null) {
    if (!isHappyHourActive(groupJid)) return false;
    return Boolean(state.activeAirdrop && state.activeAirdrop.active && !state.activeAirdrop.claimed);
}

/**
 * Reclama el AirDrop Express con candado síncrono en memoria para eliminar condiciones de carrera (R4).
 * El primer usuario en llegar se adjudica el premio de inmediato en el tick actual antes de cualquier yield asíncrono.
 *
 * @param {string} groupJid - JID del grupo
 * @param {string} participant - JID del usuario reclamante
 * @param {string} text - Contenido del mensaje recibido
 * @param {string} [pushName] - Nombre del usuario
 * @param {object} [messageData={}] - Metadatos del mensaje
 * @returns {Promise<{ success: boolean, reason?: string, winner?: object }>}
 */
async function claimAirdrop(groupJid, participant, text, pushName, messageData = {}, options = {}) {
    if (!isHappyHourActive(groupJid)) {
        return { success: false, reason: 'NOT_ACTIVE' };
    }

    // ─── CANDADO SÍNCRONO EN EL MISMO TICK DE EVENT LOOP ───────────────────────
    // Previene condiciones de carrera por webhooks concurrentes antes de cualquier await.
    if (!state.activeAirdrop || !state.activeAirdrop.active || state.activeAirdrop.claimed) {
        return { success: false, reason: 'ALREADY_CLAIMED' };
    }

    state.activeAirdrop.claimed = true;
    state.activeAirdrop.active = false;
    state.activeAirdrop.winnerJid = participant;
    state.activeAirdrop.winnerName = pushName || 'Compa';
    // ──────────────────────────────────────────────────────────────────────────

    logger.info(`[HappyHour-AirDrop] ¡AirDrop reclamado por ${participant} (${pushName})!`);

    try {
        await db.saveHappyHourState({
            airdrop_active: 0,
            airdrop_claimed: 1,
            airdrop_winner_jid: participant
        });
    } catch (dbErr) {
        logger.error('[HappyHour-AirDrop] Error guardando ganador en SQLite:', dbErr.message);
    }

    try {
        await db.addXp(participant, 500);
    } catch (xpErr) {
        logger.error(`[HappyHour-AirDrop] Error otorgando 500 XP a ${participant}:`, xpErr.message);
    }

    const cleanNum = (participant || '').replace(/[^0-9]/g, '');
    const winMsg =
        `🎉🏆 *¡¡TENEMOS GANADOR DEL AIRDROP EXPRESS!!* 🏆🎉\n\n` +
        `¡@${cleanNum} fue el más rápido de todos y se llevó el AirDrop!\n\n` +
        `💰 *+500 XP* sumados a su cuenta.\n` +
        `📦 *Pack privado* en camino a su chat con View Once.\n\n` +
        `¡El AirDrop ha sido cerrado! Los demás sigan atentos al chat. 🔥⚡`;

    evolution.sendText(groupJid, winMsg, {
        mentions: [participant]
    }).catch(err => {
        logger.error('[HappyHour-AirDrop] Error anunciando ganador:', err.message);
    });

    // Despacho del pack privado gratis con View Once al ganador
    let packPromise = null;
    try {
        const { handlePack } = require('../commands/pack');
        const fakeMessageData = messageData?.key
            ? messageData
            : { key: { participant, remoteJid: groupJid }, participant, pushName };

        packPromise = handlePack({ args: [], flags: {} }, groupJid, fakeMessageData, {
            free: true,
            cost: 0,
            isHappyHour: true,
            sendConfirmation: false,
            throttleMs: options.throttleMs !== undefined ? options.throttleMs : 500,
            customDir: options.customDir || undefined
        }).catch(err => {
            logger.error('[HappyHour-AirDrop] Error despachando pack gratuito:', err.message);
        });
    } catch (packErr) {
        logger.error('[HappyHour-AirDrop] Error invocando handlePack:', packErr.message);
    }

    return {
        success: true,
        winner: {
            jid: participant,
            name: pushName || 'Compa',
            prizeXp: 500
        },
        packPromise
    };
}

module.exports = {
    startHappyHour,
    stopHappyHour,
    isHappyHourActive,
    getHappyHourStatus,
    initHappyHourRecovery,
    onIncomingGroupMessage,
    triggerRainDrop,
    triggerAirDrop,
    isAirdropActive,
    claimAirdrop,
    clearTimers,
    resetInMemoryState
};
