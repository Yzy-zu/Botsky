'use strict';

process.env.TZ = process.env.TZ || 'America/Mexico_City';

const fs = require('fs');
const path = require('path');
const evolution = require('./evolution');
const sendText = (to, text, opts) => evolution.sendText(to, text, opts);
const sendMedia = (...args) => evolution.sendMedia(...args);
const downloadMedia = (...args) => evolution.downloadMedia(...args);
const db = require('./db');
const logger = require('./logger');
const { registerIntervalSeconds } = require('./scheduler');
const { getSenderJid, isAuthorizedAdmin, isAuthorizedTaskUploader } = require('../core/auth');
const {
    UTM_SCHEDULE_TI7B,
    SUBJECT_ALIASES,
    CANONICAL_SUBJECTS,
    normalizeSubject,
    getDaysForSubject,
    calculateNextClassDueDate
} = require('./school_schedule_data');

let aiModule = null;
try {
    aiModule = require('./ai');
} catch (_) {}

const WEEKDAYS = {
    domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3,
    jueves: 4, viernes: 5, sabado: 6, sábado: 6
};

const MONTH_NAMES = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
    noviembre: 10, diciembre: 11
};

function isPrivateChat(from) {
    return typeof from === 'string' && from.endsWith('@s.whatsapp.net');
}

function parseClock(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):([0-5]\d)$/);
    if (!match) return null;
    const hour = Number(match[1]);
    if (hour > 23) return null;
    return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function localParts(timestamp = Date.now(), timezone = process.env.TZ || 'America/Mexico_City') {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return {
        date: `${values.year}-${values.month}-${values.day}`,
        time: `${values.hour === '24' ? '00' : values.hour}:${values.minute}`
    };
}

/** Gemini normalizes dates. This function validates ISO/calendar data only. */
function parseDueDate(input) {
    const value = String(input || '').trim();
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/i);
    if (!iso) return null;
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = iso;
    const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function formatDueDate(timestamp, timezone = process.env.TZ || 'America/Mexico_City') {
    return new Intl.DateTimeFormat('es-MX', { timeZone: timezone, dateStyle: 'medium' }).format(new Date(timestamp));
}

function normalizeTaskPieces(rawArgs) {
    return String(rawArgs || '').split('|').map(value => value.trim()).filter(Boolean);
}

function formatTask(task, timezone) {
    const subject = task.subject ? `\nMateria: ${task.subject}` : '';
    const details = task.details ? `\n${task.details}` : '';
    const due = task.due_text ? `\nEntrega: ${task.due_text}` : (task.due_at ? `\nEntrega: ${formatDueDate(task.due_at, timezone)}` : '');
    return `📚 *TAREA DEL DÍA*${subject}\n\n*${task.title}*${details}${due}`;
}

// ─── Extractor Inteligente de Tareas (Gemini con soporte de fecha explícita) ───

async function extractSchoolTaskDetails(rawText) {
    const cleanText = String(rawText || '').replace(/^\/!\s*/, '').trim();

    // Intentar extracción con Gemini estructurado
    const geminiFn = aiModule?.callGemini;
    if (typeof geminiFn === 'function') {
        try {
            const systemInstruction = `Eres el extractor de tareas escolares para Botsky. Hora local actual: ${new Date().toLocaleString('es-MX', { timeZone: process.env.TZ || 'America/Mexico_City' })}. Zona: ${process.env.TZ || 'America/Mexico_City'}.
El estudiante describe en lenguaje natural una tarea asignada en clase, con abreviaturas o errores de escritura. No exige palabras clave, prefijos ni separadores. No confundas pedir ayuda para resolver una tarea con pedir guardarla.
Tu objetivo es identificar:
1. "subject": Nombre de la materia escolar (Formulación de Proyectos de Tecnología, Fundamentos de Inteligencia Artificial, Seguridad Informática, Ética y Legislación en Tecnologías de la Información, Optativa I, Habilidades Gerenciales, Inglés VI).
2. "task": Descripción concreta de la tarea o proyecto asignado.
3. "explicit_due": Si el estudiante mencionó explícitamente cuándo se entrega (ej: "24 de octubre", "jueves de la siguiente semana", "en un mes", "para el 15 de noviembre", "mañana", "el viernes"), normalízalo a fecha ISO con zona horaria. Si NO especificó fecha de entrega, devuelve null.
4. "details": Detalles adicionales si los hay, o null.

Devuelve un JSON estrictamente estructurado:
{
  "subject": "Nombre de la materia identificada o null si no la menciona",
  "task": "Descripción concreta de la tarea",
  "explicit_due": "fecha ISO con zona horaria o null",
  "details": null
}`;
            const aiResp = await geminiFn({
                systemInstruction,
                userMessage: cleanText,
                temperature: 0.1,
                maxOutputTokens: 250,
                responseMimeType: 'application/json',
                timeout: 8000
            });

            if (aiResp && typeof aiResp === 'string') {
                const parsed = JSON.parse(aiResp.replace(/```json/gi, '').replace(/```/g, '').trim());
                if (parsed.task || parsed.subject) {
                    return {
                        subject: normalizeSubject(parsed.subject || ''),
                        task: parsed.task || cleanText,
                        explicit_due: parsed.explicit_due || null,
                        details: parsed.details || null
                    };
                }
            }
        } catch (err) {
            logger.warn(`[SCHOOL] Extracción con Gemini no disponible, sin adivinar campos: ${err.message}`);
        }
    }

    return { subject: null, task: null, explicit_due: null, details: null };
}

/**
 * Registra una tarea en privado desde texto natural o campos interpretados por IA.
 */
async function handleDirectTaskMessage({ text, from, messageData, norm, taskDetails = null, sendConfirmation = true }) {
    if (!isPrivateChat(from)) {
        return sendConfirmation ? false : { success: false, error: "Pásame la tarea por privado y la guardo ahí." };
    }

    if (!isAuthorizedTaskUploader(from, messageData)) {
        const error = 'Solo las personas autorizadas pueden registrar tareas escolares.';
        if (!sendConfirmation) return { success: false, error };
        await sendText(from, error);
        return true;
    }

    const ownerJid = getSenderJid(from, messageData) || from;

    // 1. Descargar imagen adjunta si existe (soporta imagen directa o citada/quoted)
    let savedMediaPath = null;
    const mediaSourceData = norm?.actualMessageData || messageData;
    const isImage = norm?.actualMessageType === 'image' ||
        norm?.actualMessageType === 'imageMessage' ||
        norm?.messageType === 'imageMessage' ||
        mediaSourceData?.message?.imageMessage ||
        (norm?.actualMessageType === 'document' && (norm?.messageType?.includes('image') || mediaSourceData?.message?.documentMessage?.mimetype?.startsWith('image/')));

    if (isImage) {
        try {
            const downloaded = await downloadMedia(mediaSourceData);
            if (downloaded && downloaded.buffer) {
                const mediaDir = path.join(process.cwd(), 'data', 'school_media');
                if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
                const ext = (downloaded.extension || 'jpg').replace(/^\./, '');
                const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                savedMediaPath = path.join(mediaDir, `task_${uniqueSuffix}.${ext}`);
                await fs.promises.writeFile(savedMediaPath, downloaded.buffer);
                logger.info(`[SCHOOL] Foto de material de tarea guardada: ${savedMediaPath}`);
            }
        } catch (mediaErr) {
            logger.warn(`[SCHOOL] No se pudo guardar foto adjunta de la tarea: ${mediaErr.message}`);
        }
    }

    // 2. Extraer detalles estructurados de la tarea
    const supplied = taskDetails && typeof taskDetails === 'object' ? taskDetails : {};
    const stringValue = value => typeof value === 'string' && value.trim() ? value.trim() : null;
    const suppliedTitle = stringValue(supplied.titulo || supplied.title || supplied.task);
    const extracted = suppliedTitle
        ? { subject: 'General', task: suppliedTitle, explicit_due: null, details: null }
        : await extractSchoolTaskDetails(text);
    extracted.subject = normalizeSubject(stringValue(supplied.materia || supplied.subject) || stringValue(extracted.subject) || 'General');
    extracted.task = suppliedTitle || stringValue(extracted.task);
    extracted.explicit_due = stringValue(supplied.fecha || supplied.entrega || supplied.due) || stringValue(extracted.explicit_due);
    extracted.details = stringValue(supplied.detalles || supplied.details) || stringValue(extracted.details);
    if (!extracted.task) {
        const error = '¿Qué hay que hacer? Cuéntame la tarea como te la dejaron, compa.';
        if (!sendConfirmation) return { success: false, error };
        await sendText(from, error);
        return true;
    }

    // 3. Calcular fecha de entrega: si especificó fecha explícita usarla, de lo contrario deducir según siguiente clase
    const timezone = process.env.TZ || 'America/Mexico_City';
    let dueCalc = null;

    if (extracted.explicit_due) {
        const explicitTs = parseDueDate(extracted.explicit_due, new Date());
        if (!explicitTs) {
            const error = 'No pude interpretar la fecha de entrega. Dime para cuándo es.';
            if (!sendConfirmation) return { success: false, needs_clarification: true, error };
            await sendText(from, error);
            return true;
        }
        if (explicitTs) {
            const optionsDate = { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' };
            const formattedDate = new Intl.DateTimeFormat('es-MX', optionsDate).format(new Date(explicitTs));
            const fullDeliveryText = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);
            dueCalc = {
                canonicalSubject: normalizeSubject(extracted.subject),
                dueTimestamp: explicitTs,
                fullDeliveryText,
                relativeLabel: extracted.explicit_due
            };
        }
    }

    if (!dueCalc && !extracted.explicit_due) {
        let schedule = await db.getSchoolSchedule(ownerJid);
        if (!schedule || schedule.length === 0) {
            const adminNumbers = (process.env.ALLOWED_NUMBERS_ADMIN || '').split(',').map(n => n.trim().replace(/[^0-9]/g, '')).filter(Boolean);
            for (const adm of adminNumbers) {
                const admSchedule = await db.getSchoolSchedule(`${adm}@s.whatsapp.net`);
                if (admSchedule && admSchedule.length > 0) {
                    schedule = admSchedule;
                    break;
                }
            }
        }
        const effectiveSchedule = schedule?.length ? schedule : UTM_SCHEDULE_TI7B;
        if (getDaysForSubject(extracted.subject, effectiveSchedule).length) {
            dueCalc = calculateNextClassDueDate(extracted.subject, new Date(), effectiveSchedule, timezone);
            dueCalc.fullDeliveryText += ' (próxima clase, según el horario)';
        }
    }

    if (!dueCalc) {
        dueCalc = {
            canonicalSubject: extracted.subject,
            dueTimestamp: null,
            fullDeliveryText: extracted.explicit_due
                ? `${extracted.explicit_due} (fecha por confirmar)`
                : 'Sin fecha de entrega'
        };
    }

    // 4. Obtener o inicializar configuración del grupo escolar
    let settings = await db.getSchoolSettings(ownerJid);
    if (!settings || !settings.target_group_jid || settings.target_group_jid === 'pending_group') {
        const adminNumbers = (process.env.ALLOWED_NUMBERS_ADMIN || '').split(',').map(n => n.trim().replace(/[^0-9]/g, '')).filter(Boolean);
        let fallbackGroup = null;
        for (const adm of adminNumbers) {
            const admSettings = await db.getSchoolSettings(`${adm}@s.whatsapp.net`);
            if (admSettings?.target_group_jid && admSettings.target_group_jid !== 'pending_group') {
                fallbackGroup = admSettings.target_group_jid;
                break;
            }
        }
        if (!fallbackGroup) {
            fallbackGroup = process.env.ALLOWED_GROUPS_ADMIN?.split(',')?.[0] || null;
        }

        settings = await db.saveSchoolSettings({
            ownerJid,
            targetGroupJid: fallbackGroup,
            firstPublishTime: '15:00',
            secondPublishTime: '18:00',
            timezone
        });
    }

    const { date: batchDate } = localParts(Date.now(), timezone);

    // 5. Guardar en SQLite
    const task = await db.createSchoolTask({
        ownerJid,
        targetGroupJid: settings?.target_group_jid || 'pending_group',
        subject: dueCalc.canonicalSubject,
        title: extracted.task,
        details: extracted.details,
        dueAt: dueCalc.dueTimestamp,
        dueText: dueCalc.fullDeliveryText,
        mediaPath: savedMediaPath,
        batchDate
    });

    logger.info(`[SCHOOL] Tarea #${task.id} registrada en lote de hoy (${batchDate}): "${dueCalc.canonicalSubject} - ${extracted.task.slice(0, 40)}" (Entrega: ${dueCalc.fullDeliveryText})`);

    if (!sendConfirmation) {
        return {
            success: true,
            tarea_id: task.id,
            materia: dueCalc.canonicalSubject,
            titulo: extracted.task,
            fecha: dueCalc.fullDeliveryText,
            fecha_inferida: !!dueCalc.relativeLabel && !extracted.explicit_due,
            pendiente_grupo: !settings?.target_group_jid || settings.target_group_jid === 'pending_group',
            mensaje: 'Tarea guardada. Confirma lo entendido sin pedir sintaxis ni inventar datos.'
        };
    }

    // 6. Respuesta con mini resumen para verificación inmediata
    const noGroupNotice = (!settings?.target_group_jid || settings.target_group_jid === 'pending_group')
        ? '\nLa guardé, pero falta vincular el grupo para publicar los avisos. El administrador puede configurarlo en privado.'
        : '';

    const confirmation = [
        `✅ *Va, tarea registrada (#${task.id}).*`,
        `📌 *Materia:* ${dueCalc.canonicalSubject}`,
        `📝 *Tarea:* ${extracted.task}`,
        `🗓️ *Entrega:* ${dueCalc.fullDeliveryText}`,
        noGroupNotice,
        `\nPara quitarla: \`tarea cancelar ${task.id}\`.`
    ].filter(Boolean).join('\n');

    await sendText(from, confirmation);
    return true;
}

// ─── Corte a las 14:55, Publicación a las 15:00 y Recordatorio a las 18:00 ───

let _lastPreparedDigestDate = null;

async function prepareDailySchoolDigest(now = Date.now()) {
    const timezone = process.env.TZ || 'America/Mexico_City';
    const current = localParts(now, timezone);

    if (current.time === '14:55' && _lastPreparedDigestDate !== current.date) {
        _lastPreparedDigestDate = current.date;
        const dailyTasks = await db.getAllDailySchoolTasksForDate(current.date);
        const upcomingTasks = await db.getAllUpcomingSchoolTasks(current.date, now);
        logger.info(`[SCHOOL] ⏱️ Corte de las 14:55: ${dailyTasks.length} tareas de hoy y ${upcomingTasks.length} pendientes acumuladas preparadas para las 15:00.`);
    }
}

// Seguimiento de reintentos para evitar loops infinitos ante errores 400 (Bad Request)
const schoolPublicationAttempts = new Map();

async function handlePublicationFailure(claimId, date, kind, targetGroupJid, err, label) {
    const isPermanent = err.message?.includes('400') ||
                        err.message?.includes('401') ||
                        err.message?.includes('403') ||
                        err.message?.includes('404') ||
                        err.response?.status === 400 ||
                        err.response?.status === 401 ||
                        err.response?.status === 403 ||
                        err.response?.status === 404;

    const attempts = (schoolPublicationAttempts.get(claimId) || 0) + 1;
    schoolPublicationAttempts.set(claimId, attempts);

    if (!isPermanent && attempts <= 3) {
        logger.warn(`[SCHOOL] Reintentando ${label} para ${targetGroupJid} (intento ${attempts}/3) tras error temporal: ${err.message}`);
        await db.releaseSchoolPublication(claimId, date, kind).catch(() => {});
    } else {
        logger.error(`[SCHOOL] Publicación ${label} para ${targetGroupJid} descartada definitivamente tras ${attempts} intento(s) o error permanente: ${err.message}`);
        schoolPublicationAttempts.delete(claimId);
    }
}

async function publishDailySchoolDigest(now = Date.now(), kind = 'first') {
    const timezone = process.env.TZ || 'America/Mexico_City';
    const current = localParts(now, timezone);

    const dailyTasks = await db.getAllDailySchoolTasksForDate(current.date);
    const upcomingTasks = await db.getAllUpcomingSchoolTasks(current.date, now);

    if ((!dailyTasks || dailyTasks.length === 0) && (!upcomingTasks || upcomingTasks.length === 0)) {
        return;
    }

    // Agrupar tareas por grupo destino con fallback inteligente a settings_group_jid
    const groupsMap = new Map();

    for (const t of dailyTasks) {
        const targetGroup = (t.target_group_jid && t.target_group_jid !== 'pending_group')
            ? t.target_group_jid
            : t.settings_group_jid;
        if (!targetGroup || targetGroup === 'pending_group') continue;
        if (!groupsMap.has(targetGroup)) groupsMap.set(targetGroup, { today: [], upcoming: [] });
        groupsMap.get(targetGroup).today.push(t);
    }

    for (const t of upcomingTasks) {
        const targetGroup = (t.target_group_jid && t.target_group_jid !== 'pending_group')
            ? t.target_group_jid
            : t.settings_group_jid;
        if (!targetGroup || targetGroup === 'pending_group') continue;
        if (!groupsMap.has(targetGroup)) groupsMap.set(targetGroup, { today: [], upcoming: [] });
        groupsMap.get(targetGroup).upcoming.push(t);
    }

    for (const [targetGroupJid, data] of groupsMap.entries()) {
        const { today, upcoming } = data;
        const claimId = `batch_${targetGroupJid}_${current.date}_${kind}`;
        const claimed = await db.claimSchoolPublication(claimId, current.date, kind);
        if (!claimed) continue;

        const optionsDate = { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' };
        const prettyDate = new Intl.DateTimeFormat('es-MX', optionsDate).format(new Date(now));
        const formattedDateCapitalized = prettyDate.charAt(0).toUpperCase() + prettyDate.slice(1);

        const sections = [];

        if (kind === 'first') {
            // ─── Publicación de las 15:00 ───
            if (today.length > 0) {
                const todayEntries = today.map((t, index) => {
                    const num = today.length > 1 ? `#${index + 1} ` : '';
                    const details = t.details ? `\n💬 *Detalles:* ${t.details}` : '';
                    const due = t.due_text ? `\n🗓️ *Entrega:* ${t.due_text}` : (t.due_at ? `\n🗓️ *Entrega:* ${formatDueDate(t.due_at, timezone)}` : '');
                    return `📌 *${num}Materia:* ${t.subject}\n📝 *Tarea:* ${t.title}${details}${due}`;
                }).join('\n\n───────────────────────────────\n\n');

                sections.push(`📚 *TAREAS ASIGNADAS HOY*\n📅 *${formattedDateCapitalized}*\n\n${todayEntries}`);
            }

            if (upcoming.length > 0) {
                const upcomingEntries = upcoming.map((t, index) => {
                    const num = upcoming.length > 1 ? `${index + 1}. ` : '';
                    const due = t.due_text ? `\n   🗓️ *Entrega:* ${t.due_text}` : (t.due_at ? `\n   🗓️ *Entrega:* ${formatDueDate(t.due_at, timezone)}` : '');
                    return `📌 *${num}${t.subject}*\n   📝 ${t.title}${due}`;
                }).join('\n\n');

                sections.push(`⏳ *PENDIENTES Y PRÓXIMAS ENTREGAS*\n_(Tareas de días anteriores aún activas)_\n\n${upcomingEntries}`);
            }

            const fullMessage = sections.join('\n\n═══════════════════════════════\n\n');

            try {
                await sendText(targetGroupJid, fullMessage);
                logger.success(`[SCHOOL] Digest completo publicado a las 15:00 en ${targetGroupJid} (${today.length} hoy, ${upcoming.length} pendientes)`);

                // Enviar imágenes adjuntas de las tareas de hoy si existen
                for (const t of today) {
                    if (t.media_path && fs.existsSync(t.media_path)) {
                        const caption = `📸 *Material de apoyo:* ${t.subject}\n_${t.title}_`;
                        await sendMedia(targetGroupJid, t.media_path, caption).catch(err => {
                            logger.error(`[SCHOOL] Error enviando imagen adjunta de tarea #${t.id}: ${err.message}`);
                        });
                    }
                }
                schoolPublicationAttempts.delete(claimId);
            } catch (err) {
                logger.error(`[SCHOOL] Error publicando digest en ${targetGroupJid}: ${err.message}`);
                await handlePublicationFailure(claimId, current.date, kind, targetGroupJid, err, 'digest');
            }
        } else if (kind === 'second') {
            // ─── Recordatorio de las 18:00 ───
            if (today.length > 0) {
                const todayEntries = today.map((t, index) => {
                    const num = today.length > 1 ? `${index + 1}. ` : '';
                    const due = t.due_text ? ` (Entrega: ${t.due_text})` : (t.due_at ? ` (Entrega: ${formatDueDate(t.due_at, timezone)})` : '');
                    return `📌 *${num}${t.subject}*\n📝 ${t.title}\n🗓️ ${due}`;
                }).join('\n\n───────────────────────────────\n\n');

                sections.push(`🔔 *RECORDATORIO DE TAREAS DEL DÍA*\n\n${todayEntries}`);
            }

            if (upcoming.length > 0) {
                const upcomingEntries = upcoming.map((t, index) => {
                    const num = upcoming.length > 1 ? `${index + 1}. ` : '';
                    const due = t.due_text ? ` - Entrega: ${t.due_text}` : (t.due_at ? ` - Entrega: ${formatDueDate(t.due_at, timezone)}` : '');
                    return `⏳ *${num}${t.subject}:* ${t.title}${due}`;
                }).join('\n\n');

                sections.push(`📅 *OTRAS ENTREGAS PRÓXIMAS*\n\n${upcomingEntries}`);
            }

            const fullMessage = sections.join('\n\n═══════════════════════════════\n\n');

            try {
                await sendText(targetGroupJid, fullMessage);
                logger.success(`[SCHOOL] Recordatorio publicado a las 18:00 en ${targetGroupJid}`);
                schoolPublicationAttempts.delete(claimId);
            } catch (err) {
                logger.error(`[SCHOOL] Error enviando recordatorio a ${targetGroupJid}: ${err.message}`);
                await handlePublicationFailure(claimId, current.date, kind, targetGroupJid, err, 'recordatorio');
            }
        }
    }
}

async function publishDueSchoolTasks(now = Date.now()) {
    // 1. Corte de las 14:55
    await prepareDailySchoolDigest(now);

    const timezone = process.env.TZ || 'America/Mexico_City';
    const current = localParts(now, timezone);

    // 2. Digest diario por lote con ventana de reintento automático (15:00-15:15 y 18:00-18:15)
    const [hourStr, minStr] = current.time.split(':');
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minStr, 10);

    if (hour === 15 && minute >= 0 && minute <= 15) {
        await publishDailySchoolDigest(now, 'first');
    } else if (hour === 18 && minute >= 0 && minute <= 15) {
        await publishDailySchoolDigest(now, 'second');
    }

    // 3. Soporte para tareas individuales legadas con horario específico fuera del digest consolidado
    const tasks = await db.getActiveSchoolTasks();
    for (const task of tasks) {
        // Tareas con lote (batch) se publican exclusivamente en el digest consolidado
        if (task.batch_date) continue;
        // En los horarios del digest (15:00 y 18:00), el digest consolidado ya las agrupa
        if (current.time === '15:00' || current.time === '18:00') continue;
        if (!task.target_group_jid || !task.due_at || now > task.due_at) continue;

        const taskTz = task.timezone || timezone;
        const taskCurrent = localParts(now, taskTz);
        const first = parseClock(task.first_publish_time);
        const second = parseClock(task.second_publish_time);
        if (first === '15:00' && second === '18:00') continue; // Horario estándar del digest

        let kind = null;
        if (first && first === taskCurrent.time) kind = 'first';
        else if (second && second === taskCurrent.time) kind = 'second';
        if (!kind) continue;

        const claimed = await db.claimSchoolPublication(task.id, taskCurrent.date, kind);
        if (!claimed) continue;
        const prefix = kind === 'second' ? '🔔 *RECORDATORIO DE TAREA*\n\n' : '';
        try {
            await sendText(task.target_group_jid, `${prefix}${formatTask(task, taskTz)}`);
            logger.info(`[SCHOOL] Tarea individual legada #${task.id} publicada (${kind}) en ${task.target_group_jid}`);
        } catch (err) {
            logger.error(`[SCHOOL] Error publicando tarea individual #${task.id}: ${err.message}`);
        }
    }
}

// Cancel first, then remove only the uploaded file inside the school media directory.
async function cancelTaskAndMedia(id) {
    const task = await db.getSchoolTaskById(id);
    if (!task || !await db.cancelSchoolTask(id)) return false;
    const mediaDir = path.resolve(process.cwd(), 'data', 'school_media');
    if (typeof task.media_path === 'string' && path.dirname(path.resolve(task.media_path)) === mediaDir) {
        try {
            await fs.promises.unlink(path.resolve(task.media_path));
        } catch (err) {
            if (err.code !== 'ENOENT') logger.warn(`[SCHOOL] No se pudo limpiar el adjunto de la tarea #${id}: ${err.code}`);
        }
    }
    return true;
}

registerIntervalSeconds('school-task-publisher', 10, () => publishDueSchoolTasks().catch(err => logger.error(`[SCHOOL] Publisher: ${err.message}`)));

module.exports = {
    WEEKDAYS,
    parseClock,
    localParts,
    parseDueDate,
    formatDueDate,
    normalizeTaskPieces,
    formatTask,
    extractSchoolTaskDetails,
    handleDirectTaskMessage,
    cancelTaskAndMedia,
    prepareDailySchoolDigest,
    publishDailySchoolDigest,
    publishDueSchoolTasks
};
