'use strict';

const { sendText, getGroupInfo, getGroupInviteCode, updateParticipant } = require('../services/evolution');
const { isUserAdmin, isBotAdmin } = require('./moderacion');
const { getSenderJid } = require('../core/auth');
const db = require('../services/db');
const logger = require('../services/logger');
const { registerIntervalSeconds } = require('../services/scheduler');

// ─── Salas Activas en Memoria ──────────────────────────────────────────────────
// Clave: groupJid -> Objeto de sala
const activeRooms = new Map();
const creatingRooms = new Set();

/**
 * Verifica si hay una sala de Ruleta Rusa abierta en el grupo en fase de lobby.
 * Usado por message_normalizer para detectar frases de entrada instantáneas sin prefijo ni IA.
 */
function hasActiveRouletteLobby(groupJid) {
    const room = activeRooms.get(groupJid);
    return !!(room && room.state === 'lobby');
}

/**
 * Pausa asíncrona para generar suspenso visual en el chat.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Obtiene la información del grupo extrayendo el objeto de datos de forma segura,
 * ya sea que Evolution API lo devuelva como objeto plano o dentro de un array.
 */
async function getGroupMetadataSafe(groupJid) {
    try {
        const res = await getGroupInfo(groupJid);
        const data = res?.data || res;
        return Array.isArray(data) ? data[0] : data;
    } catch (e) {
        logger.warn(`[RULETA] Error al obtener info del grupo: ${e.message}`);
        return null;
    }
}

/**
 * Worker periódico que revisa exilios vencidos (20 minutos) y envía el enlace privado.
 */
async function checkRouletteExiles() {
    try {
        const pending = await db.getPendingRouletteExiles(Date.now());
        for (const exile of pending) {
            await db.completeRouletteExile(exile.id);
            const linkText = exile.invite_link || '(Pide a un administrador que te agregue)';
            const dmMessage =
                `🎮 *Ruleta Rusa*\n\n` +
                `Tu tiempo de sanción (20 minutos) ha concluido.\n` +
                `Puedes unirte nuevamente al grupo mediante el siguiente enlace:\n` +
                `🔗 ${linkText}`;

            try {
                await sendText(exile.user_jid, dmMessage);
                logger.info(`[RULETA] Enlace de reingreso enviado por privado a ${exile.user_jid}`);
            } catch (dmErr) {
                logger.error(`[RULETA] Error al enviar DM de reingreso a ${exile.user_jid}: ${dmErr.message}`);
            }
        }
    } catch (err) {
        logger.error('[RULETA] Error en worker de exiliados:', err);
    }
}

// Registrar worker de exilios cada 10 segundos
registerIntervalSeconds('roulette-exiles-worker', 10, checkRouletteExiles);

/**
 * Ejecuta la secuencia de disparos de la partida.
 */
async function runRouletteGame(groupJid) {
    const room = activeRooms.get(groupJid);
    if (!room || room.state !== 'lobby') return;

    room.state = 'playing';
    if (room.timer) {
        clearTimeout(room.timer);
        room.timer = null;
    }

    const playerListStr = room.players.map(p => p.name).join(', ');
    await sendText(groupJid,
        `🎰 *RULETA RUSA - COMIENZA LA PARTIDA*\n\n` +
        `Jugadores: ${playerListStr}\n` +
        `Bote en juego: ${room.pot} XP\n` +
        `Cargando 1 bala en el tambor de 6 recámaras y girando...`
    );

    // Bug #7 fix: el tambor se adapta al número de jugadores para garantizar
    // probabilidad uniforme (1/N por jugador). Con el tambor fijo de 6 recámaras,
    // si N no divide a 6, los primeros jugadores en el orden tenían más riesgo.
    // Ahora la posición fatal se sortea directamente entre [0, players.length).
    const fatalTurn = Math.floor(Math.random() * room.players.length);
    let victim = null;

    // Ronda de disparos en orden de jugadores
    for (let i = 0; i < room.players.length; i++) {
        const player = room.players[i];

        await sleep(2500);
        await sendText(groupJid, `🔫 Turno de *${player.name}*... Apuntando...`);
        await sleep(2500);

        if (i === fatalTurn) {
            await sendText(groupJid, `💥 *¡¡PUM!!* El arma disparó. *${player.name}* ha caído.`);
            victim = player;
            break;
        } else {
            await sendText(groupJid, `💨 *¡CLIC!* La recámara estaba vacía. *${player.name}* sobrevive.`);
        }
    }

    // Si por alguna anomalía nadie cayó, seleccionar el último jugador
    if (!victim) {
        victim = room.players[room.players.length - 1];
    }

    // ─── Verificación previa de permisos de admin del bot ───
    const groupData = await getGroupMetadataSafe(groupJid);
    if (!groupData || !isBotAdmin(groupData)) {
        for (const p of room.players) {
            await db.addXp(p.jid, room.bet);
        }
        activeRooms.delete(groupJid);
        return await sendText(groupJid,
            `🎰 *RULETA RUSA CANCELADA*\n\n` +
            `Botsky requiere permisos de *Administrador* en este grupo para poder sancionar/expulsar al perdedor.\n` +
            `Se ha devuelto la apuesta (${room.bet} XP) a todos los jugadores.`
        );
    }

    const victimIsAdmin = isUserAdmin(groupData, victim.jid);

    if (victimIsAdmin) {
        // Si era administrador: quitarle el admin, no expulsar
        try {
            await updateParticipant(groupJid, 'demote', [victim.jid]);
            await sendText(groupJid, `👑 *${victim.name}* era Administrador. Como sanción por caer en la ruleta, ha sido degradado de su cargo.`);
        } catch (err) {
            logger.error(`[RULETA] Error al degradar admin: ${err.message}`);
            await sendText(groupJid, `👑 *${victim.name}* era Administrador. (Botsky requiere permisos de administrador para degradarlo).`);
        }
    } else {
        // Si es usuario normal: expulsar por 20 minutos y agendar DM privado
        let inviteLink = '';
        try {
            const res = await getGroupInviteCode(groupJid);
            const code = res?.data?.inviteCode || res?.data?.code || (typeof res?.data === 'string' ? res.data : null);
            if (code) {
                inviteLink = code.startsWith('http') ? code : `https://chat.whatsapp.com/${code}`;
            }
        } catch (e) {
            logger.warn(`[RULETA] Error al obtener enlace de invitación: ${e.message}`);
        }

        try {
            await updateParticipant(groupJid, 'remove', [victim.jid]);
            const unbanAt = Date.now() + 20 * 60 * 1000;
            await db.addRouletteExile(groupJid, victim.jid, victim.name, unbanAt, inviteLink);
            await sendText(groupJid, `🚪 *${victim.name}* ha sido expulsado del grupo por 20 minutos.`);
        } catch (err) {
            logger.error(`[RULETA] Error al expulsar usuario: ${err.message}`);
            await sendText(groupJid, `🚪 *${victim.name}* debía ser expulsado. (Botsky requiere permisos de administrador para expulsar).`);
        }
    }

    // ─── Entrega del Bote a Sobrevivientes ───
    const survivors = room.players.filter(p => p.jid !== victim.jid);
    if (survivors.length === 1) {
        const winner = survivors[0];
        await db.addXp(winner.jid, room.pot);
        await sendText(groupJid,
            `🏆 *FIN DE LA PARTIDA*\n\n` +
            `Ganador: *${winner.name}*\n` +
            `Premio: *+${room.pot} XP*`
        );
    } else if (survivors.length > 1) {
        const share = Math.floor(room.pot / survivors.length);
        for (const s of survivors) {
            await db.addXp(s.jid, share);
        }
        const names = survivors.map(s => s.name).join(', ');
        await sendText(groupJid,
            `🏆 *FIN DE LA PARTIDA*\n\n` +
            `Sobrevivientes: *${names}*\n` +
            `Premio: *+${share} XP* para cada uno.`
        );
    }

    // Finalizar y limpiar sala
    activeRooms.delete(groupJid);
}

/**
 * Manejador principal del comando de Ruleta Rusa.
 */
async function handleRuleta(parsed = {}, from, messageData = {}) {
    const isGroup = typeof from === 'string' && from.endsWith('@g.us');
    if (!isGroup) {
        return await sendText(from, '> 🎰 La Ruleta Rusa solo se puede jugar en grupos.');
    }

    const participant = messageData?.key?.participant || messageData?.participant || from;
    const userName = messageData?.pushName || 'Jugador';
    const rawArgs = parsed.args || [];
    const flags = parsed.flags || {};

    const firstArg = (rawArgs[0] || '').toLowerCase();
    const actionFlag = (flags.accion || flags.action || '').toLowerCase();

    // ─── ACCIÓN: ENTRAR A SALA EXISTENTE ───
    if (actionFlag === 'entrar' || firstArg === 'entrar' || firstArg === 'entro' || firstArg === 'unirse') {
        const room = activeRooms.get(from);
        if (!room || room.state !== 'lobby') {
            return await sendText(from, '> No hay ninguna partida abierta en este grupo. Escribe `ruleta` para crear una.');
        }

        if (room.players.some(p => p.jid === participant) || room.joining?.has(participant)) {
            return await sendText(from, '> Ya estás en la partida.');
        }

        if (room.players.length + (room.joining?.size || 0) >= 6) {
            return await sendText(from, '> La sala está llena (máximo 6 jugadores).');
        }

        if (!room.joining) room.joining = new Set();
        room.joining.add(participant);

        try {
            const user = await db.getOrCreateUser(participant);
            if (user.xp < room.bet) {
                return await sendText(from, `> No tienes suficiente XP para entrar. Tienes ${user.xp} XP y la apuesta es de ${room.bet} XP.`);
            }

            if (room.players.length >= 6) {
                return await sendText(from, '> La sala está llena (máximo 6 jugadores).');
            }

            // Deducir apuesta y registrar
            await db.subtractXp(participant, room.bet);
            room.players.push({ jid: participant, name: userName });
            room.pot += room.bet;

            // Progresión orgánica: participar en la ruleta suma +1 de afinidad
            const senderJid = getSenderJid(from, messageData);
            const altJid = (senderJid && participant && senderJid !== participant) ? participant : null;
            db.adjustUserAffinity(senderJid || participant, userName, 1, 'Participó en la ruleta rusa', altJid).catch(() => {});

            const playersList = room.players.map(p => `• ${p.name}`).join('\n');
            await sendText(from,
                `🎰 *RULETA RUSA*\n` +
                `*${userName}* se ha unido a la partida.\n\n` +
                `Jugadores (${room.players.length}/6):\n` +
                `${playersList}\n\n` +
                `Bote acumulado: ${room.pot} XP`
            );

            // Si la sala se llenó al máximo (6), iniciar de inmediato
            if (room.players.length === 6) {
                await runRouletteGame(from);
            }
            return;
        } finally {
            room.joining?.delete(participant);
        }
    }

    // ─── ACCIÓN: INICIAR PARTIDA MANUALMENTE (POR EL CREADOR) ───
    if (actionFlag === 'iniciar' || firstArg === 'iniciar' || firstArg === 'start' || firstArg === 'dale') {
        const room = activeRooms.get(from);
        if (!room || room.state !== 'lobby') {
            return await sendText(from, '> No hay ninguna partida esperando para iniciar.');
        }

        if (room.hostJid !== participant) {
            return await sendText(from, '> Solo el creador de la sala puede iniciar la partida anticipadamente.');
        }

        if (room.players.length < 2) {
            return await sendText(from, '> Se necesitan al menos 2 jugadores para jugar a la Ruleta Rusa.');
        }

        const groupData = await getGroupMetadataSafe(from);
        if (!groupData || !isBotAdmin(groupData)) {
            for (const p of room.players) {
                await db.addXp(p.jid, room.bet);
            }
            activeRooms.delete(from);
            return await sendText(from,
                `> 🎰 Botsky ya no tiene permisos de *Administrador* en este grupo para expulsar al perdedor. La partida se canceló y se devolvió la apuesta a todos.`
            );
        }

        await runRouletteGame(from);
        return;
    }

    // ─── ACCIÓN: CANCELAR PARTIDA ───
    if (actionFlag === 'cancelar' || firstArg === 'cancelar' || firstArg === 'salir') {
        const room = activeRooms.get(from);
        if (!room || room.state !== 'lobby') {
            return await sendText(from, '> No hay ninguna partida activa para cancelar.');
        }

        if (room.hostJid !== participant) {
            return await sendText(from, '> Solo el creador de la sala puede cancelar la partida.');
        }

        if (room.timer) clearTimeout(room.timer);

        // Reembolsar apuesta a todos los inscritos
        for (const p of room.players) {
            await db.addXp(p.jid, room.bet);
        }

        activeRooms.delete(from);
        return await sendText(from, `🎰 *RULETA RUSA*\nPartida cancelada por el creador. Se ha devuelto la apuesta (${room.bet} XP) a todos los jugadores.`);
    }

    // ─── ACCIÓN: CREAR NUEVA SALA ───
    if (activeRooms.has(from) || creatingRooms.has(from)) {
        const current = activeRooms.get(from);
        if (current && current.state === 'lobby') {
            return await sendText(from,
                `> Ya hay una partida abierta en este grupo.\n` +
                `Escribe "yo juego", "yo le entro" o "yo también" para unirte.`
            );
        } else {
            return await sendText(from, `> Ya hay una partida en curso en este grupo. Espera a que termine.`);
        }
    }

    creatingRooms.add(from);
    try {
        // 1. Validar que Botsky sea Administrador en el grupo antes de crear la sala
        const groupData = await getGroupMetadataSafe(from);
        if (!groupData || !isBotAdmin(groupData)) {
            return await sendText(from,
                `> 🎰 Botsky requiere permisos de *Administrador* en este grupo para poder iniciar la Ruleta Rusa (y expulsar a quien pierda).\n` +
                `Por favor dale admin al bot antes de jugar.`
            );
        }

        // Determinar cantidad de apuesta
        let bet = 50; // Apuesta por defecto
        const parsedBet = parseInt(flags.apuesta || rawArgs[0], 10);
        if (!isNaN(parsedBet) && parsedBet > 0) {
            bet = parsedBet;
        }

        const hostUser = await db.getOrCreateUser(participant);
        if (hostUser.xp < bet) {
            return await sendText(from, `> No tienes suficiente XP para iniciar la partida. Tienes ${hostUser.xp} XP y la apuesta es de ${bet} XP.`);
        }

        // Deducir apuesta del creador
        await db.subtractXp(participant, bet);

        // Crear sala
        const room = {
            groupJid: from,
            hostJid: participant,
            hostName: userName,
            bet,
            pot: bet,
            players: [
                { jid: participant, name: userName }
            ],
            joining: new Set(),
            state: 'lobby',
            timer: null,
            createdAt: Date.now()
        };

        // Progresión orgánica: armar la reta de ruleta suma +1 de afinidad
        const hostSenderJid = getSenderJid(from, messageData);
        const hostAltJid = (hostSenderJid && participant && hostSenderJid !== participant) ? participant : null;
        db.adjustUserAffinity(hostSenderJid || participant, userName, 1, 'Armó una partida de ruleta rusa', hostAltJid).catch(() => {});

        // Temporizador de 60 segundos
        room.timer = setTimeout(async () => {
            const active = activeRooms.get(from);
            if (!active || active.state !== 'lobby') return;

            if (active.players.length < 2) {
                // Cancelar y devolver apuesta
                await db.addXp(active.hostJid, active.bet);
                activeRooms.delete(from);
                await sendText(from,
                    `🎰 *RULETA RUSA*\n` +
                    `Partida cancelada por falta de jugadores (mínimo 2).\n` +
                    `Se han devuelto tus ${active.bet} XP a tu cuenta.`
                );
            } else {
                // Iniciar automáticamente
                await runRouletteGame(from);
            }
        }, 60000);

        activeRooms.set(from, room);

        // Anuncio del lobby sin comandos de entrar, con frases naturales como solicitó el usuario
        return await sendText(from,
            `🎰 *RULETA RUSA*\n\n` +
            `Apuesta: ${bet} XP\n` +
            `Bote actual: ${bet} XP\n` +
            `Jugadores (1/6):\n` +
            `• ${userName} (Creador)\n\n` +
            `Escribe *"yo juego"*, *"yo le entro"* o *"yo también"* para unirte.\n` +
            `El creador puede escribir *"iniciar"* para empezar ya.\n` +
            `_(Inicia automáticamente en 60s)_`
        );
    } finally {
        creatingRooms.delete(from);
    }
}

module.exports = {
    handleRuleta,
    hasActiveRouletteLobby,
    activeRooms,
    checkRouletteExiles
};
