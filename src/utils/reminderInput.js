'use strict';

const { resolveMessageText, extractQuotedText } = require('./messageText');

function formatTimeDiff(ms) {
    const totalSecs = Math.max(1, Math.round(ms / 1000));
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0) parts.push(`${mins}m`);
    if (parts.length === 0 || (hours === 0 && mins < 5 && secs > 0)) parts.push(`${secs}s`);
    return parts.join(' ');
}

function parseReminderTime(timeStr, minutesHint = null, nowMs = Date.now(), { canonicalOnly = false } = {}) {
    const now = new Date(nowMs);
    const result = dueAt => Number.isFinite(dueAt) && dueAt > nowMs && Number.isFinite(new Date(dueAt).getTime())
        ? { dueAt, timeDesc: formatTimeDiff(dueAt - nowMs) } : null;
    const clean = typeof timeStr === 'string' ? timeStr.trim().toLowerCase() : '';

    // Una fecha completa debe evaluarse antes de buscar horas o duraciones.
    if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
        if (canonicalOnly && !/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:z|[+-]\d{2}:\d{2})$/i.test(clean)) return null;
        const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})(?:t(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:z|[+-]\d{2}:\d{2})?)?$/i);
        if (!iso) return null;
        const [, year, month, day, hour = '0', minute = '0', second = '0'] = iso;
        const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
        if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 ||
            calendar.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
        return result(Date.parse(clean));
    }

    // Explicit CLI supports compact numeric durations. Natural time is model data.
    if (clean) {
        const duration = clean.match(/^(\d+(?:\.\d+)?)(s|m|h|d)$/);
        if (!canonicalOnly && duration) {
            const factor = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[duration[2]];
            return result(nowMs + Number(duration[1]) * factor);
        }
        return null;
    }

    const hint = typeof minutesHint === 'number' ? minutesHint : typeof minutesHint === 'string' && minutesHint.trim() ? Number(minutesHint) : NaN;
    return Number.isFinite(hint) && hint > 0 ? result(nowMs + Math.round(hint * 60000)) : null;
}

function prepareReminder(args = {}, messageData = {}, nowMs = Date.now(), options = {}) {
    const mensaje = options.canonicalOnly
        ? (typeof args.mensaje === 'string' && args.mensaje.trim() ? args.mensaje.trim() : extractQuotedText(messageData) || '')
        : resolveMessageText(args.mensaje, messageData);
    const parsed = parseReminderTime(args.tiempo, args.minutos, nowMs, options);
    if (!mensaje || !parsed) {
        const missing = [...(!mensaje ? ['mensaje'] : []), ...(!parsed ? ['tiempo'] : [])];
        const question = !mensaje && !parsed ? '¿Qué te recuerdo y cuándo te aviso?' :
            !mensaje ? '¿Qué te recuerdo? También puedes responder al mensaje que quieres recordar.' :
                '¿Cuándo te aviso? Por ejemplo: en 20 minutos o mañana a las 9am.';
        return { success: false, needs_clarification: true, missing_fields: missing, question, error: question };
    }
    return { success: true, mensaje, ...parsed };
}

module.exports = { parseReminderTime, formatTimeDiff, prepareReminder };
