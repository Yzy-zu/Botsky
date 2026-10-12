'use strict';

const { sendText } = require('../services/evolution');
const db = require('../services/db');
const logger = require('../services/logger');
const { getSenderJid } = require('../core/auth');

// ─── Baraja y Cartas con Emojis Unicode ─────────────────────────────────────────

const SUITS = [
    { name: 'spades', symbol: '♠️', glyphs: ['🂡', '🂢', '🂣', '🂤', '🂥', '🂦', '🂧', '🂨', '🂩', '🂪', '🂫', '🂭', '🂮'] },
    { name: 'hearts', symbol: '♥️', glyphs: ['🂱', '🂲', '🂳', '🂴', '🂵', '🂶', '🂷', '🂸', '🂹', '🂺', '🂻', '🂽', '🂾'] },
    { name: 'diamonds', symbol: '♦️', glyphs: ['🃁', '🃂', '🃃', '🃄', '🃅', '🃆', '🃇', '🃈', '🃉', '🃊', '🃋', '🃍', '🃎'] },
    { name: 'clubs', symbol: '♣️', glyphs: ['🃑', '🃒', '🃓', '🃔', '🃕', '🃖', '🃗', '🃘', '🃙', '🃚', '🃛', '🃝', '🃞'] }
];

const RANKS = [
    { rank: 'A', val: 11 },
    { rank: '2', val: 2 },
    { rank: '3', val: 3 },
    { rank: '4', val: 4 },
    { rank: '5', val: 5 },
    { rank: '6', val: 6 },
    { rank: '7', val: 7 },
    { rank: '8', val: 8 },
    { rank: '9', val: 9 },
    { rank: '10', val: 10 },
    { rank: 'J', val: 10 },
    { rank: 'Q', val: 10 },
    { rank: 'K', val: 10 }
];

/**
 * Crea una baraja completa de 52 cartas mezclada aleatoriamente (Fisher-Yates).
 * @param {number} decksCount Número de barajas combinadas (default 1)
 */
function createDeck(decksCount = 1) {
    const deck = [];
    for (let d = 0; d < decksCount; d++) {
        for (const suit of SUITS) {
            for (let i = 0; i < RANKS.length; i++) {
                deck.push({
                    rank: RANKS[i].rank,
                    val: RANKS[i].val,
                    suit: suit.symbol,
                    glyph: suit.glyphs[i]
                });
            }
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

/**
 * Formatea una carta individual con su glifo de naipe y su símbolo emoji.
 */
function formatCard(card) {
    if (!card) return '[ 🂠 ??? ]';
    return `[ ${card.glyph} ${card.rank}${card.suit} ]`;
}

/**
 * Formatea un conjunto de cartas.
 */
function formatHand(hand) {
    if (!hand || hand.length === 0) return '[ vacía ]';
    return hand.map(formatCard).join(' ');
}

/**
 * Calcula el valor óptimo de una mano de Blackjack considerando Ases como 11 u 1.
 */
function calculateScore(hand) {
    let score = 0;
    let aces = 0;
    for (const card of hand) {
        score += card.val;
        if (card.rank === 'A') aces++;
    }
    while (score > 21 && aces > 0) {
        score -= 10;
        aces--;
    }
    return score;
}

/**
 * Determina si la mano inicial es un Blackjack Natural (21 con 2 cartas).
 */
function isNaturalBlackjack(hand) {
    return hand.length === 2 && calculateScore(hand) === 21;
}

// ─── Estado de Partidas en Memoria ─────────────────────────────────────────────
// 1. Partidas individuales (1v1 rápidas): Clave `${from}_${userJid}`
const activeGames = new Map();
const startingGames = new Set();
// 2. Mesas Multijugador Compartidas: Clave `groupJid`
const activeTables = new Map();

const GAME_TIMEOUT_MS = 60 * 1000;  // 60s turno individual
const TABLE_LOBBY_MS = 35 * 1000;   // 35s lobby de mesa compartida
const TABLE_TURN_MS = 30 * 1000;    // 30s por turno en mesa compartida
const MIN_BET = 20;
const MAX_BET = 1000;
const DEFAULT_BET = 50;
const MAX_TABLE_PLAYERS = 6;

/**
 * Verifica si el usuario tiene una partida individual activa de Blackjack.
 */
function hasActiveBlackjackGame(from, userJid) {
    const key = `${from}_${userJid}`;
    return activeGames.has(key);
}

/**
 * Verifica si hay una mesa de Blackjack en lobby en el grupo.
 */
function hasActiveBlackjackTableLobby(groupJid) {
    const table = activeTables.get(groupJid);
    return !!(table && table.state === 'lobby');
}

/**
 * Verifica si hay una mesa de Blackjack en juego activo en el grupo.
 */
function hasActiveBlackjackTablePlaying(groupJid) {
    const table = activeTables.get(groupJid);
    return !!(table && table.state === 'playing');
}

/**
 * Devuelve el JID del jugador al que le toca el turno en la mesa actual.
 */
function getCurrentTableTurnPlayerJid(groupJid) {
    const table = activeTables.get(groupJid);
    if (!table || table.state !== 'playing') return null;
    return table.players[table.currentTurnIndex]?.jid || null;
}

function clearGameTimer(game) {
    if (game && game.timer) {
        clearTimeout(game.timer);
        game.timer = null;
    }
}

// ═════════════════════════════════════════════════════════════════════════════════
// ─── LÓGICA DE MESA MULTIJUGADOR COMPARTIDA ────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════════

/**
 * Inicia la ronda de juego en la mesa compartida repartiendo cartas a todos.
 */
async function startMesaGame(groupJid) {
    const table = activeTables.get(groupJid);
    if (!table || table.state !== 'lobby') return;

    clearGameTimer(table);
    table.state = 'playing';

    // Usar 2 barajas para que alcancen holgadamente para hasta 6 jugadores + dealer
    table.deck = createDeck(2);

    // Repartir 2 cartas a cada jugador sentado
    for (const player of table.players) {
        player.hand = [table.deck.pop(), table.deck.pop()];
        if (isNaturalBlackjack(player.hand)) {
            player.status = 'blackjack';
        } else {
            player.status = 'playing';
        }
    }

    // Repartir 2 cartas a Botsky (Dealer)
    table.dealerHand = [table.deck.pop(), table.deck.pop()];
    const dealerVisible = table.dealerHand[0];

    // Preparar tablero visual inicial de la mesa
    const playerRows = table.players.map((p, i) => {
        const score = calculateScore(p.hand);
        const tag = p.status === 'blackjack' ? ' 💥 *(¡BLACKJACK!)*' : '';
        return `${i + 1}. *${p.name}:* ${formatHand(p.hand)} (*${score}* pts)${tag}`;
    }).join('\n');

    await sendText(groupJid,
        `🎰 *MESA DE CASINO - BLACKJACK 21* 🎰\n` +
        `Apuesta por cabeza: *${table.bet} XP*\n\n` +
        `🤖 *Mano de Botsky (Dealer):*\n` +
        `${formatCard(dealerVisible)} [ 🂠 ??? ] (*${dealerVisible.val}* pts visibles)\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👥 *JUGADORES EN LA MESA:*\n` +
        `${playerRows}\n` +
        `━━━━━━━━━━━━━━━━━━━━`
    );

    // Si el crupier tiene Blackjack natural de mano, la mesa termina de inmediato
    if (isNaturalBlackjack(table.dealerHand)) {
        await sendText(groupJid,
            `💀 *¡BOTSKY SACÓ BLACKJACK NATURAL DE MANO!* [ 🂠 ??? ] revelada.`
        );
        return await resolveMesaShowdown(groupJid);
    }

    // Avanzar al primer jugador que deba jugar (que no tenga ya Blackjack)
    table.currentTurnIndex = 0;
    await advanceMesaTurn(groupJid);
}

/**
 * Avanza el turno al siguiente jugador activo en la mesa.
 */
async function advanceMesaTurn(groupJid) {
    const table = activeTables.get(groupJid);
    if (!table || table.state !== 'playing') return;

    clearGameTimer(table);

    // Buscar el siguiente jugador con status === 'playing'
    while (table.currentTurnIndex < table.players.length) {
        const p = table.players[table.currentTurnIndex];
        if (p.status === 'playing') {
            break;
        }
        table.currentTurnIndex++;
    }

    // Si ya no quedan jugadores jugando, todos terminaron: pasar al dealer
    if (table.currentTurnIndex >= table.players.length) {
        return await resolveMesaShowdown(groupJid);
    }

    const currentPlayer = table.players[table.currentTurnIndex];
    const score = calculateScore(currentPlayer.hand);

    // Iniciar temporizador de 30s por turno
    table.timer = setTimeout(() => {
        logger.info(`[MESA-21] Timeout para jugador ${currentPlayer.name} en ${groupJid}. Auto-plantando.`);
        sendText(groupJid,
            `⏰ *Se le durmió el gallo a ${currentPlayer.name}.* Botsky lo planta en automático con sus *${score}* puntos.`
        ).catch(() => {});
        currentPlayer.status = 'stood';
        table.currentTurnIndex++;
        advanceMesaTurn(groupJid).catch((e) => logger.error(`[MESA-21] Error en advance: ${e.message}`));
    }, TABLE_TURN_MS);

    await sendText(groupJid,
        `👉 *Turno de ${currentPlayer.name}:*\n` +
        `Tu mano: ${formatHand(currentPlayer.hand)} (*${score}* pts)\n` +
        `⏰ Tienes *30 segundos*:\n` +
        `Escribe *"pedir"*, *"plantar"* o *"doblar"*.`
    );
}

/**
 * Resuelve el showdown final de la mesa multijugador contra el crupier.
 */
async function resolveMesaShowdown(groupJid) {
    const table = activeTables.get(groupJid);
    if (!table) return;

    clearGameTimer(table);
    if (table.joining) {
        table.joining.clear();
    }
    activeTables.delete(groupJid);

    // El crupier juega si al menos un jugador sigue vivo (stood o blackjack)
    const anyAlive = table.players.some(p => p.status === 'stood' || p.status === 'blackjack');
    let dealerScore = calculateScore(table.dealerHand);

    if (anyAlive) {
        while (dealerScore < 17 && table.deck.length > 0) {
            table.dealerHand.push(table.deck.pop());
            dealerScore = calculateScore(table.dealerHand);
        }
    }

    const dealerBust = dealerScore > 21;
    const dealerBJ = isNaturalBlackjack(table.dealerHand);

    // Calcular balances y repartir premios en SQLite
    const summaryLines = [];

    for (const p of table.players) {
        const pScore = calculateScore(p.hand);

        if (p.status === 'busted') {
            summaryLines.push(`❌ *${p.name}:* ${pScore} pts (Se pasó) ➔ Perdió *${p.bet} XP*`);
        } else if (p.status === 'blackjack') {
            if (dealerBJ) {
                await db.addXp(p.jid, p.bet);
                summaryLines.push(`🤝 *${p.name}:* 21 Natural ➔ Empate con Dealer, recupera *${p.bet} XP*`);
            } else {
                const totalWon = Math.floor(p.bet * 2.5);
                await db.addXp(p.jid, totalWon);
                summaryLines.push(`👑 *${p.name}:* ¡BLACKJACK! ➔ Cobra *+${totalWon} XP* (ganancia: *+${totalWon - p.bet} XP*)`);
            }
        } else if (dealerBust) {
            const totalWon = p.bet * 2;
            await db.addXp(p.jid, totalWon);
            summaryLines.push(`🏆 *${p.name}:* ${pScore} pts vs Dealer Bust ➔ Cobra *+${totalWon} XP* (ganancia: *+${p.bet} XP*)`);
        } else if (pScore > dealerScore) {
            const totalWon = p.bet * 2;
            await db.addXp(p.jid, totalWon);
            summaryLines.push(`🏆 *${p.name}:* ${pScore} pts vs ${dealerScore} pts ➔ Cobra *+${totalWon} XP* (ganancia: *+${p.bet} XP*)`);
        } else if (pScore === dealerScore) {
            await db.addXp(p.jid, p.bet);
            summaryLines.push(`🤝 *${p.name}:* ${pScore} pts vs ${dealerScore} pts ➔ Empate, recupera *${p.bet} XP*`);
        } else {
            summaryLines.push(`💀 *${p.name}:* ${pScore} pts vs ${dealerScore} pts ➔ Perdió *${p.bet} XP*`);
        }
    }

    const bustTag = dealerBust ? ' 💥 *(¡BOTSKY SE PASÓ!)*' : '';

    return await sendText(groupJid,
        `🎰 *MESA DE CASINO BOTSKY - RESULTADOS* 🎰\n\n` +
        `🤖 *Mano Final de Botsky (Dealer):*\n` +
        `${formatHand(table.dealerHand)}\n` +
        `*Total Dealer:* *${dealerScore}* pts${bustTag}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *BALANCE DE LA MESA:*\n` +
        `${summaryLines.join('\n')}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `_¿Otra ronda? Escribe *botsky mesa 21 [apuesta]*._`
    );
}

/**
 * Maneja las acciones de turno dentro de una mesa compartida.
 */
async function handleTablePlayerAction(groupJid, userJid, userName, action) {
    const table = activeTables.get(groupJid);
    if (!table || table.state !== 'playing') return false;

    const currentPlayer = table.players[table.currentTurnIndex];
    if (!currentPlayer) return false;

    // Si otro jugador sentado intenta actuar fuera de turno
    if (currentPlayer.jid !== userJid) {
        const isSeated = table.players.some(p => p.jid === userJid);
        if (isSeated) {
            await sendText(groupJid,
                `✋ *Aguanta tus carnes, ${userName}.* Ahorita es el turno de *${currentPlayer.name}*.`
            );
            return true;
        }
        return false;
    }

    clearGameTimer(table);

    // ── ACCIÓN EN MESA: PEDIR ──
    if (action === 'pedir') {
        const card = table.deck.pop();
        currentPlayer.hand.push(card);
        const score = calculateScore(currentPlayer.hand);

        if (score > 21) {
            currentPlayer.status = 'busted';
            await sendText(groupJid,
                `💥 *¡${userName} sacó ${formatCard(card)} y se pasó con ${score} puntos!* Queda fuera de la ronda.`
            );
            table.currentTurnIndex++;
            await advanceMesaTurn(groupJid);
            return true;
        }

        if (score === 21) {
            currentPlayer.status = 'stood';
            await sendText(groupJid,
                `🎯 *¡21 PUNTOS!* ${userName} sacó ${formatCard(card)} y se planta en automático.`
            );
            table.currentTurnIndex++;
            await advanceMesaTurn(groupJid);
            return true;
        }

        // Sigue jugando: reiniciar temporizador de 30s
        table.timer = setTimeout(() => {
            sendText(groupJid,
                `⏰ *Tiempo agotado para ${userName}.* Se planta con *${score}* pts.`
            ).catch(() => {});
            currentPlayer.status = 'stood';
            table.currentTurnIndex++;
            advanceMesaTurn(groupJid).catch(() => {});
        }, TABLE_TURN_MS);

        await sendText(groupJid,
            `🃏 *${userName}* sacó ${formatCard(card)} (Total: *${score}* pts).\n` +
            `👉 ¿*"pedir"* o *"plantar"*? (30s)`
        );
        return true;
    }

    // ── ACCIÓN EN MESA: PLANTAR ──
    if (action === 'plantar') {
        currentPlayer.status = 'stood';
        const score = calculateScore(currentPlayer.hand);
        await sendText(groupJid,
            `🛑 *${userName}* se planta con *${score}* puntos.`
        );
        table.currentTurnIndex++;
        await advanceMesaTurn(groupJid);
        return true;
    }

    // ── ACCIÓN EN MESA: DOBLAR ──
    if (action === 'doblar') {
        if (currentPlayer.hand.length !== 2) {
            await sendText(groupJid,
                `⚠️ *No puedes doblar:* Solo se permite con tus 2 cartas iniciales.`
            );
            return true;
        }

        const user = await db.getOrCreateUser(userJid);
        if (user.xp < currentPlayer.bet) {
            await sendText(groupJid,
                `⚠️ *Sin fondos para doblar:* Necesitas *${currentPlayer.bet} XP* adicionales. Solo puedes *pedir* o *plantar*.`
            );
            return true;
        }

        await db.subtractXp(userJid, currentPlayer.bet);
        currentPlayer.bet *= 2;

        const card = table.deck.pop();
        currentPlayer.hand.push(card);
        const score = calculateScore(currentPlayer.hand);

        if (score > 21) {
            currentPlayer.status = 'busted';
            await sendText(groupJid,
                `💥 *¡${userName} dobló a ${currentPlayer.bet} XP y se fue de hocico con ${score} puntos!* (${formatCard(card)}). Fuera.`
            );
        } else {
            currentPlayer.status = 'stood';
            await sendText(groupJid,
                `💰 *${userName} dobló a ${currentPlayer.bet} XP* y recibió ${formatCard(card)} (*${score}* pts). Se planta.`
            );
        }

        table.currentTurnIndex++;
        await advanceMesaTurn(groupJid);
        return true;
    }

    return false;
}

// ═════════════════════════════════════════════════════════════════════════════════
// ─── LÓGICA DE PARTIDA INDIVIDUAL RÁPIDA (1v1) ─────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════════

async function resolveDealerTurn(game, key) {
    clearGameTimer(game);
    activeGames.delete(key);

    const { from, userJid, userName, bet, deck, playerHand, dealerHand } = game;
    const playerScore = calculateScore(playerHand);

    let dealerScore = calculateScore(dealerHand);
    while (dealerScore < 17 && deck.length > 0) {
        dealerHand.push(deck.pop());
        dealerScore = calculateScore(dealerHand);
    }

    const playerHandStr = formatHand(playerHand);
    const dealerHandStr = formatHand(dealerHand);

    if (dealerScore > 21) {
        const winAmount = bet * 2;
        await db.addXp(userJid, winAmount);
        return await sendText(from,
            `🎰 *CASINO BOTSKY - BLACKJACK 21* 🎰\n\n` +
            `👤 *Tu Mano (${userName}):*\n` +
            `${playerHandStr}\n` +
            `*Puntos:* *${playerScore}*\n\n` +
            `🤖 *Mano de Botsky (Dealer):*\n` +
            `${dealerHandStr}\n` +
            `*Puntos:* *${dealerScore}* 💥 *(¡BOTSKY SE PASÓ!)*\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🎉 *¡BOTSKY SE VOLÓ CON ${dealerScore} PUNTOS!*\n` +
            `La casa pierde. ¡Cobraste *+${winAmount} XP* (ganancia limpia: *+${bet} XP*)!`
        );
    }

    if (playerScore > dealerScore) {
        const winAmount = bet * 2;
        await db.addXp(userJid, winAmount);
        return await sendText(from,
            `🎰 *CASINO BOTSKY - BLACKJACK 21* 🎰\n\n` +
            `👤 *Tu Mano (${userName}):*\n` +
            `${playerHandStr}\n` +
            `*Puntos:* *${playerScore}*\n\n` +
            `🤖 *Mano de Botsky (Dealer):*\n` +
            `${dealerHandStr}\n` +
            `*Puntos:* *${dealerScore}*\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🏆 *¡LE GANASTE A LA CASA, PERRO!*\n` +
            `Tus *${playerScore}* vencieron a los *${dealerScore}* de Botsky.\n` +
            `Cobras *+${winAmount} XP* (ganancia limpia: *+${bet} XP*).`
        );
    }

    if (dealerScore > playerScore) {
        return await sendText(from,
            `🎰 *CASINO BOTSKY - BLACKJACK 21* 🎰\n\n` +
            `👤 *Tu Mano (${userName}):*\n` +
            `${playerHandStr}\n` +
            `*Puntos:* *${playerScore}*\n\n` +
            `🤖 *Mano de Botsky (Dealer):*\n` +
            `${dealerHandStr}\n` +
            `*Puntos:* *${dealerScore}*\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💀 *¡LA CASA GANA!*\n` +
            `Botsky sumó *${dealerScore}* contra tus *${playerScore}*.\n` +
            `Perdiste tus *${bet} XP*. Gracias por patrocinar mis vicios, compa.`
        );
    }

    await db.addXp(userJid, bet);
    return await sendText(from,
        `🎰 *CASINO BOTSKY - BLACKJACK 21* 🎰\n\n` +
        `👤 *Tu Mano (${userName}):*\n` +
        `${playerHandStr}\n` +
        `*Puntos:* *${playerScore}*\n\n` +
        `🤖 *Mano de Botsky (Dealer):*\n` +
        `${dealerHandStr}\n` +
        `*Puntos:* *${dealerScore}*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🤝 *¡EMPATE TÉCNICO (PUSH)!*\n` +
        `Ambos sumaron *${playerScore}* puntos.\n` +
        `Se te devuelve tu apuesta completa de *${bet} XP*.`
    );
}

// ═════════════════════════════════════════════════════════════════════════════════
// ─── CONTROLADOR PRINCIPAL DEL COMANDO BLACKJACK ───────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════════

async function handleBlackjack(parsed = {}, from, messageData = {}) {
    const userJid = getSenderJid(from, messageData) || messageData?.key?.participant || messageData?.participant || from;
    const userName = messageData?.pushName || 'Jugador';
    const isGroup = typeof from === 'string' && from.endsWith('@g.us');

    // Desarmar argumentos
    let action = 'jugar';
    let requestedBet = DEFAULT_BET;
    let isMesa = false;

    if (parsed && typeof parsed === 'object') {
        if (parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)) {
            if (parsed.args.accion) action = String(parsed.args.accion).toLowerCase();
            if (parsed.args.apuesta) requestedBet = parseInt(parsed.args.apuesta, 10);
            if (action.includes('mesa') || parsed.args.mesa) isMesa = true;
        } else if (Array.isArray(parsed.args) && parsed.args.length > 0) {
            const rawArgs = parsed.args.map(a => String(a).toLowerCase());

            if (rawArgs.includes('mesa')) {
                isMesa = true;
                action = 'mesa';
                const num = rawArgs.find(a => !isNaN(parseInt(a, 10)));
                if (num) requestedBet = parseInt(num, 10);
            } else if (['entrar', 'join', 'entro', 'juego'].includes(rawArgs[0])) {
                action = 'entrar';
            } else if (['iniciar', 'start', 'dale', 'arranca'].includes(rawArgs[0])) {
                action = 'iniciar';
            } else if (['cancelar', 'cancel'].includes(rawArgs[0])) {
                action = 'cancelar';
            } else if (['pedir', 'otra', 'carta', 'hit', 'dame'].includes(rawArgs[0])) {
                action = 'pedir';
            } else if (['plantar', 'planto', 'quedo', 'stand', 'paso', 'basta', 'mequedo'].includes(rawArgs[0])) {
                action = 'plantar';
            } else if (['doblar', 'doblo', 'double'].includes(rawArgs[0])) {
                action = 'doblar';
            } else if (!isNaN(parseInt(rawArgs[0], 10))) {
                action = 'jugar';
                requestedBet = parseInt(rawArgs[0], 10);
            }
        }
    }

    // ── PRIORIDAD 1: ACCIÓN EN MESA COMPARTIDA EN JUEGO (PEDIR / PLANTAR / DOBLAR) ──
    if (['pedir', 'plantar', 'doblar'].includes(action) && hasActiveBlackjackTablePlaying(from)) {
        const handledInTable = await handleTablePlayerAction(from, userJid, userName, action);
        if (handledInTable) return;
    }

    // ── GESTIÓN DE MESA COMPARTIDA (LOBBY / ACCIONES) ──────────────────────────
    if (isMesa || ['entrar', 'iniciar', 'cancelar'].includes(action)) {
        if (!isGroup) {
            return await sendText(from,
                `⚠️ *La Mesa Compartida es solo para grupos.*\n` +
                `En privado puedes jugar tu partida 1v1 con: *botsky 21 [apuesta]*.`
            );
        }

        const table = activeTables.get(from);

        // Sub-acción: ENTRAR a la mesa
        if (action === 'entrar') {
            if (!table || table.state !== 'lobby') {
                if (table && table.joining) table.joining.delete(userJid);
                return await sendText(from,
                    `⚠️ *No hay ninguna mesa abierta esperando jugadores.*\n` +
                    `Abre una con: *botsky mesa 21 [apuesta]* (ej: *botsky mesa 21 100*).`
                );
            }
            
            table.joining = table.joining || new Set();
            if (table.joining.has(userJid)) {
                return sendText(from, `⏳ *${userName}*, ya estás en proceso de unirte a la mesa. Espera tu turno.`);
            }
            
            try {
                table.joining.add(userJid);
                
                if (table.players.some(p => p.jid === userJid)) {
                    return await sendText(from,
                        `✋ *Ya estás sentado en la mesa, ${userName}.* Espera a que comience la partida.`
                    );
                }
                
                if (table.players.length >= MAX_TABLE_PLAYERS) {
                    return await sendText(from,
                        `🚫 *La mesa está llena (6/6).* Comenzando la partida...`
                    );
                }

                const user = await db.getOrCreateUser(userJid);
                if (user.xp < table.bet) {
                    return await sendText(from,
                        `❌ *No traes feria suficiente, ${userName}.*\n` +
                        `La entrada cuesta *${table.bet} XP* y tu saldo es de *${user.xp} XP*.`
                    );
                }

                await db.subtractXp(userJid, table.bet);
                table.players.push({
                    jid: userJid,
                    name: userName,
                    hand: [],
                    bet: table.bet,
                    status: 'waiting'
                });

                await sendText(from,
                    `✅ *${userName}* se sentó a la mesa (*${table.players.length}/${MAX_TABLE_PLAYERS}* jugadores).\n` +
                    `Bote acumulado: *${table.players.length * table.bet} XP*.`
                );
            } finally {
                table.joining.delete(userJid);
            }

            // Si se llenó la mesa, arrancar de inmediato
            if (table.players.length >= MAX_TABLE_PLAYERS) {
                await startMesaGame(from);
            }
            return;
        }

        // Sub-acción: INICIAR la mesa antes de que expire el tiempo
        if (action === 'iniciar') {
            if (!table || table.state !== 'lobby') {
                return await sendText(from, `⚠️ No hay ninguna mesa en espera para iniciar.`);
            }
            return await startMesaGame(from);
        }

        // Sub-acción: CANCELAR la mesa
        if (action === 'cancelar') {
            if (!table || table.state !== 'lobby') {
                return await sendText(from, `⚠️ No hay ninguna mesa en espera para cancelar.`);
            }
            if (table.hostJid !== userJid) {
                return await sendText(from, `❌ Solo el creador de la mesa (*${table.hostName}*) puede cancelarla.`);
            }
            clearGameTimer(table);
            if (table.joining) {
                table.joining.clear();
            }
            for (const p of table.players) {
                await db.addXp(p.jid, p.bet);
            }
            activeTables.delete(from);
            return await sendText(from,
                `🛑 *Mesa de Blackjack cancelada.* Se reembolsaron las apuestas de todos los jugadores.`
            );
        }

        // Acción: CREAR NUEVA MESA
        if (table) {
            if (table.state === 'lobby') {
                return await sendText(from,
                    `⚠️ *Ya hay una mesa abierta esperando jugadores* (Apuesta: *${table.bet} XP*).\n` +
                    `Escribe *"entrar"* para sentarte o *"iniciar"* para arrancar.`
                );
            } else {
                return await sendText(from,
                    `⚠️ *Hay una partida en curso en la mesa.* Espera a que concluya la ronda.`
                );
            }
        }

        const bet = Math.max(MIN_BET, Math.min(MAX_BET, isNaN(requestedBet) ? DEFAULT_BET : requestedBet));
        const user = await db.getOrCreateUser(userJid);

        if (user.xp < bet) {
            return await sendText(from,
                `❌ *No tienes fondos para abrir la mesa, ${userName}.*\n` +
                `Tu saldo es de *${user.xp} XP* y la apuesta es de *${bet} XP*.`
            );
        }

        await db.subtractXp(userJid, bet);

        const newTable = {
            groupJid: from,
            hostJid: userJid,
            hostName: userName,
            bet,
            state: 'lobby',
            players: [
                {
                    jid: userJid,
                    name: userName,
                    hand: [],
                    bet,
                    status: 'waiting'
                }
            ],
            currentTurnIndex: 0,
            dealerHand: [],
            deck: [],
            timer: null
        };

        newTable.timer = setTimeout(() => {
            logger.info(`[MESA-21] Lobby expirado en ${from}. Iniciando partida.`);
            startMesaGame(from).catch((e) => logger.error(`[MESA-21] Error en inicio lobby: ${e.message}`));
        }, TABLE_LOBBY_MS);

        activeTables.set(from, newTable);

        return await sendText(from,
            `🎰 *MESA DE CASINO - BLACKJACK 21* 🎰\n\n` +
            `👑 *Mesa abierta por:* *${userName}*\n` +
            `💰 *Apuesta:* *${bet} XP* por cabeza\n` +
            `👥 *Sentados (1/${MAX_TABLE_PLAYERS}):* ${userName}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `⏰ Tienen *35 segundos* para unirse.\n` +
            `👉 Escribe *"entrar"* (o *"yo juego"*) para sentarte a la mesa.\n` +
            `👉 El creador puede escribir *"iniciar"* para empezar de una.`
        );
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // ── MODO INDIVIDUAL CONCURRENTE (1v1 CONTRA BOTSKY) ────────────────────────
    // ═════════════════════════════════════════════════════════════════════════════

    const gameKey = `${from}_${userJid}`;
    const existingGame = activeGames.get(gameKey);

    // Sub-acción individual: PEDIR
    if (action === 'pedir') {
        if (!existingGame) {
            return await sendText(from,
                `🃏 *BLACKJACK 21*\n` +
                `No tienes ninguna mano activa, *${userName}*.\n` +
                `Inicia una con: *botsky 21 [apuesta]* (ej: *botsky 21 100*).`
            );
        }

        clearGameTimer(existingGame);

        const newCard = existingGame.deck.pop();
        existingGame.playerHand.push(newCard);
        const currentScore = calculateScore(existingGame.playerHand);

        if (currentScore > 21) {
            activeGames.delete(gameKey);
            return await sendText(from,
                `🎰 *CASINO BOTSKY - BLACKJACK 21* 🎰\n\n` +
                `👤 *Tu Mano (${userName}):*\n` +
                `${formatHand(existingGame.playerHand)}\n` +
                `*Puntos:* *${currentScore}* 💥 *(¡TE PASASTE!)*\n\n` +
                `🤖 *Mano de Botsky (Dealer):*\n` +
                `${formatHand([existingGame.dealerHand[0]])} [ 🂠 ??? ]\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `💥 *¡TE VOLASTE CON ${currentScore} PUNTOS!*\n` +
                `Te pasaste de 21, compa. La casa se queda tus *${existingGame.bet} XP*.`
            );
        }

        if (currentScore === 21) {
            await sendText(from,
                `🎯 *¡21 CLAVADOS!* Sumaste 21 puntos exactos. Te plantas en automático...`
            );
            return await resolveDealerTurn(existingGame, gameKey);
        }

        existingGame.timer = setTimeout(() => {
            logger.info(`[BLACKJACK] Timeout para ${gameKey}. Auto-plantando.`);
            resolveDealerTurn(existingGame, gameKey).catch((e) => logger.error(`[BLACKJACK] Error en timeout: ${e.message}`));
        }, GAME_TIMEOUT_MS);

        return await sendText(from,
            `🎰 *CASINO BOTSKY - BLACKJACK 21* 🎰\n\n` +
            `👤 *Tu Mano (${userName}):*\n` +
            `${formatHand(existingGame.playerHand)}\n` +
            `*Puntos:* *${currentScore}*\n\n` +
            `🤖 *Mano de Botsky (Dealer):*\n` +
            `${formatHand([existingGame.dealerHand[0]])} [ 🂠 ??? ]\n` +
            `*Visible:* *${existingGame.dealerHand[0].val}* pts\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💰 *Apuesta:* *${existingGame.bet} XP*\n` +
            `⏰ *¿Qué haces? (60s):*\n` +
            `👉 *"pedir"* para sacar otra carta.\n` +
            `👉 *"plantar"* para quedarte con tus ${currentScore} puntos.`
        );
    }

    // Sub-acción individual: PLANTAR
    if (action === 'plantar') {
        if (!existingGame) {
            return await sendText(from,
                `🃏 *BLACKJACK 21*\n` +
                `No tienes ninguna mano activa, *${userName}*.\n` +
                `Inicia una con: *botsky 21 [apuesta]* (ej: *botsky 21 100*).`
            );
        }
        return await resolveDealerTurn(existingGame, gameKey);
    }

    // Sub-acción individual: DOBLAR
    if (action === 'doblar') {
        if (!existingGame) {
            return await sendText(from,
                `🃏 *BLACKJACK 21*\n` +
                `No tienes ninguna mano activa, *${userName}*.\n` +
                `Inicia una con: *botsky 21 [apuesta]*.`
            );
        }

        if (existingGame.playerHand.length !== 2) {
            return await sendText(from,
                `⚠️ *No puedes doblar:* Solo se permite doblar en tu primer movimiento (con tus 2 cartas iniciales).`
            );
        }

        const user = await db.getOrCreateUser(userJid);
        if (user.xp < existingGame.bet) {
            return await sendText(from,
                `⚠️ *Sin fondos para doblar:* Necesitas *${existingGame.bet} XP* adicionales (tienes *${user.xp} XP*). Solo puedes *pedir* o *plantar*.`
            );
        }

        clearGameTimer(existingGame);

        await db.subtractXp(userJid, existingGame.bet);
        existingGame.bet *= 2;

        const newCard = existingGame.deck.pop();
        existingGame.playerHand.push(newCard);
        const currentScore = calculateScore(existingGame.playerHand);

        if (currentScore > 21) {
            activeGames.delete(gameKey);
            return await sendText(from,
                `🎰 *CASINO BOTSKY - BLACKJACK 21 (DOBLADO)* 🎰\n\n` +
                `👤 *Tu Mano (${userName}):*\n` +
                `${formatHand(existingGame.playerHand)}\n` +
                `*Puntos:* *${currentScore}* 💥 *(¡TE PASASTE!)*\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `💥 *¡DOBLASTE Y TE FUISTE DE HOCICO!*\n` +
                `Sacaste ${formatCard(newCard)} y sumaste ${currentScore} puntos.\n` +
                `La casa se queda tu apuesta doble de *${existingGame.bet} XP*.`
            );
        }

        await sendText(from,
            `💰 *¡APUESTA DOBLADA A ${existingGame.bet} XP!*\n` +
            `Recibiste tu única carta: ${formatCard(newCard)} (Puntos: *${currentScore}*). Crupier jugando...`
        );
        return await resolveDealerTurn(existingGame, gameKey);
    }

    // Iniciar nueva partida individual
    if (existingGame || startingGames.has(gameKey)) {
        if (existingGame) {
            const score = calculateScore(existingGame.playerHand);
            return await sendText(from,
                `⚠️ *YA TIENES UNA PARTIDA ACTIVA*\n` +
                `Mano actual: ${formatHand(existingGame.playerHand)} (*${score}* pts)\n` +
                `Apuesta: *${existingGame.bet} XP*\n\n` +
                `👉 Escribe *"pedir"* para otra carta o *"plantar"* para quedarte.`
            );
        } else {
            return await sendText(from, `⚠️ Ya se está iniciando una partida para ti, espera un momento.`);
        }
    }

    startingGames.add(gameKey);
    try {
        const bet = Math.max(MIN_BET, Math.min(MAX_BET, isNaN(requestedBet) ? DEFAULT_BET : requestedBet));
        const user = await db.getOrCreateUser(userJid);

        if (user.xp <= 0) {
            await db.addXp(userJid, 20);
            await sendText(from,
                `🪙 *FICHA DE LÁSTIMA DE BOTSKY*\n` +
                `Andabas en la quiebra absoluta (0 XP). Te regalé *20 XP* para que juegues una ronda.\n` +
                `¡No la vayas a cagar, compa!`
            );
        }

        const currentXp = (await db.getOrCreateUser(userJid)).xp;
        if (currentXp < bet) {
            return await sendText(from,
                `❌ *NO TRAES FERIA SUFICIENTE*\n` +
                `Usuario: *${userName}*\n` +
                `Tu saldo: *${currentXp} XP*\n` +
                `Apuesta mínima: *${MIN_BET} XP*\n\n` +
                `Gana XP con tu giro diario (*botsky daily*) o en el chat antes de jugar.`
            );
        }

        await db.subtractXp(userJid, bet);

        const deck = createDeck();
        const playerHand = [deck.pop(), deck.pop()];
        const dealerHand = [deck.pop(), deck.pop()];

        const playerScore = calculateScore(playerHand);
        const playerBJ = isNaturalBlackjack(playerHand);
        const dealerBJ = isNaturalBlackjack(dealerHand);

        if (playerBJ && dealerBJ) {
            await db.addXp(userJid, bet);
            return await sendText(from,
                `🎰 *CASINO BOTSKY - BLACKJACK 21* 🎰\n\n` +
                `👤 *Tu Mano (${userName}):*\n` +
                `${formatHand(playerHand)}\n` +
                `*Puntos:* *21* *(¡BLACKJACK NATURAL!)*\n\n` +
                `🤖 *Mano de Botsky (Dealer):*\n` +
                `${formatHand(dealerHand)}\n` +
                `*Puntos:* *21* *(¡BLACKJACK NATURAL!)*\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🤝 *¡INSÓLITO! EMPATE DE BLACKJACKS.*\n` +
                `Ambos tuvieron 21 de mano. Se te devuelve tu apuesta de *${bet} XP*.`
            );
        }

        if (playerBJ) {
            const profit = Math.floor(bet * 1.5);
            const totalWon = bet + profit;
            await db.addXp(userJid, totalWon);
            return await sendText(from,
                `🎰 *CASINO BOTSKY - BLACKJACK 21* 🎰\n\n` +
                `👤 *Tu Mano (${userName}):*\n` +
                `${formatHand(playerHand)}\n` +
                `*Puntos:* *21* *(¡BLACKJACK NATURAL! 💥)*\n\n` +
                `🤖 *Mano de Botsky (Dealer):*\n` +
                `${formatHand([dealerHand[0]])} [ 🂠 ??? ]\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🎉 *¡¡BLACKJACK DIRECTO, CABRÓN!!*\n` +
                `¡Premio especial 3:2! Cobraste *+${totalWon} XP* (ganancia limpia: *+${profit} XP*).`
            );
        }

        if (dealerBJ) {
            return await sendText(from,
                `🎰 *CASINO BOTSKY - BLACKJACK 21* 🎰\n\n` +
                `👤 *Tu Mano (${userName}):*\n` +
                `${formatHand(playerHand)}\n` +
                `*Puntos:* *${playerScore}*\n\n` +
                `🤖 *Mano de Botsky (Dealer):*\n` +
                `${formatHand(dealerHand)}\n` +
                `*Puntos:* *21* *(¡BLACKJACK NATURAL DE LA CASA!)*\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `💀 *¡LA CASA SACÓ BLACKJACK A LA PRIMERA!*\n` +
                `Ni las manos metiste. Botsky se queda tus *${bet} XP*.`
            );
        }

        const newGame = {
            from,
            userJid,
            userName,
            bet,
            deck,
            playerHand,
            dealerHand,
            createdAt: Date.now(),
            timer: null
        };

        newGame.timer = setTimeout(() => {
            logger.info(`[BLACKJACK] Timeout para ${gameKey}. Auto-plantando.`);
            resolveDealerTurn(newGame, gameKey).catch((e) => logger.error(`[BLACKJACK] Error en timeout: ${e.message}`));
        }, GAME_TIMEOUT_MS);

        activeGames.set(gameKey, newGame);

        return await sendText(from,
            `🎰 *CASINO BOTSKY - BLACKJACK 21* 🎰\n\n` +
            `👤 *Tu Mano (${userName}):*\n` +
            `${formatHand(playerHand)}\n` +
            `*Puntos:* *${playerScore}*\n\n` +
            `🤖 *Mano de Botsky (Dealer):*\n` +
            `${formatHand([dealerHand[0]])} [ 🂠 ??? ]\n` +
            `*Visible:* *${dealerHand[0].val}* pts\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💰 *Apuesta:* *${bet} XP*\n` +
            `⏰ *Tienes 60s para decidir:*\n` +
            `👉 *"pedir"* para sacar otra carta.\n` +
            `👉 *"plantar"* para quedarte con tus ${playerScore} puntos.\n` +
            `👉 *"doblar"* para duplicar apuesta por 1 sola carta.`
        );
    } finally {
        startingGames.delete(gameKey);
    }
}

module.exports = {
    handleBlackjack,
    hasActiveBlackjackGame,
    hasActiveBlackjackTableLobby,
    hasActiveBlackjackTablePlaying,
    getCurrentTableTurnPlayerJid,
    activeGames,
    activeTables,
    createDeck,
    calculateScore,
    formatCard,
    formatHand,
    isNaturalBlackjack,
    startMesaGame,
    advanceMesaTurn,
    resolveMesaShowdown,
    handleTablePlayerAction
};
