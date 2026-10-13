'use strict';

const { sendText } = require('../services/evolution');
const { getOrCreateUser, getTop, addXp } = require('../services/db');
const { isAuthorizedAdmin, getSenderJid, cleanJidNumber } = require('../core/auth');
const logger = require('../services/logger');

async function handleRank(parsed = {}, from, messageData = {}) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    if (!from) return;
    const participant = messageData?.key?.participant || messageData?.participant || from;
    const user = await getOrCreateUser(participant);

    let rankName = 'gay';
    if (user.level >= 5) rankName = 'pasivo caliente';
    if (user.level >= 10) rankName = 'pasivo';
    if (user.level >= 20) rankName = 'activo';
    if (user.level >= 50) rankName = 'rey';

    const cleanJid = participant.replace(/:[0-9]+(?=@)/, '').split('@')[0];
    const msg = `> perfil\n` +
        `usuario: \`@${cleanJid}\`\n` +
        `nivel: \`${user.level}\` ${rankName}\n` +
        `xp: \`${user.xp}\`\n` +
        `advertencias: \`${user.strikes}/3\`\``;

    await sendText(from, msg, { mentions: [participant.replace(/:[0-9]+(?=@)/, '')] });
}

async function handleTop(parsed = {}, from, messageData = {}) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    if (!from) return;
    const users = (await getTop(5)).filter(user => typeof user.jid === 'string' && user.jid.trim());

    if (users.length === 0) {
        return sendText(from, '> sin datos aun');
    }

    let msg = `> top 5 mas activos\n`;
    const mentions = [];
    users.forEach((u, i) => {
        const cleanJid = u.jid.replace(/:[0-9]+(?=@)/, '');
        const medal = i === 0 ? '#1' : (i === 1 ? '#2' : (i === 2 ? '#3' : '#' + (i + 1)));
        msg += `${medal} \`@${cleanJid.split('@')[0]}\` nivel ${u.level} (${u.xp} xp)\n`;
        mentions.push(cleanJid);
    });

    await sendText(from, msg, { mentions });
}

/**
 * Añade experiencia (XP) al usuario o a un amigo mencionado. Comando restringido estrictamente al administrador autorizado.
 */
async function handleDarXp(parsed = {}, from, messageData = {}) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    // 1. Verificación estricta de seguridad: Solo el administrador / dueño puede otorgar experiencia
    if (!isAuthorizedAdmin(from, messageData)) {
        const sender = getSenderJid(from, messageData);
        logger.warn(`[SECURITY] Intento no autorizado de otorgar XP desde ${from} (sender: ${sender})`);
        return await sendText(from, '> ❌ Acceso denegado. Solo el administrador autorizado puede otorgar experiencia.');
    }

    const senderJid = getSenderJid(from, messageData);
    const rawParticipant = messageData?.key?.participant;
    const params = parsed.aiArgs || {};

    // 2. Extraer la cantidad de XP solicitada
    let requestedAmount = params.cantidad ?? params.quantity ?? params.amount;
    if (requestedAmount === undefined && Array.isArray(parsed.args)) {
        const numArg = parsed.args.find(a => /^\d+$/.test(String(a).trim()) && Number(a) <= 1000000);
        if (numArg !== undefined) requestedAmount = numArg;
    }
    if (requestedAmount === undefined && parsed.raw) {
        const match = String(parsed.raw).match(/(?:dale|dame|dar|add|añademe|anademe|sumar|regalale|regálale|poner|xp|exp)\s+(\d{1,7})\b/i) ||
                      String(parsed.raw).match(/\b(\d{1,7})\s*(?:xp|exp|de\s*xp|de\s*exp)\b/i);
        if (match) requestedAmount = match[1];
    }
    const amount = requestedAmount === undefined && !parsed.semanticDecision ? 1000 : Number(requestedAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
        return await sendText(from, '¿Cuánta XP quieres dar? Dime una cantidad entre 1 y 1,000,000.');
    }

    // 3. Detectar si el admin está otorgando XP a otro usuario (mención @, mensaje citado, o parámetro)
    const contextInfo = messageData?.message?.extendedTextMessage?.contextInfo ||
                        messageData?.message?.[Object.keys(messageData?.message || {})[0]]?.contextInfo ||
                        messageData?.contextInfo;
    const mentionedFromContext = contextInfo?.mentionedJid?.[0];
    const quotedParticipant = contextInfo?.participant;

    const targetParam = params.target || params.usuario || params.target_jid || params.destinatario;

    let mentionFromText = null;
    if (Array.isArray(parsed.args)) {
        const found = parsed.args.find(a => String(a).startsWith('@') || /^\d{10,16}(@s\.whatsapp\.net)?$/.test(String(a)));
        if (found) mentionFromText = String(found).trim();
    }
    if (!mentionFromText && parsed.raw) {
        const match = String(parsed.raw).match(/@(\d{8,16})\b/);
        if (match) mentionFromText = match[1];
    }

    const candidateTarget = mentionedFromContext || targetParam || mentionFromText || quotedParticipant;

    let resolvedTargetJid = null;
    if (candidateTarget && typeof candidateTarget === 'string') {
        const cleaned = candidateTarget.trim();
        if (cleaned.endsWith('@s.whatsapp.net') || cleaned.endsWith('@g.us') || cleaned.endsWith('@lid')) {
            resolvedTargetJid = cleaned.replace(/:[0-9]+(?=@)/, '').replace(/:[0-9]+$/, '');
        } else {
            const digits = cleaned.replace(/[^0-9]/g, '');
            if (digits.length >= 8) {
                resolvedTargetJid = (digits.length === 15 && digits.startsWith('2'))
                    ? `${digits}@lid`
                    : `${digits}@s.whatsapp.net`;
            }
        }
    }

    const norm = (jid) => (jid ? String(jid).trim().replace(/:[0-9]+(?=@)/, '').replace(/:[0-9]+$/, '') : '');
    const normResolved = norm(resolvedTargetJid);
    const normSender = norm(senderJid);
    const normParticipant = norm(rawParticipant);

    let isSameAsSender = false;
    if (normResolved) {
        if (normResolved === normSender || normResolved === normParticipant) {
            isSameAsSender = true;
        } else {
            const numResolved = cleanJidNumber(normResolved);
            const numSender = cleanJidNumber(normSender);
            if (numResolved && numSender && numResolved === numSender) {
                isSameAsSender = true;
            }
        }
    }

    const isOtherTarget = Boolean(normResolved && !isSameAsSender);
    const targetJid = isOtherTarget ? normResolved : (rawParticipant || senderJid || from);
    const isSelf = !isOtherTarget;

    const targetPhone = cleanJidNumber(targetJid) || targetJid.split('@')[0];
    const userName = isSelf ? (messageData?.pushName || 'Admin') : `@${targetPhone}`;

    // 4. Añadir experiencia en SQLite
    try {
        const result = await addXp(targetJid, amount);
        if (isSelf && senderJid && senderJid !== targetJid) {
            await addXp(senderJid, amount).catch(() => {});
        }

        logger.success(`[XP-ADMIN] Otorgados +${amount} XP a ${targetJid} (nuevo saldo: ${result.xp} XP, nivel ${result.level})`);

        let response = `⚡ *¡EXPERIENCIA AÑADIDA!*\n\n` +
            `👤 Beneficiario: *${userName}*\n` +
            `✨ XP añadida: *+${amount.toLocaleString('es-MX')} XP*\n` +
            `💰 Saldo total: *${result.xp.toLocaleString('es-MX')} XP*\n` +
            `🎖️ Nivel actual: *Nivel ${result.level}*`;

        if (result.levelUp) {
            response += `\n🎉 *¡Felicidades, subiste de nivel!*`;
        }

        const sendOpts = isOtherTarget ? { mentions: [targetJid] } : {};
        await sendText(from, response, sendOpts);
    } catch (err) {
        logger.error('[XP-ADMIN] Error al añadir XP:', err);
        await sendText(from, `> ❌ Error al añadir experiencia: ${err.message}`);
    }
}

async function handleNiveles(parsed = {}, from, messageData = {}) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    const safeParsed = parsed || {};
    const subcmd = String(safeParsed.args?.[0] || safeParsed.command || 'rank').toLowerCase().trim();
    if (subcmd === 'top') {
        return await handleTop(safeParsed, from, messageData);
    }
    return await handleRank(safeParsed, from, messageData);
}

module.exports = {
    handleRank,
    handleTop,
    handleDarXp,
    handleNiveles
};
