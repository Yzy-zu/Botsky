'use strict';

const fs = require('fs');
const path = require('path');
const { sendText, sendMedia } = require('../services/evolution');
const db = require('../services/db');
const logger = require('../services/logger');
const { generateCensoredImage } = require('../services/imageCensor');
const { getCooperachaImage } = require('../services/cooperachaImages');
const { cleanCategory } = require('../services/packImages');

// ─── Sesiones Activas en Memoria ──────────────────────────────────────────────
// Clave: groupJid -> CooperachaSession
const activeSessions = new Map();

const DEFAULT_TARGET_XP = 500;
const MIN_TARGET_XP = 50;
const MAX_TARGET_XP = 50000;
const DEFAULT_DURATION_MS = 10 * 60 * 1000; // 10 minutos

/**
 * Determina si un grupo está autorizado para ejecutar la cooperacha.
 * Solo se admiten grupos (@g.us) y deben pertenecer a las listas autorizadas si están configuradas.
 *
 * @param {string} from - JID del chat o grupo
 * @returns {boolean}
 */
function isGroupAuthorized(from, options = {}) {
    if (!from || typeof from !== 'string' || !from.endsWith('@g.us')) {
        return false;
    }

    if (options.authorized || options.skipAuth || activeSessions.has(from)) {
        return true;
    }

    const normal = process.env.ALLOWED_GROUPS_NORMAL;
    const admin = process.env.ALLOWED_GROUPS_ADMIN;

    // Si no hay configuración restrictiva de grupos, se permite en cualquier grupo válido
    if (!normal && !admin) {
        return true;
    }

    const allowed = [
        ...(normal ? normal.split(',') : []),
        ...(admin ? admin.split(',') : [])
    ].map(g => g.trim().replace(/@.*$/, '')).filter(Boolean);

    if (allowed.length === 0) {
        return true;
    }

    const clean = from.replace(/[^0-9]/g, '');
    return allowed.some(id => from.includes(id) || clean.includes(id.replace(/[^0-9]/g, '')));
}

/**
 * Verifica si hay una sesión activa de cooperacha en el grupo.
 *
 * @param {string} groupJid - JID del grupo
 * @returns {boolean}
 */
function hasActiveCooperacha(groupJid) {
    return activeSessions.has(groupJid);
}

/**
 * Obtiene la sesión activa de cooperacha de un grupo.
 *
 * @param {string} groupJid - JID del grupo
 * @returns {object|null}
 */
function getCooperachaSession(groupJid) {
    return activeSessions.get(groupJid) || null;
}

/**
 * Formatea milisegundos restantes a cadena legible ("X min Y seg").
 *
 * @param {number} ms - Milisegundos restantes
 * @returns {string}
 */
function formatTimeRemaining(ms) {
    if (ms <= 0) return '0 seg';
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min > 0) {
        return `${min} min ${sec} seg`;
    }
    return `${sec} seg`;
}

/**
 * Genera una barra de progreso visual de 10 bloques.
 *
 * @param {number} current - XP actual
 * @param {number} target - Meta de XP
 * @returns {string}
 */
function generateProgressBar(current, target) {
    const ratio = Math.min(1, Math.max(0, current / target));
    const filled = Math.round(ratio * 10);
    const empty = 10 - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

/**
 * Limpia archivos temporales asociados a una sesión sin lanzar errores.
 *
 * @param {object} session - Sesión de cooperacha
 */
function cleanSessionTempFiles(session) {
    if (!session) return;
    try {
        if (session.imageCensoredPath && fs.existsSync(session.imageCensoredPath)) {
            fs.unlinkSync(session.imageCensoredPath);
        }
    } catch (_) {}

    try {
        if (session.isTemporaryImage && session.imageOriginalPath && fs.existsSync(session.imageOriginalPath)) {
            fs.unlinkSync(session.imageOriginalPath);
        }
    } catch (_) {}
}

/**
 * Finaliza la cooperacha por expiración de tiempo:
 * Retiene 20% de comisión y reembolsa automáticamente el 80% a cada donador.
 * La imagen original NUNCA se envía.
 *
 * @param {string} groupJid - JID del grupo
 * @returns {Promise<object|null>}
 */
async function expireCooperacha(groupJid) {
    const session = activeSessions.get(groupJid);
    if (!session || session.status !== 'active') {
        return null;
    }

    session.status = 'expired';
    if (session.timer) {
        clearTimeout(session.timer);
        session.timer = null;
    }
    activeSessions.delete(groupJid);

    const refunds = [];
    let totalRefunded = 0;
    let totalCommission = 0;

    for (const [userJid, data] of session.contributors.entries()) {
        const donated = data.total;
        const refund = Math.floor(donated * 0.8);
        const commission = donated - refund;

        totalRefunded += refund;
        totalCommission += commission;

        try {
            await db.refundUserXp(userJid, refund);
            refunds.push({
                jid: userJid,
                name: data.name,
                donated,
                refund,
                commission
            });
        } catch (err) {
            logger.error(`[COOPERACHA] Error reembolsando XP a ${userJid}: ${err.message}`);
        }
    }

    // Destruir imagen original para asegurar que nunca se revele
    cleanSessionTempFiles(session);

    let refundsText = 'Nadie aportó ni un peso, pinches marros.';
    if (refunds.length > 0) {
        refundsText = refunds
            .map(r => `• *${r.name}:* Aportó ${r.donated.toLocaleString('es-MX')} XP ➔ Reembolso: *+${r.refund.toLocaleString('es-MX')} XP* (Comisión: -${r.commission.toLocaleString('es-MX')} XP)`)
            .join('\n');
    }

    const message =
        `⏰ *¡SE LES ACABÓ EL TIEMPO, PINCHIS MARROS!* ⏰\n\n` +
        `No lograron juntar la meta de *${session.targetXp.toLocaleString('es-MX')} XP* (apenas llegaron a *${session.currentXp.toLocaleString('es-MX')} XP*).\n\n` +
        `Por codos y lentos, Botsky se cobra el *20% de comisión* de penalización y les devuelve el *80%* de lo que metieron.\n\n` +
        `💸 *Reembolsos procesados (80%):*\n${refundsText}\n\n` +
        `❌ *La foto original ha sido destruida y jamás será revelada.* ¡A la próxima le meten con ganas!`;

    try {
        await sendText(groupJid, message);
    } catch (sendErr) {
        logger.error(`[COOPERACHA] Error enviando mensaje de expiración a ${groupJid}: ${sendErr.message}`);
    }

    return {
        groupJid,
        status: 'expired',
        totalCollected: session.currentXp,
        totalRefunded,
        totalCommission,
        refunds
    };
}

/**
 * Finaliza la cooperacha exitosamente al alcanzar el 100% de la meta:
 * Envía la foto original destapada inmediatamente vía sendMedia con mensaje celebratorio.
 *
 * @param {string} groupJid - JID del grupo
 * @returns {Promise<object|null>}
 */
async function completeCooperacha(groupJid) {
    const session = activeSessions.get(groupJid);
    if (!session || session.status !== 'active') {
        return null;
    }

    session.status = 'completed';
    if (session.timer) {
        clearTimeout(session.timer);
        session.timer = null;
    }
    activeSessions.delete(groupJid);

    // Obtener los mayores donadores
    const donorList = Array.from(session.contributors.values()).sort((a, b) => b.total - a.total);
    const topDonor = donorList[0] || { name: 'Compa', total: 0 };

    let rankingText = '';
    if (donorList.length > 0) {
        rankingText = donorList
            .slice(0, 3)
            .map((d, idx) => `${idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'} *${d.name}:* ${d.total.toLocaleString('es-MX')} XP`)
            .join('\n');
    }

    const deckNotice = session.deckCycled
        ? `\n\n🏆 *¡Colección completada!* El grupo ha desbloqueado todas las fotos de este álbum. La baraja se ha reiniciado para las próximas cooperachas.`
        : '';

    const caption =
        `🎉 *¡SE ARMÓ LA COOPERACHA, CABRONES!* 🎉\n\n` +
        `¡Juntaron completitos los *${session.targetXp.toLocaleString('es-MX')} XP*!\n` +
        `Aquí tienen la foto original, ya sin censura.\n\n` +
        `👑 *Compa de honor:* *${topDonor.name}* aportó *${topDonor.total.toLocaleString('es-MX')} XP*\n` +
        (rankingText ? `\n🏆 *Mayores donadores:*\n${rankingText}\n\n` : '\n') +
        `¡Disfruten, raza! Botsky cumplió su palabra. 🚀` +
        deckNotice;

    try {
        if (!session.imageOriginalPath || !fs.existsSync(session.imageOriginalPath)) {
            throw new Error('La imagen original no está disponible en el servidor');
        }
        await sendMedia(groupJid, session.imageOriginalPath, caption);

        // Registro en historial anti-repetición tras entrega exitosa de la foto destapada
        try {
            if (session.deckCycled && typeof db.clearDeliveredPhotoHistory === 'function') {
                await db.clearDeliveredPhotoHistory('group', groupJid, session.category || '');
            }
            if (session.photoId && typeof db.recordDeliveredPhotos === 'function') {
                await db.recordDeliveredPhotos('group', groupJid, session.category || '', [session.photoId]);
            }
        } catch (saveHistErr) {
            logger.warn(`[COOPERACHA] Error guardando historial de entrega para ${groupJid}: ${saveHistErr.message}`);
        }
    } catch (mediaErr) {
        logger.error(`[COOPERACHA] Error enviando media destapada a ${groupJid}: ${mediaErr.message}`);
        await sendText(groupJid, `🎉 *¡Cooperacha completada!* Pero ocurrió un error al despachar la imagen: ${mediaErr.message}`);
    }

    cleanSessionTempFiles(session);

    return {
        groupJid,
        status: 'completed',
        totalCollected: session.currentXp,
        topDonor,
        deckCycled: Boolean(session.deckCycled),
        photoId: session.photoId
    };
}

/**
 * Cancela una sesión activa manualmente (por admin o prueba), reembolsando el 100% de lo aportado.
 *
 * @param {string} groupJid - JID del grupo
 * @returns {Promise<object|null>}
 */
async function cancelCooperacha(groupJid) {
    const session = activeSessions.get(groupJid);
    if (!session) return null;

    session.status = 'cancelled';
    if (session.timer) {
        clearTimeout(session.timer);
        session.timer = null;
    }
    activeSessions.delete(groupJid);

    for (const [userJid, data] of session.contributors.entries()) {
        try {
            await db.addXp(userJid, data.total);
        } catch (_) {}
    }

    cleanSessionTempFiles(session);
    await sendText(groupJid, '> 🛑 *Cooperacha cancelada.* Se reembolsó el 100% de lo aportado a cada participante.');
    return { cancelled: true };
}

/**
 * Inicia una nueva sesión de reto de cooperacha en un grupo.
 *
 * @param {string} from - JID del grupo
 * @param {object} messageData - Datos del mensaje
 * @param {object} [options] - Opciones (targetXp, category, durationMs, customDir)
 * @returns {Promise<object|null>}
 */
async function startCooperacha(from, messageData = {}, options = {}) {
    if (!isGroupAuthorized(from, options)) {
        if (!from || !from.endsWith('@g.us')) {
            await sendText(from, '> 🪙 La Cooperacha de XP solo se puede jugar en grupos de WhatsApp.');
        } else {
            await sendText(from, '> ❌ Este grupo no está autorizado para jugar a la cooperacha de XP.');
        }
        return null;
    }

    if (activeSessions.has(from)) {
        const session = activeSessions.get(from);
        const remaining = formatTimeRemaining(session.expiresAt - Date.now());
        await sendText(
            from,
            `> ⚠️ Ya hay una cooperacha activa en este grupo.\n` +
            `Meta: *${session.currentXp.toLocaleString('es-MX')} / ${session.targetXp.toLocaleString('es-MX')} XP* | Tiempo restante: *${remaining}*\n` +
            `¡Métele XP con \`!coop <cantidad>\` o \`le meto <cantidad>\`!`
        );
        return null;
    }

    // 1. Determinar meta de XP
    let targetXp = options.targetXp || DEFAULT_TARGET_XP;
    if (typeof targetXp !== 'number' || isNaN(targetXp)) {
        targetXp = DEFAULT_TARGET_XP;
    }
    targetXp = Math.max(MIN_TARGET_XP, Math.min(MAX_TARGET_XP, Math.round(targetXp)));

    // 2. Obtener imagen (híbrido: local / web) con filtro anti-repetición
    const category = options.category || null;
    const cleanCat = category ? (cleanCategory ? cleanCategory(category) : String(category).trim().toLowerCase()) : '';
    let excludePhotoIds = [];
    if (typeof db.getDeliveredPhotoIds === 'function') {
        try {
            const seenSet = await db.getDeliveredPhotoIds('group', from, cleanCat);
            if (seenSet && seenSet.size > 0) {
                excludePhotoIds = Array.from(seenSet);
            }
        } catch (histErr) {
            logger.warn(`[COOPERACHA] Error consultando historial de entregas: ${histErr.message}`);
        }
    }

    const imgResult = await getCooperachaImage(category, {
        customDir: options.customDir,
        excludePhotoIds: options.excludePhotoIds !== undefined ? options.excludePhotoIds : excludePhotoIds
    });

    if (!imgResult || !imgResult.path) {
        await sendText(from, '> ⚠️ No pude conseguir una imagen para el reto en este momento, compa. Intenta más al rato.');
        return null;
    }

    // 3. Generar versión censurada sin bloquear event loop
    let censoredPath = null;
    try {
        censoredPath = await generateCensoredImage(imgResult.path);
    } catch (censorErr) {
        logger.error(`[COOPERACHA] Error generando imagen censurada: ${censorErr.message}`);
        if (imgResult.isTemporary && fs.existsSync(imgResult.path)) {
            try { fs.unlinkSync(imgResult.path); } catch (_) {}
        }
        await sendText(from, '> ❌ Error procesando el filtro de censura de la imagen. Intenta de nuevo.');
        return null;
    }

    // 4. Configurar sesión y temporizador
    const durationMs = options.durationMs || DEFAULT_DURATION_MS;
    const session = {
        groupJid: from,
        targetXp,
        currentXp: 0,
        contributors: new Map(), // jid -> { total: number, name: string, jid: string }
        recentDonors: [], // { name, amount, timestamp }
        imageOriginalPath: imgResult.path,
        imageCensoredPath: censoredPath,
        photoId: imgResult.id || path.basename(imgResult.path),
        category: cleanCat,
        deckCycled: Boolean(imgResult.deckCycled),
        isTemporaryImage: imgResult.isTemporary,
        createdAt: Date.now(),
        expiresAt: Date.now() + durationMs,
        timer: null,
        status: 'active'
    };

    session.timer = setTimeout(async () => {
        try {
            await expireCooperacha(from);
        } catch (expErr) {
            logger.error(`[COOPERACHA] Error al expirar sesión en ${from}: ${expErr.message}`);
        }
    }, durationMs);
    if (session.timer && typeof session.timer.unref === 'function') {
        session.timer.unref();
    }

    activeSessions.set(from, session);

    // 5. Enviar previsualización censurada al grupo vía sendMedia
    const opener = options.customOpener ? `${options.customOpener}\n\n` : '';
    const caption =
        opener +
        `🖼️ *¡NUEVO RETO: COOPERACHA DE XP!* 🪙\n\n` +
        `He publicado una foto censurada en el grupo. ¿Quieren verla destapada y sin censura?\n\n` +
        `🎯 *Meta:* ${targetXp.toLocaleString('es-MX')} XP\n` +
        `⏳ *Tiempo límite:* 10 minutos\n` +
        `💰 *Aportar:* Escribe \`!coop <cantidad>\` o \`le meto <cantidad>\`\n\n` +
        `⚠️ *Ojo:* Si no juntan la meta a tiempo, Botsky se queda con el 20% de comisión por codos y solo les reembolsa el 80%. ¡Apóyenle, no sean marros!`;

    try {
        await sendMedia(from, censoredPath, caption);
    } catch (sendErr) {
        logger.error(`[COOPERACHA] Error enviando imagen censurada a ${from}: ${sendErr.message}`);
        // Si sendMedia falla por webhook o cliente, informar por texto
        await sendText(from, `🖼️ *¡Cooperacha creada!* Meta: ${targetXp} XP (Error enviando foto: ${sendErr.message})`);
    }

    return session;
}

/**
 * Procesa la aportación de XP de un usuario a la cooperacha activa.
 * Deduce el saldo atómicamente de SQLite (`users.xp`).
 *
 * @param {string} from - JID del grupo
 * @param {string} participant - JID del usuario que aporta
 * @param {string} userName - Nombre visible del usuario
 * @param {number|string} amount - Cantidad de XP a aportar
 * @returns {Promise<object>}
 */
async function contributeToCooperacha(from, participant, userName, amount) {
    const session = activeSessions.get(from);
    if (!session || session.status !== 'active') {
        await sendText(from, '> No hay ninguna cooperacha activa en este grupo. Escribe `!coop` para arrancar una.');
        return { success: false, reason: 'NO_ACTIVE_SESSION' };
    }

    const num = Number(amount);
    if (!Number.isInteger(num) || num <= 0) {
        await sendText(from, '> ❌ La cantidad a aportar debe ser un número entero mayor a 0, compa.');
        return { success: false, reason: 'INVALID_AMOUNT' };
    }

    // Deducción atómica desde SQLite
    const deductRes = await db.deductUserXpAtomic(participant, num);
    if (!deductRes.success) {
        if (deductRes.reason === 'INSUFFICIENT_FUNDS') {
            await sendText(
                from,
                `> ❌ No traes suficiente XP, compa.\n` +
                `Tienes *${deductRes.balance.toLocaleString('es-MX')} XP* y querías meter *${num.toLocaleString('es-MX')} XP*.`
            );
        } else {
            await sendText(from, '> ❌ Cantidad de XP no válida para aportar.');
        }
        return { success: false, reason: deductRes.reason };
    }

    // Actualizar estado de la sesión
    session.currentXp += num;

    const prev = session.contributors.get(participant) || { total: 0, name: userName, jid: participant };
    session.contributors.set(participant, {
        total: prev.total + num,
        name: userName,
        jid: participant
    });

    session.recentDonors.unshift({
        name: userName,
        amount: num,
        timestamp: Date.now()
    });
    if (session.recentDonors.length > 5) {
        session.recentDonors.pop();
    }

    // Verificar si se alcanzó o superó la meta
    if (session.currentXp >= session.targetXp) {
        await completeCooperacha(from);
        return { success: true, completed: true, currentXp: session.currentXp, targetXp: session.targetXp };
    }

    // Informar progreso acumulado de forma concisa sin saturar
    const remainingTime = formatTimeRemaining(session.expiresAt - Date.now());
    const remainingXp = session.targetXp - session.currentXp;
    const percent = Math.round((session.currentXp / session.targetXp) * 100);
    const bar = generateProgressBar(session.currentXp, session.targetXp);

    const recentDonorsText = session.recentDonors
        .slice(0, 3)
        .map(d => `${d.name} (+${d.amount.toLocaleString('es-MX')})`)
        .join(', ');

    const progressMsg =
        `🪙 *¡Aporte recibido!* +${num.toLocaleString('es-MX')} XP de *${userName}*\n\n` +
        `📊 Progreso: ${bar} *${session.currentXp.toLocaleString('es-MX')} / ${session.targetXp.toLocaleString('es-MX')} XP* (${percent}%)\n` +
        `⏳ Tiempo restante: *${remainingTime}* | Faltan: *${remainingXp.toLocaleString('es-MX')} XP*\n` +
        `👥 Últimos aportes: ${recentDonorsText}`;

    await sendText(from, progressMsg);

    return {
        success: true,
        completed: false,
        currentXp: session.currentXp,
        targetXp: session.targetXp,
        remainingXp
    };
}

/**
 * Informa el estado actual de la cooperacha activa en el grupo.
 *
 * @param {string} from - JID del grupo
 */
async function showCooperachaStatus(from) {
    const session = activeSessions.get(from);
    if (!session || session.status !== 'active') {
        return await sendText(from, '> No hay ninguna cooperacha activa en este grupo. Escribe `!coop` o `!reto` para arrancar una.');
    }

    const remainingTime = formatTimeRemaining(session.expiresAt - Date.now());
    const remainingXp = Math.max(0, session.targetXp - session.currentXp);
    const percent = Math.round((session.currentXp / session.targetXp) * 100);
    const bar = generateProgressBar(session.currentXp, session.targetXp);

    let donorsText = 'Sin aportaciones aún.';
    if (session.recentDonors.length > 0) {
        donorsText = session.recentDonors
            .slice(0, 4)
            .map(d => `• *${d.name}:* +${d.amount.toLocaleString('es-MX')} XP`)
            .join('\n');
    }

    const statusMsg =
        `📊 *ESTADO DE LA COOPERACHA* 🪙\n\n` +
        `${bar} *${percent}%*\n` +
        `💰 Acumulado: *${session.currentXp.toLocaleString('es-MX')} / ${session.targetXp.toLocaleString('es-MX')} XP*\n` +
        `⏳ Tiempo restante: *${remainingTime}*\n` +
        `🎯 Faltan para destapar: *${remainingXp.toLocaleString('es-MX')} XP*\n\n` +
        `👥 *Últimos donadores:*\n${donorsText}\n\n` +
        `¡Aporta escribiendo \`!coop <cantidad>\` o \`le meto <cantidad>\`!`;

    await sendText(from, statusMsg);
}

/**
 * Manejador principal para el comando de cooperacha y sus aliases.
 *
 * @param {object} parsed - Objeto analizado por el parser
 * @param {string} from - JID del chat o grupo
 * @param {object} messageData - Metadatos del mensaje
 */
async function handleCooperacha(parsed = {}, from, messageData = {}) {
    if (!isGroupAuthorized(from, parsed.options || {})) {
        if (!from || !from.endsWith('@g.us')) {
            return await sendText(from, '> 🪙 La Cooperacha de XP solo se puede jugar en grupos de WhatsApp.');
        }
        return await sendText(from, '> ❌ Este grupo no está autorizado para jugar a la cooperacha de XP.');
    }

    const participant = messageData?.key?.participant || messageData?.participant || from;
    const userName = messageData?.pushName || 'Compa';
    const rawArgs = parsed.args || [];
    const flags = parsed.flags || {};

    const firstArg = (rawArgs[0] || '').toLowerCase();
    const actionFlag = (flags.accion || flags.action || '').toLowerCase();

    // ─── ACCIÓN: CANCELAR ───
    if (firstArg === 'cancelar' || firstArg === 'cancel' || actionFlag === 'cancelar') {
        const { isAuthorizedAdmin } = require('../core/auth');
        if (!isAuthorizedAdmin(from, messageData)) {
            return await sendText(from, '> ❌ Solo los administradores pueden cancelar la cooperacha activa.');
        }
        return await cancelCooperacha(from);
    }

    // ─── ACCIÓN: ESTADO ───
    if (firstArg === 'estado' || firstArg === 'status' || actionFlag === 'estado') {
        return await showCooperachaStatus(from);
    }

    const session = activeSessions.get(from);

    // Si YA hay una sesión activa:
    if (session && session.status === 'active') {
        // Si se envió un número como argumento o flag -> es una aportación
        const potentialAmount = Number(rawArgs[0] || flags.cantidad || flags.monto || flags.xp);
        if (!isNaN(potentialAmount) && potentialAmount > 0) {
            return await contributeToCooperacha(from, participant, userName, potentialAmount);
        }

        // Si no se pasó cantidad, mostrar el estado actual
        return await showCooperachaStatus(from);
    }

    // Si NO hay sesión activa -> crear una nueva sesión de reto
    let targetXp = DEFAULT_TARGET_XP;
    const nonNumberArgs = [];

    for (const arg of rawArgs) {
        const num = Number(arg);
        if (!isNaN(num) && num > 0) {
            targetXp = num;
        } else if (typeof arg === 'string' && arg.trim().length > 0) {
            nonNumberArgs.push(arg.trim());
        }
    }

    if (flags.meta || flags.target || flags.xp) {
        const flagNum = Number(flags.meta || flags.target || flags.xp);
        if (!isNaN(flagNum) && flagNum > 0) targetXp = flagNum;
    }

    let rawCategory = null;
    const flagCat = flags.categoria || flags.category || flags.tema;
    if (flagCat) {
        rawCategory = String(flagCat);
    } else if (nonNumberArgs.length > 0) {
        rawCategory = nonNumberArgs.join(' ');
    } else if (parsed.options?.category) {
        rawCategory = String(parsed.options.category);
    }

    const { cleanCategory } = require('../services/packImages');
    const category = cleanCategory(rawCategory);

    return await startCooperacha(from, messageData, { targetXp, category, ...parsed.options });
}

const AUTONOMOUS_COOLDOWN_MS = 48 * 60 * 60 * 1000; // 48 horas exactas

/**
 * Consulta en SQLite cuándo se lanzó el último reto autónomo.
 * Las activaciones manuales iniciadas por usuarios NO afectan este registro.
 */
async function getLastAutonomousCooperachaTime(groupJid) {
    return new Promise((resolve) => {
        const rawDb = db.db || db;
        rawDb.get(
            `SELECT created_at FROM bot_social_events 
             WHERE chat_id = ? AND event_type = 'autonomous_cooperacha' 
             ORDER BY created_at DESC LIMIT 1`,
            [groupJid],
            (err, row) => {
                if (err || !row) return resolve(0);
                resolve(Number(row.created_at) || 0);
            }
        );
    });
}

/**
 * Evalúa si corresponde lanzar un reto de cooperacha espontáneo cada 48 horas.
 * Si un usuario la activa por su cuenta, no afecta el reloj autónomo.
 *
 * @param {string} [groupJid] - JID opcional del grupo. Si no se especifica, usa el grupo principal autorizado.
 * @returns {Promise<{ triggered: boolean, reason?: string, groupJid?: string, targetXp?: number }>}
 */
async function maybeTriggerAutonomousCooperacha(groupJid = null, options = {}) {
    const rawGroups = (process.env.ALLOWED_GROUPS_NORMAL || process.env.ALLOWED_GROUPS_ADMIN || '').split(',').map(g => g.trim()).filter(Boolean);
    const targetGroup = groupJid || (rawGroups.length > 0 ? (rawGroups[0].includes('@') ? rawGroups[0] : `${rawGroups[0]}@g.us`) : null);

    if (!targetGroup || !isGroupAuthorized(targetGroup)) {
        return { triggered: false, reason: 'unauthorized_or_no_group' };
    }

    // No interrumpir si ya hay una cooperacha activa en este momento
    if (activeSessions.has(targetGroup)) {
        return { triggered: false, reason: 'already_active' };
    }

    // 1. Verificar cooldown estricto de 48 horas desde la última autónoma
    const lastAutonomousTime = await getLastAutonomousCooperachaTime(targetGroup);
    const elapsed = Date.now() - lastAutonomousTime;
    if (elapsed < AUTONOMOUS_COOLDOWN_MS) {
        const remainingHours = ((AUTONOMOUS_COOLDOWN_MS - elapsed) / (60 * 60 * 1000)).toFixed(1);
        return { triggered: false, reason: `cooldown_active_${remainingHours}h_remaining` };
    }

    // 2. Horario activo (11:00 AM a 1:00 AM hora de México)
    if (!options.ignoreHours) {
        const now = new Date();
        const hourStr = now.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false }).split(':')[0];
        const currentHour = parseInt(hourStr, 10);
        if (currentHour >= 1 && currentHour < 11) {
            return { triggered: false, reason: 'outside_active_hours' };
        }
    }

    // Metas aleatorias variadas (200, 250, 300, 350 o 400 XP)
    const metas = [200, 250, 300, 350, 400];
    const targetXp = metas[Math.floor(Math.random() * metas.length)];

    const phrases = [
        "Andan muy jetones por acá, cabrones... Les traje un reto pa' que se les quite el sueño. A ver si se arman la cooperacha o son puro tacaño 🪙🔥",
        "Mucho silencio en el grupo. Ahí les va una foto especial, a ver si juntan el XP o les da frío 🪙👀",
        "Reto espontáneo de Botsky: cooperen o quédense con las ganas, tienen 10 minutos 🪙⚡"
    ];
    const customOpener = phrases[Math.floor(Math.random() * phrases.length)];

    logger.info(`[COOPERACHA-AUTO] Lanzando reto autónomo de 48h en ${targetGroup} con meta de ${targetXp} XP`);

    const session = await startCooperacha(targetGroup, {}, {
        targetXp,
        authorized: true,
        customOpener
    });

    if (session) {
        // Registrar en bot_social_events con tipo 'autonomous_cooperacha' para persistir el timestamp de 48h
        await db.addSocialEvent(targetGroup, 'autonomous_cooperacha', `Reto autónomo de cooperacha lanzado con meta de ${targetXp} XP.`);
        return { triggered: true, groupJid: targetGroup, targetXp };
    }

    return { triggered: false, reason: 'start_failed' };
}

module.exports = {
    handleCooperacha,
    startCooperacha,
    contributeToCooperacha,
    showCooperachaStatus,
    expireCooperacha,
    completeCooperacha,
    cancelCooperacha,
    hasActiveCooperacha,
    getCooperachaSession,
    isGroupAuthorized,
    activeSessions,
    DEFAULT_TARGET_XP,
    DEFAULT_DURATION_MS,
    AUTONOMOUS_COOLDOWN_MS,
    getLastAutonomousCooperachaTime,
    maybeTriggerAutonomousCooperacha
};
