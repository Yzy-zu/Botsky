'use strict';

const { sendText } = require('../services/evolution');
const db = require('../services/db');
const { getSenderJid, isAuthorizedAdmin } = require('../core/auth');

function normalizeJid(jid) {
    return String(jid || '').trim().replace(/:[0-9]+@/, '@');
}

function renderPoll(poll, results = []) {
    const counts = new Map(results.map(row => [Number(row.option_index), Number(row.votes)]));
    let text = `📊 *ENCUESTA #${poll.id}*\n${poll.question}\n\n`;
    poll.options.forEach((option, index) => {
        const votes = counts.get(index) || 0;
        text += `${index + 1}. ${option}${results.length ? ` — ${votes} voto${votes === 1 ? '' : 's'}` : ''}\n`;
    });
    return text.trim();
}

function parseCreation(parsed) {
    const params = parsed.aiArgs || parsed || {};
    if (parsed.semanticDecision) return { question: params.pregunta || params.question || '', options: params.opciones || params.options || [] };
    const raw = String(params.raw || parsed.raw || '').replace(/^\S+\s*/, '').trim();
    const withoutAction = /^(?:crear|nueva|nuevo)\b/i.test(raw) ? raw.replace(/^\S+\s*/, '').trim() : raw;
    const pieces = withoutAction.split('|').map(value => value.trim()).filter(Boolean);
    if (pieces.length >= 3) {
        return { question: pieces[0], options: pieces.slice(1) };
    }

    const question = params.pregunta || params.question || parsed.flags?.pregunta || parsed.flags?.question || '';
    const options = params.opciones || params.options || parsed.flags?.opciones || parsed.flags?.options;
    if (question && Array.isArray(options)) return { question, options };
    return { question: '', options: [] };
}

function resolveVoteOption(value, options) {
    const text = String(value ?? '').trim();
    if (/^\d+$/.test(text)) {
        const index = Number(text) - 1;
        return index >= 0 && index < options.length ? index : -1;
    }
    const normalize = input => String(input).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    const matches = options.map((option, index) => normalize(option) === normalize(text) ? index : -1).filter(index => index >= 0);
    return text && matches.length === 1 ? matches[0] : -1;
}

async function handleEncuesta(parsed = {}, from, messageData = {}) {
    if (!from || typeof from !== 'string' || !from.endsWith('@g.us')) {
        return sendText(from, '> Las encuestas sólo funcionan dentro de un grupo.');
    }

    const args = parsed.args || [];
    const params = parsed.aiArgs || {};
    const action = String(params.accion || params.action || args[0] || 'ver').toLowerCase();
    const senderJid = getSenderJid(from, messageData);
    const senderName = messageData?.pushName || 'Usuario';

    if (['crear', 'nueva', 'nuevo'].includes(action)) {
        const { question, options } = parseCreation(parsed);
        if (!question || options.length < 2) {
            return sendText(from, '¿Qué preguntamos y cuáles son las opciones? Por ejemplo: Botsky, haz una encuesta de Minecraft o película.');
        }
        try {
            const active = await db.getActivePoll(from);
            if (active) return sendText(from, `Ya hay una encuesta activa (#${active.id}). Voten o ciérrenla primero.`);
            const poll = await db.createPoll({ chatId: from, creatorJid: senderJid, creatorName: senderName, question, options });
            return sendText(from, `${renderPoll(poll)}\n\nDime: Botsky, voto por 2, o el nombre de tu opción.`);
        } catch (err) {
            return sendText(from, `> No pude crear la encuesta: ${err.message}`);
        }
    }

    const poll = await db.getActivePoll(from);
    if (!poll) return sendText(from, '> No hay una encuesta activa en este grupo.');

    if (['votar', 'voto', 'vote'].includes(action)) {
        const choice = params.opcion ?? params.option ?? parsed.flags?.opcion ?? args.slice(1).join(' ');
        const option = resolveVoteOption(choice, poll.options);
        if (!Number.isInteger(option) || option < 0 || option >= poll.options.length) {
            return sendText(from, `¿Por cuál votas? Dime un número del 1 al ${poll.options.length} o el nombre de la opción.`);
        }
        const result = await db.votePoll(poll.id, normalizeJid(senderJid), option);
        if (result.duplicate) return sendText(from, '> Ya votaste en esta encuesta.');
        return sendText(from, `✅ Voto registrado por: *${poll.options[option]}*`);
    }

    if (['cerrar', 'fin', 'terminar'].includes(action)) {
        const creator = normalizeJid(poll.creator_jid) === normalizeJid(senderJid);
        if (!creator && !isAuthorizedAdmin(from, messageData)) {
            return sendText(from, '> Sólo quien creó la encuesta o un admin puede cerrarla.');
        }
        await db.closePoll(poll.id, from);
        const results = await db.getPollResults(poll.id);
        return sendText(from, `${renderPoll(poll, results)}\n\n🔒 Encuesta cerrada.`);
    }

    if (['ver', 'lista', 'listar'].includes(action)) {
        const results = await db.getPollResults(poll.id);
        return sendText(from, renderPoll(poll, results));
    }

    return sendText(from, 'Uso: `encuesta crear`, `encuesta votar número`, `encuesta ver` o `encuesta cerrar`');
}

module.exports = { handleEncuesta, renderPoll, parseCreation, resolveVoteOption };
