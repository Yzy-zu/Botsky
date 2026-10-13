'use strict';

const { sendText, getGroupInfo } = require('../services/evolution');
const db = require('../services/db');
const { generateLoreChronicle } = require('../services/ai');
const logger = require('../services/logger');

/**
 * Resuelve el usuario objetivo a partir de quotes, menciones o argumentos
 */
function resolveTarget(messageData, parsed, groupData) {
    const msg = messageData?.message;
    let target = null;

    // 1. Participante citado resuelto por el normalizador
    if (messageData?.quotedParticipant) {
        target = messageData.quotedParticipant;
    }

    // 2. Buscar contextInfo en cualquier sub-objeto del mensaje
    let contextInfo = null;
    if (!target && msg && typeof msg === 'object') {
        for (const val of Object.values(msg)) {
            if (val && typeof val === 'object' && val.contextInfo) {
                contextInfo = val.contextInfo;
                break;
            }
        }
    }
    if (!target && !contextInfo && messageData?.contextInfo) {
        contextInfo = messageData.contextInfo;
    }

    // 3. Participante citado en contextInfo
    if (!target && contextInfo?.participant) {
        target = contextInfo.participant;
    }

    // 4. Menciones (@)
    if (!target && contextInfo?.mentionedJid && Array.isArray(contextInfo.mentionedJid) && contextInfo.mentionedJid.length > 0) {
        target = contextInfo.mentionedJid[0];
    }

    // 5. Buscar en argumentos
    if (!target && parsed?.args && parsed.args.length > 0) {
        for (const arg of parsed.args) {
            const clean = arg.replace(/[^0-9]/g, '');
            if (clean.length >= 10) {
                target = clean;
                break;
            }
        }
    }

    let targetPhone = null;
    let displayName = target ? target.replace(/@.*/, '') : null;

    if (target && groupData && groupData.participants) {
        const cleanTarget = target.replace(/@.*/, '');
        const member = groupData.participants.find(p =>
            (p.id && p.id.includes(cleanTarget)) ||
            (p.phoneNumber && p.phoneNumber.includes(cleanTarget))
        );
        if (member) {
            targetPhone = (member.phoneNumber || member.id || '').replace(/[^0-9]/g, '');
            displayName = (member.phoneNumber || member.id || cleanTarget).replace(/@.*/, '');
        }
    }

    const finalJid = targetPhone ? `${targetPhone}@s.whatsapp.net` : (target || null);
    return { targetJid: finalJid, displayName: displayName || 'usuario' };
}

async function handleLore(parsed = {}, from, messageData = {}) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    if (!from) return;
    const safeParsed = parsed || {};
    const isGroup = typeof from === 'string' && from.endsWith('@g.us');
    const authorName = messageData?.pushName || 'Alguien';
    const command = String(safeParsed.command || 'lore').toLowerCase();
    const args = safeParsed.args || [];

    let groupData = null;
    if (isGroup) {
        try {
            const res = await getGroupInfo(from);
            groupData = res.data[0] || res.data;
        } catch (e) {
            logger.warn(`No se pudo obtener groupInfo para lore: ${e.message}`);
        }
    }

    // ─── COMANDO: /@lores (Lista general de personajes) ───
    if (command === 'lores' || (command === 'lore' && args[0] === 'top') || (command === 'lore' && args[0] === 'lista')) {
        try {
            const targets = await db.getAllLoreTargets();
            if (!targets || targets.length === 0) {
                return sendText(from, '> 📜 Todavía no hay momentos canónicos registrados en el grupo.\nUsa `/@canon @usuario [evento]` para comenzar el lore.');
            }

            let msg = '📜 *━━━ REGISTRO DE LORE DEL GRUPO ━━━*\n\n';
            for (const t of targets) {
                const name = t.target_name || t.target_jid.split('@')[0];
                msg += `• *@${name}* → *${t.total_events}* momento(s) canónico(s)\n`;
            }
            msg += '\n💡 *Tip:* Escribe `/@lore @usuario` para ver su ficha o `/@lore historia @usuario` para que la IA narre su leyenda.';
            return sendText(from, msg);
        } catch (err) {
            logger.error('Error en /@lores:', err.message);
            return sendText(from, `> Error al consultar lores: ${err.message}`);
        }
    }

    // ─── COMANDO: /@canon @usuario [evento] ───
    if (command === 'canon') {
        const { targetJid, displayName } = resolveTarget(messageData, parsed, groupData);
        if (!targetJid) {
            return sendText(from, '> Menciona o cita a alguien con `/@canon @usuario [evento o chisme]`');
        }

        // Extraer el texto del evento (quitar menciones o números del target de los args)
        let eventText = args.filter(a => !a.includes(displayName) && !a.replace(/[^0-9]/g, '').includes(displayName)).join(' ').trim();
        if (!eventText && parsed.raw) {
            // Fallback: tomar todo lo que siga después de la mención
            const parts = parsed.raw.split(/\s+/);
            eventText = parts.slice(2).join(' ').trim();
        }

        if (!eventText || eventText.length < 3) {
            return sendText(from, '> Escribe qué hizo o qué pasó.\nEjemplo: `/@canon @usuario se cayó de la moto afuera del Oxxo`');
        }

        try {
            const added = await db.addLoreEvent(targetJid, displayName, eventText, authorName);
            const events = await db.getLoreEvents(targetJid);

            const reply = `📜 *¡Momento Canónico #${events.length} registrado para @${displayName}!*\n\n` +
                          `> "${eventText}"\n\n` +
                          `✍️ _Canonizado por ${authorName}_\n` +
                          `💡 _Usa \`/@lore historia @${displayName}\` para escuchar su leyenda redactada por IA._`;
            return sendText(from, reply);
        } catch (err) {
            logger.error('Error agregando canon:', err.message);
            return sendText(from, `> Error al guardar momento canónico: ${err.message}`);
        }
    }

    // ─── COMANDOS DE CONFIGURACIÓN DE FICHA: /@lore alias / rol / frase ───
    const subCmd = args[0]?.toLowerCase();
    if (['setalias', 'alias', 'setrol', 'rol', 'setfrase', 'frase'].includes(subCmd)) {
        const { targetJid, displayName } = resolveTarget(messageData, { args: args.slice(1) }, groupData);
        if (!targetJid) {
            return sendText(from, `> Menciona a quién quieres asignarle ${subCmd}: \`/@lore ${subCmd} @usuario [valor]\``);
        }

        const value = args.slice(2).join(' ').trim();
        if (!value) {
            return sendText(from, `> Escribe el valor: \`/@lore ${subCmd} @usuario [texto]\``);
        }

        try {
            if (subCmd.includes('alias')) await db.setLoreProfile(targetJid, value, null, null);
            else if (subCmd.includes('rol')) await db.setLoreProfile(targetJid, null, value, null);
            else if (subCmd.includes('frase')) await db.setLoreProfile(targetJid, null, null, value);

            return sendText(from, `> ✅ Ficha actualizada para @${displayName} (${subCmd}: "${value}")`);
        } catch (err) {
            return sendText(from, `> Error actualizando perfil: ${err.message}`);
        }
    }

    // ─── COMANDO: /@lore historia @usuario (o /@cronica @usuario) ───
    const wantsStory = command === 'cronica' || subCmd === 'historia' || subCmd === 'full' || subCmd === 'cronica';
    const { targetJid, displayName } = resolveTarget(messageData, parsed, groupData);

    if (!targetJid) {
        return sendText(from, '> Menciona a alguien con `/@lore @usuario` o usa `/@lores` para ver la lista.');
    }

    try {
        const events = await db.getLoreEvents(targetJid);
        const profile = await db.getLoreProfile(targetJid);
        const userData = await db.getOrCreateUser(targetJid);

        if (wantsStory) {
            if (!events || events.length === 0) {
                return sendText(from, `> @${displayName} todavía no tiene momentos canónicos registrados en el lore.\nRegístrale uno con \`/@canon @${displayName} [lo que hizo]\`.`);
            }

            await sendText(from, `> 📖 _Consultando los anales sagrados con IA para narrar la crónica de @${displayName}..._`);

            const story = await generateLoreChronicle(displayName, events, profile, authorName);
            const formatted = `📜 *━━━ CRÓNICA LEGENDARIA: @${displayName} ━━━*\n\n` +
                              `${story}\n\n` +
                              `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                              `⚔️ *Nivel en el chat:* ${userData.level} (${userData.xp} XP) | *Momentos:* ${events.length}`;
            return sendText(from, formatted);
        }

        // ─── MODO: Ficha de Personaje / Resumen ───
        let msg = `📜 *━━━ FICHA DE LORE: @${displayName} ━━━*\n`;
        msg += `🏆 *Nivel de Chat:* Nivel ${userData.level} (${userData.xp} XP)\n`;
        if (profile?.alias) msg += `🏷️ *Alias:* "${profile.alias}"\n`;
        if (profile?.role) msg += `⚔️ *Rol:* ${profile.role}\n`;
        if (profile?.phrase) msg += `💬 *Frase:* "${profile.phrase}"\n`;
        msg += `📖 *Momentos Canónicos:* ${events.length}\n\n`;

        if (events.length === 0) {
            msg += `_Este integrante aún no tiene historia registrada._\n`;
            msg += `👉 ¡Regístrale su primer evento con \`/@canon @${displayName} [chisme o anécdota]\`!`;
        } else {
            msg += `*Últimos Eventos Registrados:*\n`;
            const recent = events.slice(-4);
            for (let i = 0; i < recent.length; i++) {
                msg += `${i + 1}. "${recent[i].event_text}" _(por ${recent[i].author_name || 'el grupo'})_\n`;
            }
            if (events.length > 4) {
                msg += `_...y ${events.length - 4} evento(s) más._\n`;
            }
            msg += `\n✨ *Escribe \`/@lore historia @${displayName}\` para que la IA narre su crónica completa.*`;
        }

        return sendText(from, msg);

    } catch (err) {
        logger.error('Error en handleLore:', err.message);
        return sendText(from, `> Error al consultar lore: ${err.message}`);
    }
}

module.exports = { handleLore };
