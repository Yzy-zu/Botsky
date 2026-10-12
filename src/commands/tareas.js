'use strict';

const evolution = require('../services/evolution');
const sendText = (to, text, opts) => evolution.sendText(to, text, opts);
const db = require('../services/db');
const { getSenderJid, isAuthorizedAdmin, isAuthorizedTaskUploader } = require('../core/auth');
const { WEEKDAYS, parseClock, formatDueDate, normalizeTaskPieces, handleDirectTaskMessage } = require('../services/school');

function isPrivateChat(from) {
    return typeof from === 'string' && from.endsWith('@s.whatsapp.net');
}

function usage() {
    return [
        '📚 *TAREAS ESCOLARES*',
        '',
        'tarea grupo 123456@g.us (solo admin)',
        'tarea horas 15:00 18:00 (solo admin)',
        'tarea uploaders (ver usuarios autorizados)',
        'Cuéntame la tarea como te la dejaron, sin formato especial.',
        'Por ejemplo: «Botsky, guarda que en matemáticas hay que resolver la página 84 para el viernes».',
        'Si no mencionas entrega, uso la próxima clase cuando conozco el horario; si no, la guardo sin fecha.',
        'tarea lista',
        'tarea cancelar 3',
        '',
        'Horario: una línea por clase:',
        'lunes | Matemáticas | 08:00-09:00 | salón 3'
    ].join('\n');
}

function parseScheduleLine(line) {
    const pieces = normalizeTaskPieces(line);
    if (pieces.length < 2) return null;
    const weekday = WEEKDAYS[String(pieces[0]).toLowerCase()];
    if (weekday === undefined) return null;
    const time = pieces[2] ? pieces[2].match(/(\d{1,2}:\d{2})\s*(?:-|a)\s*(\d{1,2}:\d{2})/i) : null;
    return {
        weekday,
        subject: pieces[1].slice(0, 120),
        startTime: time && parseClock(time[1]),
        endTime: time && parseClock(time[2]),
        room: pieces[3] ? pieces[3].slice(0, 80) : null,
        notes: pieces[4] ? pieces.slice(4).join(' | ').slice(0, 200) : null
    };
}

async function handleTareas(parsed = {}, from, messageData = {}) {
    if (!isPrivateChat(from)) return sendText(from, '> La configuración de tareas se maneja en privado.');
    if (!isAuthorizedTaskUploader(from, messageData)) return sendText(from, '> Sólo las personas autorizadas pueden registrar y consultar tareas escolares.');

    const ownerJid = getSenderJid(from, messageData) || from;
    const isAdmin = isAuthorizedAdmin(from, messageData);
    const params = parsed.aiArgs || parsed || {};
    const args = parsed.args || [];
    const action = String(params.accion || params.action || (params.titulo || params.title ? 'crear' : args[0]) || 'ayuda').toLowerCase();
    const raw = String(params.raw || parsed.raw || '').replace(/^\S+\s*/, '').replace(/^\S+\s*/, '').trim();

    if (['ayuda', 'help', ''].includes(action)) return sendText(from, usage());

    if (action === 'uploaders' || action === 'autorizados' || action === 'miembros') {
        const adminNumbers = (process.env.ALLOWED_NUMBERS_ADMIN || '').split(',').map(n => n.trim()).filter(Boolean);
        const taskNumbers = (process.env.ALLOWED_NUMBERS_TASKS || '').split(',').map(n => n.trim()).filter(Boolean);
        return sendText(from,
            `📋 *USUARIOS AUTORIZADOS PARA TAREAS*\n\n` +
            `👑 *Administradores:*\n${adminNumbers.map(n => `• ${n}`).join('\n') || 'Ninguno'}\n\n` +
            `📝 *Subida de Tareas:*\n${taskNumbers.map(n => `• ${n}`).join('\n') || 'Ninguno'}`
        );
    }

    if (action === 'grupo') {
        if (!isAdmin) return sendText(from, '> Sólo el administrador principal puede cambiar el grupo escolar.');
        const groupJid = params.grupo || params.group || args[1] || '';
        if (!/^\d+@g\.us$/.test(groupJid)) return sendText(from, '> Usa el JID del grupo: `tarea grupo 123456@g.us`');
        const settings = await db.saveSchoolSettings({ ownerJid, targetGroupJid: groupJid });
        return sendText(from, `✅ Grupo escolar configurado: ${settings.target_group_jid}`);
    }

    if (action === 'horas') {
        if (!isAdmin) return sendText(from, '> Sólo el administrador principal puede cambiar los horarios de aviso.');
        const first = parseClock(params.primera_hora || params.firstPublishTime || args[1]);
        const second = parseClock(params.segunda_hora || params.secondPublishTime || args[2]);
        if (!first || !second) return sendText(from, '> Usa dos horarios válidos: `tarea horas 15:00 18:00`');
        await db.saveSchoolSettings({ ownerJid, firstPublishTime: first, secondPublishTime: second });
        return sendText(from, `✅ Avisos programados a las ${first} y ${second}.`);
    }

    if (action === 'horario') {
        if (params.subaccion === 'ver' || args[1] === 'ver') {
            let schedule = await db.getSchoolSchedule(ownerJid);
            if (!schedule || !schedule.length) {
                const adminNumbers = (process.env.ALLOWED_NUMBERS_ADMIN || '').split(',').map(n => n.trim().replace(/[^0-9]/g, '')).filter(Boolean);
                for (const adm of adminNumbers) {
                    const admSchedule = await db.getSchoolSchedule(`${adm}@s.whatsapp.net`);
                    if (admSchedule && admSchedule.length > 0) {
                        schedule = admSchedule;
                        break;
                    }
                }
            }
            if (!schedule || !schedule.length) return sendText(from, '> No hay horario guardado.');
            const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
            return sendText(from, schedule.map(item => `${WEEKDAY_LABELS[item.weekday] || item.weekday}: ${item.subject}${item.start_time ? ` (${item.start_time}-${item.end_time || '?'})` : ''}${item.room ? ` | ${item.room}` : ''}`).join('\n'));
        }
        if (!isAdmin) return sendText(from, '> Sólo el administrador principal puede editar el horario.');
        const scheduleText = params.horario || parsed.flags?.horario || raw.replace(/^horario\s*/i, '');
        const lines = String(scheduleText).split(/\n/).map(parseScheduleLine).filter(Boolean);
        if (!lines.length) return sendText(from, '> Usa: `tarea horario lunes | Matemáticas | 08:00-09:00 | salón 3`');
        await db.saveSchoolSchedule(ownerJid, lines);
        return sendText(from, `✅ Horario guardado: ${lines.length} clases.`);
    }

    if (action === 'lista' || action === 'listar') {
        const tasks = await db.getSchoolTasks();
        if (!tasks.length) return sendText(from, '> No hay tareas activas.');
        return sendText(from, tasks.map(task => `#${task.id} | ${task.subject ? `${task.subject}: ` : ''}${task.title} | entrega ${task.due_text || (task.due_at ? formatDueDate(task.due_at) : 'pendiente')}`).join('\n'));
    }

    if (action === 'cancelar' || action === 'borrar') {
        const id = Number.parseInt(params.id ?? args[1], 10);
        if (!Number.isInteger(id)) return sendText(from, '> Especifica el ID: `tarea cancelar 3`');
        const cancelled = await db.cancelSchoolTask(id);
        return sendText(from, cancelled ? `✅ Tarea #${id} cancelada.` : '> No encontré esa tarea activa.');
    }

    if (['crear', 'nueva', 'nuevo', 'guardar', 'registrar', 'anotar'].includes(action)) {
        const naturalText = parsed.semanticDecision ? String(params.texto_original || parsed.raw || '') : String(params.texto_original || parsed.raw || args.slice(1).join(' '))
            .replace(/^(?:tarea|tareas|deberes)\s+(?:crear|nueva|nuevo|guardar|registrar|anotar)\s*/i, '')
            .replace(/^(?:crear|nueva|nuevo|guardar|registrar|anotar)\s+/i, '').trim();
        const taskDetails = {
            materia: params.materia || params.subject,
            titulo: params.titulo || params.title || params.mensaje,
            fecha: params.fecha || params.entrega || params.due,
            detalles: params.detalles || params.details
        };
        // Conservar el formato anterior si el usuario decide usarlo.
        const pieces = parsed.semanticDecision ? [] : !parsed.aiArgs && !parsed.raw && args.length >= 4
            ? args.slice(1)
            : normalizeTaskPieces(naturalText);
        if (!taskDetails.titulo && pieces.length >= 3) {
            taskDetails.materia = pieces[0];
            taskDetails.titulo = pieces[1];
            taskDetails.fecha = pieces[2];
            taskDetails.detalles = pieces[3] || null;
        }
        if (!taskDetails.titulo && !naturalText) {
            return sendText(from, '¿Qué hay que hacer? Cuéntame la tarea como te la dejaron, compa.');
        }
        return handleDirectTaskMessage({ text: naturalText, from, messageData, taskDetails });
    }

    return sendText(from, usage());
}

module.exports = { handleTareas, parseScheduleLine, usage };

