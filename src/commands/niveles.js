'use strict';

const { sendText } = require('../services/evolution');
const { getOrCreateUser, getTop } = require('../services/db');

async function handleRank(parsed, from, messageData) {
    const participant = messageData.key.participant || from;
    const user = await getOrCreateUser(participant);

    let rankName = 'gay';
    if (user.level >= 5) rankName = 'pasivo caliente';
    if (user.level >= 10) rankName = 'pasivo';
    if (user.level >= 20) rankName = 'activo';
    if (user.level >= 50) rankName = 'rey';

    const msg = `> perfil\n` +
        `usuario: \`@${participant.split('@')[0]}\`\n` +
        `nivel: \`${user.level}\` ${rankName}\n` +
        `xp: \`${user.xp}\`\n` +
        `advertencias: \`${user.strikes}/3\`\``;

    await sendText(from, msg);
}

async function handleTop(parsed, from, messageData) {
    const users = await getTop(5);

    if (users.length === 0) {
        return sendText(from, '> sin datos aun');
    }

    let msg = `> top 5 mas activos\n`;
    users.forEach((u, i) => {
        const medal = i === 0 ? '#1' : (i === 1 ? '#2' : (i === 2 ? '#3' : '#' + (i + 1)));
        msg += `${medal} \`@${u.jid.split('@')[0]}\` nivel ${u.level} (${u.xp} xp)\n`;
    });

    await sendText(from, msg);
}

module.exports = { handleRank, handleTop };
