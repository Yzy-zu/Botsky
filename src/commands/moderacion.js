'use strict';

const { sendText, getGroupInfo, updateParticipant, updateGroupSetting, normalizeJid } = require('../services/evolution');
const logger = require('../services/logger');

const BOT_NUMBER = (process.env.BOT_NUMBER || '5214437367565').replace(/[^0-9]/g, '');

/**
 * Verifica si un usuario es admin del grupo
 */
function isUserAdmin(groupData, participantJid) {
    if (!groupData || !groupData.participants) return false;

    const clean = (participantJid || '').replace(/@.*/, '');
    const member = groupData.participants.find(p =>
        (p.id && p.id.includes(clean)) ||
        (p.phoneNumber && p.phoneNumber.includes(clean))
    );
    return member && (member.admin === 'admin' || member.admin === 'superadmin');
}

/**
 * Verifica si el bot es admin del grupo
 */
function isBotAdmin(groupData) {
    if (!groupData || !groupData.participants) return false;
    const botMember = groupData.participants.find(p =>
        (p.phoneNumber && p.phoneNumber.includes(BOT_NUMBER)) ||
        (p.id && p.id.includes(BOT_NUMBER))
    );
    return !!(botMember && (botMember.admin === 'admin' || botMember.admin === 'superadmin'));
}

/**
 * Obtiene a quién va dirigido el comando (por quote, mención o texto manual)
 */
function getTarget(messageData, parsed) {
    const msg = messageData.message;
    // 1. Si respondió a un mensaje
    if (msg?.extendedTextMessage?.contextInfo?.participant) {
        return msg.extendedTextMessage.contextInfo.participant;
    }
    // 2. Si mencionó a alguien usando el arroba de WhatsApp
    if (msg?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
        return msg.extendedTextMessage.contextInfo.mentionedJid[0];
    }
    // 3. Si escribió el número a mano (ej. /@ ban 521... o /@ ban @521...)
    if (parsed && parsed.args && parsed.args.length > 0) {
        const number = parsed.args.join('').replace(/[^0-9]/g, '');
        if (number.length >= 10) {
            return number;
        }
    }
    return null;
}

function parseApiError(err) {
    const resData = err.response?.data;
    if (resData?.response?.message) {
        const msg = resData.response.message;
        return Array.isArray(msg) ? msg.join(', ') : String(msg);
    }
    if (resData?.message) {
        const msg = resData.message;
        return Array.isArray(msg) ? msg.join(', ') : String(msg);
    }
    return err.message;
}

async function handleModeracion(parsed, from, messageData) {
    // Solo en grupos
    if (!from.endsWith('@g.us')) {
        return sendText(from, '> solo funciona en grupos');
    }

    const sender = messageData.key.participant || messageData.participant;
    const command = parsed.command;

    let groupData = null;
    try {
        const res = await getGroupInfo(from);
        groupData = res.data[0] || res.data;
    } catch (e) {
        logger.error(`error obteniendo info del grupo: ${e.message}`);
    }

    // Verificar que el que ejecuta sea admin
    const isSenderAdmin = isUserAdmin(groupData, sender);
    const allowedAdmins = process.env.ALLOWED_NUMBERS_ADMIN ? process.env.ALLOWED_NUMBERS_ADMIN.split(',').map(n => n.trim()) : [];
    const isGlobalAdmin = allowedAdmins.some(num => sender && sender.includes(num));

    if (!isSenderAdmin && !isGlobalAdmin) {
        return sendText(from, '> solo admins pueden usar esto');
    }

    const botHasAdmin = isBotAdmin(groupData);

    // Mute y Unmute
    if (command === 'mute') {
        if (!botHasAdmin) {
            return sendText(from, '> el bot necesita ser administrador del grupo para silenciarlo');
        }
        try {
            await updateGroupSetting(from, 'announcement');
            return sendText(from, '> grupo silenciado');
        } catch (err) {
            logger.error(`mute fallo: ${parseApiError(err)}`);
            return sendText(from, `> error al silenciar grupo (${parseApiError(err)})`);
        }
    }

    if (command === 'unmute') {
        if (!botHasAdmin) {
            return sendText(from, '> el bot necesita ser administrador del grupo para desilenciarlo');
        }
        try {
            await updateGroupSetting(from, 'not_announcement');
            return sendText(from, '> grupo desilenciado');
        } catch (err) {
            logger.error(`unmute fallo: ${parseApiError(err)}`);
            return sendText(from, `> error al desilenciar grupo (${parseApiError(err)})`);
        }
    }

    let target = getTarget(messageData, parsed);
    if (!target) {
        return sendText(from, '> menciona al usuario con @');
    }

    let targetJid = target;
    let targetNum = null;
    let displayTarget = target.replace(/@.*/, '');

    if (groupData && groupData.participants) {
        const cleanTarget = target.replace(/@.*/, '').replace(/[^0-9]/g, '');
        const member = groupData.participants.find(p =>
            (p.id && p.id.includes(cleanTarget)) ||
            (p.phoneNumber && p.phoneNumber.includes(cleanTarget))
        );
        if (member) {
            // El identificador exacto que WhatsApp espera en el grupo es member.id (ej: 142022203670739@lid)
            targetJid = member.id || member.phoneNumber || target;
            targetNum = (member.phoneNumber || member.id || '').replace(/[^0-9]/g, '');
            displayTarget = (member.phoneNumber || member.id || cleanTarget).replace(/@.*/, '');
        }
    }
    if (!targetNum) {
        targetNum = target.replace(/[^0-9]/g, '');
    }
    if (!targetJid) {
        targetJid = targetNum;
    }

    const strikeKey = targetNum || target;

    try {
        switch (command) {
            case 'kick':
            case 'ban': {
                if (!botHasAdmin) {
                    return sendText(from, '> el bot necesita ser administrador del grupo para expulsar miembros');
                }
                try {
                    await updateParticipant(from, 'remove', [targetJid]);
                    await sendText(from, `> expulsado \`@${displayTarget}\``);
                } catch (err) {
                    const errorDetail = parseApiError(err);
                    logger.error(`expulsion fallo: ${errorDetail}`);
                    await sendText(from, `> no se pudo expulsar a \`@${displayTarget}\` (${errorDetail})`);
                }
                break;
            }

            case 'promote': {
                if (!botHasAdmin) {
                    return sendText(from, '> el bot necesita ser administrador del grupo para promover miembros');
                }
                try {
                    await updateParticipant(from, 'promote', [targetJid]);
                    await sendText(from, `> \`@${displayTarget}\` ahora es admin`);
                } catch (err) {
                    const errorDetail = parseApiError(err);
                    logger.error(`promote fallo: ${errorDetail}`);
                    await sendText(from, `> no se pudo promover a \`@${displayTarget}\` (${errorDetail})`);
                }
                break;
            }

            case 'demote': {
                if (!botHasAdmin) {
                    return sendText(from, '> el bot necesita ser administrador del grupo para degradar miembros');
                }
                try {
                    await updateParticipant(from, 'demote', [targetJid]);
                    await sendText(from, `> \`@${displayTarget}\` ya no es admin`);
                } catch (err) {
                    const errorDetail = parseApiError(err);
                    logger.error(`demote fallo: ${errorDetail}`);
                    await sendText(from, `> no se pudo degradar a \`@${displayTarget}\` (${errorDetail})`);
                }
                break;
            }

            case 'warn': {
                const db = require('../services/db');
                const strikes = await db.addStrike(strikeKey);

                if (strikes >= 3) {
                    if (!botHasAdmin) {
                        await sendText(from, `> \`@${displayTarget}\` llego al limite (3/3 advertencias). No pude expulsarlo porque el bot no es administrador del grupo.`);
                    } else {
                        try {
                            await updateParticipant(from, 'remove', [targetJid]);
                            await sendText(from, `> \`@${displayTarget}\` llego al limite (3/3 advertencias). expulsado`);
                        } catch (err) {
                            const errorDetail = parseApiError(err);
                            logger.error(`warn expulsion fallo: ${errorDetail}`);
                            await sendText(from, `> \`@${displayTarget}\` llego al limite (3/3), pero no se pudo expulsar (${errorDetail})`);
                        }
                    }
                } else {
                    await sendText(from, `> advertencia a \`@${displayTarget}\` (${strikes}/3)`);
                }
                break;
            }

            case 'unwarn': {
                const db2 = require('../services/db');
                const newStrikes = await db2.removeStrike(strikeKey);
                await sendText(from, `> advertencia quitada a \`@${displayTarget}\` (${newStrikes}/3)`);
                break;
            }
        }
    } catch (err) {
        const errorDetail = parseApiError(err);
        logger.error(`moderacion fallo inesperado: ${errorDetail}`);
        await sendText(from, `> error inesperado: ${errorDetail}`);
    }
}

module.exports = { handleModeracion };
