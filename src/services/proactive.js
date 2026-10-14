'use strict';

const logger = require('./logger');
const evolution = require('./evolution');
const { getHistory, addMessage } = require('./history');
const { registerTask } = require('./scheduler');
const { evaluateProactiveAction } = require('./ai');
const {
    db,
    canSendProactiveMessage,
    recordProactiveMessage,
    getPersonalityState,
    updatePersonalityState,
    addSocialEvent,
    getRecentSocialEvents
} = require('./db');

const AUTONOMY_OBJECTIVES = [
    'encontrar una oportunidad natural para reanimar el grupo',
    'detectar una pregunta que se haya quedado sin respuesta',
    'proponer una actividad breve si el grupo está aburrido',
    'observar el ambiente y no interrumpir sin motivo'
];

function chooseAutonomyState({ idleMinutes, historyLength, currentHour }) {
    let mood = 'curioso';
    if (currentHour >= 1 && currentHour < 8) mood = 'dormido';
    else if (idleMinutes >= 75) mood = 'con hueva';
    else if (historyLength >= 6) mood = 'atento';
    else if (currentHour >= 22) mood = 'cansado';

    let objective = AUTONOMY_OBJECTIVES[3];
    if (idleMinutes >= 75) objective = AUTONOMY_OBJECTIVES[0];
    else if (historyLength >= 6) objective = AUTONOMY_OBJECTIVES[1];
    else if (currentHour >= 10 && currentHour <= 22) objective = AUTONOMY_OBJECTIVES[2];
    return { mood, objective };
}

/**
 * Obtiene los miembros con rencor activo o sentencias de doxeo pendientes.
 */
function getActiveGrudges() {
    return new Promise((resolve) => {
        db.all(
            `SELECT jid, user_name, score, mood, grievances, last_reason, is_doxxed 
             FROM user_affinities 
             WHERE score <= -40 OR is_doxxed = 1 
             ORDER BY score ASC LIMIT 5`,
            (err, rows) => {
                if (err) {
                    logger.warn(`[PROACTIVE] Error consultando rencores: ${err.message}`);
                    return resolve([]);
                }
                resolve(rows || []);
            }
        );
    });
}

function normalizeProactiveJid(jid) {
    if (typeof jid !== 'string') return '';
    const trimmed = jid.trim().toLowerCase();
    const match = trimmed.match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/);
    return match ? `${match[1]}@s.whatsapp.net` : '';
}

function isAllowedPrivateTarget(targetJid, activeGrudges) {
    const target = normalizeProactiveJid(targetJid);
    if (!target || !Array.isArray(activeGrudges)) return false;
    return activeGrudges.some(grudge => normalizeProactiveJid(grudge?.jid) === target);
}

/**
 * Obtiene el JID del grupo principal de operaciones.
 */
function getMainGroupJid() {
    const raw = process.env.ALLOWED_GROUPS_NORMAL || process.env.ALLOWED_GROUPS_ADMIN || '120363315296139888@g.us';
    const first = raw.split(',')[0].trim();
    return first.includes('@') ? first : `${first}@g.us`;
}

// Rastreador en memoria de actividad por grupo para detección de ráfagas/momentum
// Map(groupJid -> Array<{ timestamp, senderJid, text }>)
const groupActivityMap = new Map();
// Timestamp de la última evaluación de ráfaga por grupo para evitar saturación de API
const lastBurstEvaluationTime = new Map();
const BURST_EVAL_COOLDOWN_MS = 25 * 60 * 1000; // Mínimo 25 min entre chequeos de ráfaga

/**
 * Registra un mensaje de chat grupal para análisis de momentum y ráfagas.
 */
function recordGroupActivity(groupJid, senderJid, text) {
    if (!groupJid || typeof groupJid !== 'string' || !groupJid.endsWith('@g.us')) return;
    const now = Date.now();
    const tenMinAgo = now - 10 * 60 * 1000;

    let activity = groupActivityMap.get(groupJid) || [];
    // Descartar mensajes más viejos de 10 min
    activity = activity.filter(item => item.timestamp > tenMinAgo);
    activity.push({ timestamp: now, senderJid, text: String(text || '').slice(0, 100) });
    groupActivityMap.set(groupJid, activity);

    if (groupActivityMap.size > 50) {
        for (const [jid, list] of groupActivityMap.entries()) {
            if (!list || list.length === 0 || list[list.length - 1].timestamp <= tenMinAgo) {
                groupActivityMap.delete(jid);
            }
        }
    }
}

/**
 * Evalúa si una ráfaga orgánica en el grupo amerita un tiro cómico o remate oportuno.
 * Se ejecuta de manera asíncrona (fire-and-forget) sin bloquear el flujo del dispatcher.
 */
async function maybeTriggerBurstIntervention(groupJid) {
    if (process.env.PROACTIVE_ENABLED !== 'true') return;
    if (!groupJid || typeof groupJid !== 'string' || !groupJid.endsWith('@g.us')) return;

    try {
        // 1. Horario Humano (8:30 AM a 11:30 PM Hora Ciudad de México)
        const now = new Date();
        const hourStr = now.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false }).split(':')[0];
        const currentHour = parseInt(hourStr, 10);
        if (currentHour >= 1 && currentHour < 8) return;

        // 2. Cooldown en memoria de evaluaciones de ráfaga
        const lastEval = lastBurstEvaluationTime.get(groupJid) || 0;
        if (Date.now() - lastEval < BURST_EVAL_COOLDOWN_MS) return;

        // 3. Verificar momentum de la conversación en los últimos 7 minutos
        const sevenMinAgo = Date.now() - 7 * 60 * 1000;
        const activity = (groupActivityMap.get(groupJid) || []).filter(item => item.timestamp > sevenMinAgo);

        // Requiere al menos 4 mensajes y de al menos 2 personas distintas
        if (activity.length < 4) return;
        const uniqueSenders = new Set(activity.map(a => a.senderJid));
        if (uniqueSenders.size < 2) return;

        // 4. Verificar presupuesto y cooldown diario en SQLite
        const canGroup = await canSendProactiveMessage('group');
        if (!canGroup) return;

        // Marcar evaluación iniciada para este grupo
        lastBurstEvaluationTime.set(groupJid, Date.now());

        // 5. Evaluar con la IA si existe un remate de nivel 10/10
        const history = getHistory(groupJid, 8);
        logger.info(`[PROACTIVE-BURST] Momentum detectado en ${groupJid} (${activity.length} msgs, ${uniqueSenders.size} personas). Evaluando remate...`);

        const decision = await evaluateProactiveAction({
            groupHistory: history,
            idleMinutes: 0,
            mode: 'burst'
        });

        if (!decision || !decision.should_act || !decision.message) {
            logger.info(`[PROACTIVE-BURST] IA decidió guardar silencio: "${decision?.reason || 'sin remate de valor'}"`);
            return;
        }

        // 6. Si hubo un remate oportuno, intervenir con realismo humano (simular lectura/tipeo)
        logger.info(`[PROACTIVE-BURST] Remate cómico aprobado en grupo: "${decision.message}" (motivo: ${decision.reason})`);
        
        // Simular presencia de tipeo antes de enviar
        evolution.sendTyping(groupJid).catch(() => {});
        await new Promise(res => setTimeout(res, 1800));
        if (process.env.PROACTIVE_ENABLED !== 'true') return;
        await evolution.sendText(groupJid, decision.message);
        addMessage(groupJid, 'assistant', decision.message, 'Botsky');
        await recordProactiveMessage(groupJid, 'group', decision.message);
    } catch (err) {
        logger.warn(`[PROACTIVE-BURST] Error en evaluación de ráfaga: ${err.message}`);
    }
}

/**
 * Ejecuta un ciclo del pensamiento consciente y espontáneo de Botsky (Heartbeat de fondo).
 */
async function runProactiveCycle() {
    if (process.env.PROACTIVE_ENABLED !== 'true') return { skipped: true, reason: 'kill_switch' };
    try {
        // 1. Horario Humano / Modo Nocturno (Hora Ciudad de México)
        const now = new Date();
        const hourStr = now.toLocaleTimeString('en-US', { timeZone: 'America/Mexico_City', hour12: false }).split(':')[0];
        const currentHour = parseInt(hourStr, 10);

        // De 1:00 AM a 8:00 AM Botsky descansa (cero mensajes espontáneos)
        if (currentHour >= 1 && currentHour < 8) {
            return { skipped: true, reason: 'night_mode' };
        }

        const groupJid = getMainGroupJid();
        if (!groupJid) return { skipped: true, reason: 'no_group' };

        // 1b. Evaluar reto autónomo de cooperacha de 48 horas (independiente de activaciones manuales)
        try {
            const { maybeTriggerAutonomousCooperacha } = require('../commands/cooperacha');
            const autoCoop = await maybeTriggerAutonomousCooperacha(groupJid);
            if (autoCoop && autoCoop.triggered) {
                await updatePersonalityState({ chatId: groupJid, lastReason: 'autonomous_cooperacha_48h' });
                return { executed: true, channel: 'group', type: 'autonomous_cooperacha', ...autoCoop };
            }
        } catch (autoErr) {
            logger.warn(`[PROACTIVE] Error evaluando cooperacha autónoma: ${autoErr.message}`);
        }

        // 2. Verificar presupuesto de spam en el grupo
        const canGroup = await canSendProactiveMessage('group');
        if (!canGroup) {
            return { skipped: true, reason: 'group_budget_or_cooldown' };
        }

        // 3. Revisar historial reciente y tiempo de silencio
        const history = getHistory(groupJid, 10);
        let idleMinutes = 0;
        if (history.length > 0) {
            const lastMsg = history[history.length - 1];
            if (lastMsg.timestamp) {
                idleMinutes = Math.max(0, Math.floor((Date.now() - lastMsg.timestamp) / 60000));
            } else {
                idleMinutes = 0;
            }
        }

        const personalityState = await getPersonalityState(groupJid);
        const recentEvents = await getRecentSocialEvents(groupJid, 8);
        const selectedState = chooseAutonomyState({
            idleMinutes,
            historyLength: history.length,
            currentHour
        });
        const objectiveExpired = !personalityState || Number(personalityState.objective_until || 0) <= Date.now();
        if (objectiveExpired || personalityState.mood !== selectedState.mood) {
            await updatePersonalityState({
                chatId: groupJid,
                mood: selectedState.mood,
                objective: objectiveExpired ? selectedState.objective : personalityState.objective,
                objectiveUntil: objectiveExpired ? Date.now() + 6 * 60 * 60 * 1000 : personalityState.objective_until
            });
        }


        // 4. Obtener rencores activos
        const activeGrudges = await getActiveGrudges();

        // Determinar modo contextual:
        // - Si hay rencores pendientes: modo 'grudge'
        // - Si el grupo lleva entre 75 y 240 minutos muerto en pleno día: modo 'idle' para revivirlo
        // - En cualquier otro caso: no forzar intervención
        let cycleMode = 'idle';
        if (history.at(-1)?.role === 'user' && (!history.at(-1).timestamp || Date.now() - history.at(-1).timestamp <= 90 * 60 * 1000)) {
            cycleMode = 'contextual';
        } else if (activeGrudges.length > 0) {
            cycleMode = 'grudge';
        } else if (idleMinutes >= 75 && idleMinutes <= 240 && currentHour >= 10 && currentHour <= 22) {
            cycleMode = 'idle';
        } else {
            return { skipped: true, reason: 'outside_idle_window_or_too_early' };
        }

        // 5. Consultar a Gemini / Groq si desea intervenir
        logger.info(`[PROACTIVE] Evaluando pensamiento espontáneo (modo: ${cycleMode}, silencio: ${idleMinutes}m, rencores: ${activeGrudges.length})...`);
        const decision = await evaluateProactiveAction({
            groupHistory: history,
            activeGrudges,
            idleMinutes,
            mode: cycleMode,
            personalityState: {
                ...personalityState,
                mood: selectedState.mood,
                objective: objectiveExpired ? selectedState.objective : personalityState.objective
            },
            recentEvents
        });

        if (!decision || !decision.should_act || !decision.message) {
            logger.info(`[PROACTIVE] Botsky decidió quedarse en silencio: "${decision?.reason || 'sin motivo'}"`);
            return { skipped: true, reason: 'ai_decided_silence' };
        }

        if (cycleMode === 'contextual' && decision.channel !== 'group') {
            logger.warn('[PROACTIVE] La respuesta autónoma a una pregunta debe permanecer en el grupo.');
            return { skipped: true, reason: 'question_group_only' };
        }

        // 6. Ejecutar acción según el canal decidido por Botsky
        if (decision.channel === 'private' && decision.target_jid) {
            const targetJid = normalizeProactiveJid(decision.target_jid);
            if (!isAllowedPrivateTarget(targetJid, activeGrudges)) {
                logger.warn('[PROACTIVE] Destinatario privado rechazado: no pertenece a los rencores activos.');
                return { skipped: true, reason: 'private_target_not_allowed' };
            }
            const canPrivate = await canSendProactiveMessage('private', targetJid);
            if (!canPrivate) {
                logger.info(`[PROACTIVE] Presupuesto privado diario alcanzado para ${decision.target_jid}`);
                return { skipped: true, reason: 'private_budget_reached' };
            }

            logger.info(`[PROACTIVE] Botsky envía tiro espontáneo en privado a ${targetJid}: "${decision.message}"`);
            if (process.env.PROACTIVE_ENABLED !== 'true') return { skipped: true, reason: 'kill_switch' };
            await evolution.sendText(targetJid, decision.message);
            await recordProactiveMessage(targetJid, 'private', decision.message);
            await addSocialEvent(groupJid, 'private_intervention', `Mensaje privado autorizado para ${targetJid}.`);
            await updatePersonalityState({ chatId: groupJid, lastReason: decision.reason || 'private_intervention' });
            return { executed: true, channel: 'private', target: targetJid, message: decision.message };
        } else {
            // Canal grupo
            logger.info(`[PROACTIVE] Botsky interviene espontáneamente en el grupo: "${decision.message}"`);
            evolution.sendTyping(groupJid).catch(() => {});
            await new Promise(res => setTimeout(res, 1500));
            if (process.env.PROACTIVE_ENABLED !== 'true') return { skipped: true, reason: 'kill_switch' };
            await evolution.sendText(groupJid, decision.message);
            addMessage(groupJid, 'assistant', decision.message, 'Botsky');
            await recordProactiveMessage(groupJid, 'group', decision.message);
            await addSocialEvent(groupJid, 'group_intervention', decision.message);
            await updatePersonalityState({ chatId: groupJid, lastReason: decision.reason || 'group_intervention' });
            return { executed: true, channel: 'group', target: groupJid, message: decision.message };
        }
    } catch (err) {
        logger.error(`[PROACTIVE] Error en ciclo de pensamiento proactivo: ${err.message}`);
        return { error: err.message };
    }
}

/**
 * Inicializa el worker de consciencia proactiva en el scheduler maestro.
 */
function initProactiveHeartbeat() {
    if (process.env.PROACTIVE_ENABLED !== 'true') {
        logger.info('[PROACTIVE] Disabled by global kill switch.');
        return;
    }
    // Tarea registrada cada 25 minutos
    registerTask('proactive-heartbeat', 25, async () => {
        await runProactiveCycle();
    });
    logger.info('[PROACTIVE] Ciclo de consciencia y pensamiento espontáneo registrado (intervalo: 25m).');
}

module.exports = {
    initProactiveHeartbeat,
    runProactiveCycle,
    recordGroupActivity,
    maybeTriggerBurstIntervention,
    getActiveGrudges,
    getMainGroupJid,
    chooseAutonomyState,
    normalizeProactiveJid,
    isAllowedPrivateTarget
};
