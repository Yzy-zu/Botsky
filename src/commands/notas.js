'use strict';

const evolution = require('../services/evolution');
const sendText = (to, text, opts) => evolution.sendText(to, text, opts);
const db = require('../services/db');
const logger = require('../services/logger');
const { resolveMessageText } = require('../utils/messageText');

/**
 * Formatea un timestamp ISO o numérico a formato legible de fecha y hora.
 */
function formatNoteDate(timestamp) {
    try {
        const d = new Date(timestamp);
        return d.toLocaleDateString('es-MX', {
            timeZone: 'America/Mexico_City',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return new Date(timestamp).toLocaleDateString();
    }
}

/**
 * Manejador principal del comando de notas compartidas.
 */
async function handleNotas(parsed = {}, from, messageData = {}) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    const participant = messageData?.key?.participant || messageData?.participant || from;
    const userName = messageData?.pushName || 'Usuario';
    const params = parsed.aiArgs || parsed;
    const rawArgs = parsed.args || [];
    const flags = parsed.flags || {};

    const firstArg = (rawArgs[0] || '').toLowerCase();
    const actionParam = (params.accion || params.action || flags.accion || flags.action || '').toLowerCase();

    // Determinar la acción solicitada
    let action = actionParam;
    let textArg = '';

    if (actionParam) {
        textArg = params.contenido || params.nota || flags.contenido || flags.nota || (rawArgs.slice(1).join(' ').trim() || rawArgs.join(' ').trim());
    } else if (['guardar', 'add', 'crear', 'nueva', 'nuevo', 'anotar'].includes(firstArg)) {
        action = 'guardar';
        textArg = rawArgs.slice(1).join(' ').trim();
    } else if (['lista', 'listar', 'ver', 'todos', 'todas'].includes(firstArg)) {
        action = 'listar';
    } else if (['buscar', 'find', 'search', 'query'].includes(firstArg)) {
        action = 'buscar';
        textArg = rawArgs.slice(1).join(' ').trim();
    } else if (['borrar', 'eliminar', 'del', 'quitar', 'remove'].includes(firstArg)) {
        action = 'borrar';
        textArg = String(params.id || flags.id || rawArgs[1] || '').trim();
    } else if (rawArgs.length === 0 && !params.contenido) {
        action = 'listar';
    } else {
        action = 'guardar';
        textArg = params.contenido || rawArgs.join(' ').trim();
    }

    // ─── 1. SUBCOMANDO: GUARDAR NOTA ───
    if (action === 'guardar') {
        const noteContent = resolveMessageText(textArg || flags.contenido || flags.nota, messageData);

        if (!noteContent) {
            return await sendText(from,
                `📝 *Notas del chat*\n` +
                `¿Qué guardamos?\n` +
                `Escribe \`nota guardar [texto]\`\n` +
                `O responde al mensaje con \`nota guardar\`.`
            );
        }

        try {
            const saved = await db.addNote(from, participant, userName, noteContent);
            return await sendText(from,
                `📝 Va, guardé la nota *#${saved.id}*.\n` +
                `> "${noteContent}"\n` +
                `_${userName} · visible en este chat_`
            );
        } catch (err) {
            logger.error('[NOTAS] Error al guardar nota:', err);
            return await sendText(from, 'No pude guardar la nota. Intenta de nuevo en un momento.');
        }
    }

    // ─── 2. SUBCOMANDO: LISTAR NOTAS ───
    if (action === 'listar') {
        try {
            const notes = await db.getNotes(from, 20);
            if (!notes || notes.length === 0) {
                return await sendText(from,
                    `📝 *Notas del chat*\n\n` +
                    `Todavía no hay notas en este chat.\n` +
                    `Guarda la primera con \`nota guardar [texto]\`.`
                );
            }

            let msg = `📝 *Notas del chat* (${notes.length})\n\n`;
            for (const n of notes) {
                const dateStr = formatNoteDate(n.created_at);
                msg += `• *#${n.id}* | "${n.content}"\n` +
                       `  ✍️ ${n.user_name || 'Alguien'} • ${dateStr}\n\n`;
            }
            msg += `Para borrar una: \`nota borrar [id]\`.`;
            return await sendText(from, msg.trim());
        } catch (err) {
            logger.error('[NOTAS] Error al listar notas:', err);
            return await sendText(from, 'No pude consultar las notas. Intenta de nuevo en un momento.');
        }
    }

    // ─── 3. SUBCOMANDO: BUSCAR NOTAS ───
    if (action === 'buscar') {
        const query = (textArg || flags.query || '').trim();
        if (!query) {
            return await sendText(from, '¿Qué buscamos? Usa `nota buscar [palabra]`.');
        }

        try {
            const results = await db.searchNotes(from, query);
            if (!results || results.length === 0) {
                return await sendText(from, `No encontré notas con “${query}”. Prueba con otra palabra.`);
            }

            let msg = `🔍 *Esto encontré* (${results.length})\n\n`;
            for (const n of results) {
                const dateStr = formatNoteDate(n.created_at);
                msg += `• *#${n.id}* | "${n.content}"\n` +
                       `  ✍️ ${n.user_name || 'Alguien'} • ${dateStr}\n\n`;
            }
            return await sendText(from, msg.trim());
        } catch (err) {
            logger.error('[NOTAS] Error al buscar notas:', err);
            return await sendText(from, 'No pude buscar en las notas. Intenta de nuevo en un momento.');
        }
    }

    // ─── 4. SUBCOMANDO: BORRAR NOTA ───
    if (action === 'borrar') {
        const idToDel = parseInt(textArg || flags.id, 10);
        if (isNaN(idToDel)) {
            return await sendText(from, 'Dime cuál nota borramos: `nota borrar 3`.\nConsulta los números con `nota lista`.');
        }

        try {
            const deleted = await db.deleteNote(from, idToDel);
            if (deleted) {
                return await sendText(from, `Listo, borré la nota *#${idToDel}*.`);
            } else {
                return await sendText(from, `No encontré la nota *#${idToDel}* aquí. Revisa \`nota lista\`.`);
            }
        } catch (err) {
            logger.error('[NOTAS] Error al borrar nota:', err);
            return await sendText(from, 'No pude borrar la nota. Intenta de nuevo en un momento.');
        }
    }

    return await sendText(from, 'No entendí qué hacer con la nota. Usa `nota lista`, `nota guardar [texto]` o `nota borrar [id]`.');
}

module.exports = {
    handleNotas,
    formatNoteDate
};
