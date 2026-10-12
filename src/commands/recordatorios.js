'use strict';

process.env.TZ = process.env.TZ || 'America/Mexico_City';

const evolution = require('../services/evolution');
const sendText = (to, text, opts) => evolution.sendText(to, text, opts);
const db = require('../services/db');
const logger = require('../services/logger');
const { registerIntervalSeconds } = require('../services/scheduler');

const { parseReminderTime, formatTimeDiff, prepareReminder } = require('../utils/reminderInput');

/**
 * Formatea una fecha y hora exacta en la zona horaria de México.
 */
function formatLocalDate(timestamp) {
    try {
        return new Date(timestamp).toLocaleString('es-MX', {
            timeZone: process.env.TZ || 'America/Mexico_City',
            hour12: true,
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return new Date(timestamp).toLocaleTimeString();
    }
}

/**
 * Manejador principal del comando de recordatorios.
 */
async function handleRecordar(parsed = {}, from, messageData = {}) {
    if (!from) return;
    const isGroup = typeof from === 'string' && from.endsWith('@g.us');
    const participant = messageData?.key?.participant || messageData?.participant || from;
    const senderName = messageData?.pushName || 'Compa';
    const safeParsed = (parsed && typeof parsed === 'object') ? parsed : {};
    const params = safeParsed.aiArgs || safeParsed;
    const rawArgs = Array.isArray(safeParsed.args) ? safeParsed.args : [];
    const flags = safeParsed.flags || {};

    const action = String(params.accion || params.action || flags.accion || flags.action || rawArgs[0] || '').toLowerCase().trim();

    // ─── 1. SUBCOMANDO: LISTAR RECORDATORIOS ───
    if (action === 'lista' || action === 'listar' || action === 'pendientes' || action === 'ver') {
        try {
            const pending = await db.getUserPendingReminders(from, isGroup ? participant : null);
            if (!pending || pending.length === 0) {
                return await sendText(from, 'No tienes recordatorios pendientes aquí.\nPara crear uno: `recordar en 20m sacar la ropa`.');
            }

            let msg = `⏰ *Tus recordatorios* (${pending.length})

`;
            for (const r of pending) {
                const dateStr = formatLocalDate(r.due_at);
                const remaining = formatTimeDiff(r.due_at - Date.now());
                msg += `• *#${r.id}* | "${r.reminder_text}"
  📅 ${dateStr} _(en ${remaining})_

`;
            }
            msg += 'Para cancelar uno: `recordar cancelar [id]`.';
            return await sendText(from, msg);
        } catch (err) {
            logger.error('[RECORDATORIOS] Error al listar:', err);
            return await sendText(from, 'No pude consultar tus recordatorios. Intenta de nuevo en un momento.');
        }
    }

    // ─── 2. SUBCOMANDO: CANCELAR RECORDATORIO ───
    if (action === 'cancelar' || action === 'borrar' || action === 'eliminar') {
        const idToCancel = parseInt(params.id || flags.id || rawArgs[1], 10);
        if (isNaN(idToCancel)) {
            return await sendText(from, 'Dime cuál cancelamos: `recordar cancelar 3`.\nConsulta los números con `recordar lista`.');
        }

        try {
            const ok = await db.cancelReminder(idToCancel, participant, false);
            if (ok) {
                return await sendText(from, `Listo, cancelé el recordatorio *#${idToCancel}*.`);
            } else {
                return await sendText(from, `No encontré el recordatorio *#${idToCancel}* entre tus pendientes. Revisa \`recordar lista\`.`);
            }
        } catch (err) {
            logger.error('[RECORDATORIOS] Error al cancelar:', err);
            return await sendText(from, 'No pude cancelar el recordatorio. Intenta de nuevo en un momento.');
        }
    }

    // Comando y herramienta de Gemini comparten cita y validación; nunca inventan un plazo.
    let timeInput = params.tiempo || flags.tiempo || flags.t || flags.time || null;
    const minutesHint = params.minutos !== undefined ? params.minutos : (flags.minutos ?? flags.mins ?? flags.m ?? null);
    let reminderText = params.mensaje || params.texto || flags.mensaje || flags.texto || flags.msg || '';

    if (!safeParsed.semanticDecision && !timeInput && minutesHint == null && rawArgs.length) {
        timeInput = rawArgs[0]; reminderText ||= rawArgs.slice(1).join(' ');
    }
    const creation = prepareReminder({ mensaje: reminderText, tiempo: timeInput, minutos: minutesHint }, messageData, Date.now(), { canonicalOnly: !!safeParsed.semanticDecision });
    if (!creation.success) return await sendText(from, creation.question);
    reminderText = creation.mensaje;
    const timeParsed = creation;

    try {
        const newRem = await db.addReminder(from, participant, senderName, reminderText, timeParsed.dueAt);
        const dateStr = formatLocalDate(timeParsed.dueAt);

        const reply = `⏰ *Va, te lo recuerdo.*

` +
            `> "${reminderText}"

` +
            `Te aviso: *${dateStr}* (en ~${timeParsed.timeDesc}).
` +
            `Para cancelarlo: \`recordar cancelar ${newRem.id}\`.`;

        return await sendText(from, reply);
    } catch (err) {
        logger.error('[RECORDATORIOS] Error guardando en db:', err);
        return await sendText(from, 'No pude guardar el recordatorio. Intenta de nuevo en un momento.');
    }
}

/**
 * Worker en segundo plano que revisa recordatorios vencidos cada 10 segundos y los envía.
 */
let workerStarted = false;
const processingReminderIds = new Set();
const reminderAttempts = new Map(); // id -> count

function initReminderWorker() {
    if (workerStarted) return;
    workerStarted = true;

    // Registrar en scheduler para ejecutarse cada 10 segundos
    registerIntervalSeconds('reminders-worker', 10, async () => {
        try {
            const now = Date.now();
            const dueList = await db.getDueReminders(now);
            if (!dueList || dueList.length === 0) return;

            for (const r of dueList) {
                if (processingReminderIds.has(r.id)) continue;
                processingReminderIds.add(r.id);

                try {
                    const isGroup = typeof r.target_jid === 'string' && r.target_jid.endsWith('@g.us');
                    const userTag = r.sender_jid ? `@${r.sender_jid.split('@')[0]}` : `@${r.sender_name || 'Compa'}`;

                    let alertMsg = '';
                    if (isGroup) {
                        alertMsg = `⏰ *¡RECORDATORIO!* ${userTag}\n\n` +
                                   `> "${r.reminder_text}"\n\n` +
                                   `_Me pediste que te recordara esto._`;
                    } else {
                        alertMsg = `⏰ *¡RECORDATORIO!*\n\n` +
                                   `> "${r.reminder_text}"\n\n` +
                                   `_Aquí está el recordatorio que me pediste._`;
                    }

                    logger.info(`[RECORDATORIOS] Despachando recordatorio #${r.id} a ${r.target_jid}`);
                    const sendOpts = (isGroup && r.sender_jid) ? { mentions: [r.sender_jid] } : {};
                    await sendText(r.target_jid, alertMsg, sendOpts);
                    await db.markReminderDelivered(r.id);
                    reminderAttempts.delete(r.id);
                } catch (err) {
                    logger.error(`[RECORDATORIOS] Error enviando recordatorio #${r.id} a ${r.target_jid}:`, err.message);
                    const fails = (reminderAttempts.get(r.id) || 0) + 1;
                    reminderAttempts.set(r.id, fails);
                    const isPermanent = err.message?.includes('400') || err.message?.includes('not found') || String(r.target_jid || '').startsWith('test_');
                    if (fails >= 2 || isPermanent) {
                        logger.warn(`[RECORDATORIOS] Marcando recordatorio #${r.id} como fallido tras ${fails} intento(s): ${err.message}`);
                        await db.markReminderFailed(r.id);
                        reminderAttempts.delete(r.id);
                    }
                } finally {
                    processingReminderIds.delete(r.id);
                }
            }
        } catch (err) {
            logger.error('[RECORDATORIOS-WORKER] Error en ciclo de verificación:', err);
        }
    });

    logger.info('[RECORDATORIOS] Worker de recordatorios registrado con éxito (ciclo de 10s).');
}

// Iniciar automáticamente el worker
initReminderWorker();

module.exports = {
    handleRecordar,
    parseReminderTime,
    formatTimeDiff,
    formatLocalDate,
    initReminderWorker
};
