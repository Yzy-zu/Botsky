'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../src/services/db');
const evolution = require('../src/services/evolution');
const {
    handleBlackjack,
    hasActiveBlackjackGame,
    hasActiveBlackjackTableLobby,
    hasActiveBlackjackTablePlaying,
    activeGames,
    activeTables,
    createDeck,
    calculateScore,
    formatCard,
    formatHand,
    isNaturalBlackjack
} = require('../src/commands/blackjack');
const { normalizeIncomingMessage } = require('../src/core/message_normalizer');
const { isRegisteredCommand } = require('../src/core/commandRegistry');

test('Blackjack 1: commandRegistry reconoce los aliases de blackjack', () => {
    assert.strictEqual(isRegisteredCommand('blackjack'), true);
    assert.strictEqual(isRegisteredCommand('21'), true);
    assert.strictEqual(isRegisteredCommand('bj'), true);
});

test('Blackjack 2: createDeck genera 52 cartas completas con glifos y emojis', () => {
    const deck = createDeck();
    assert.strictEqual(deck.length, 52, 'La baraja debe contener exactamente 52 cartas');

    // Comprobar que contiene los 4 palos
    const suits = new Set(deck.map(c => c.suit));
    assert.strictEqual(suits.size, 4, 'Deben existir 4 palos diferentes');
    assert.ok(suits.has('♠️'));
    assert.ok(suits.has('♥️'));
    assert.ok(suits.has('♦️'));
    assert.ok(suits.has('♣️'));

    // Comprobar formato visual de carta
    const sampleCard = deck[0];
    const formatted = formatCard(sampleCard);
    assert.ok(formatted.startsWith('[ '), 'El formato debe iniciar con [ ');
    assert.ok(formatted.endsWith(' ]'), 'El formato debe terminar con  ]');
    assert.ok(formatted.includes(sampleCard.glyph), 'Debe incluir el glifo unicode de la carta');
    assert.ok(formatted.includes(sampleCard.suit), 'Debe incluir el emoji del palo');

    // Carta oculta
    const hidden = formatCard(null);
    assert.strictEqual(hidden, '[ 🂠 ??? ]');
});

test('Blackjack 3: calculateScore maneja Ases suaves, figuras y sumas compuestas', () => {
    // Figuras valen 10
    const hand1 = [
        { rank: 'K', val: 10, suit: '♠️', glyph: '🂮' },
        { rank: 'Q', val: 10, suit: '♥️', glyph: '🂽' }
    ];
    assert.strictEqual(calculateScore(hand1), 20);

    // As suave (11)
    const hand2 = [
        { rank: 'A', val: 11, suit: '♠️', glyph: '🂡' },
        { rank: '9', val: 9, suit: '♦️', glyph: '🃉' }
    ];
    assert.strictEqual(calculateScore(hand2), 20);

    // As se convierte en 1 si se pasa de 21
    const hand3 = [
        { rank: 'A', val: 11, suit: '♠️', glyph: '🂡' },
        { rank: '9', val: 9, suit: '♦️', glyph: '🃉' },
        { rank: '5', val: 5, suit: '♣️', glyph: '🃕' }
    ];
    assert.strictEqual(calculateScore(hand3), 15); // 1 + 9 + 5 = 15

    // Múltiples Ases
    const hand4 = [
        { rank: 'A', val: 11, suit: '♠️', glyph: '🂡' },
        { rank: 'A', val: 11, suit: '♥️', glyph: '🂱' },
        { rank: '9', val: 9, suit: '♦️', glyph: '🃉' }
    ];
    assert.strictEqual(calculateScore(hand4), 21); // 11 + 1 + 9 = 21

    // Blackjack Natural
    const bjHand = [
        { rank: 'A', val: 11, suit: '♠️', glyph: '🂡' },
        { rank: 'J', val: 10, suit: '♣️', glyph: '🃛' }
    ];
    assert.strictEqual(isNaturalBlackjack(bjHand), true);
    assert.strictEqual(isNaturalBlackjack(hand1), false);
});

test('Blackjack 4: normalizador conserva peticiones y aporta sesión sin reinterpretar el plan', async () => {
    const testChat = `test_norm_${Date.now()}@g.us`;
    const userJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;

    // 1. Iniciar partida sin prefijo
    const normStart = normalizeIncomingMessage({
        key: { remoteJid: testChat, participant: userJid },
        message: { conversation: 'botsky 21 150' }
    });
    assert.strictEqual(normStart.text, 'botsky 21 150');
    assert.strictEqual(normStart.hasPrefix, false);

    const normStartAlt = normalizeIncomingMessage({
        key: { remoteJid: testChat, participant: userJid },
        message: { conversation: 'jugar al 21' }
    });
    assert.strictEqual(normStartAlt.text, 'jugar al 21');

    // 2. Simular partida activa para probar interacciones (pedir, plantar, doblar)
    const gameKey = `${testChat}_${userJid}`;
    activeGames.set(gameKey, {
        from: testChat,
        userJid,
        userName: 'TestPlayer',
        bet: 50,
        deck: createDeck(),
        playerHand: [{ rank: '8', val: 8, suit: '♠️', glyph: '🂨' }, { rank: '7', val: 7, suit: '♥️', glyph: '🂷' }],
        dealerHand: [{ rank: '10', val: 10, suit: '♦️', glyph: '🃊' }, { rank: '7', val: 7, suit: '♣️', glyph: '🃗' }],
        createdAt: Date.now(),
        timer: null
    });

    assert.strictEqual(hasActiveBlackjackGame(testChat, userJid), true);

    const normPedir = normalizeIncomingMessage({
        key: { remoteJid: testChat, participant: userJid },
        message: { conversation: 'pedir' }
    });
    assert.strictEqual(normPedir.text, 'pedir');
    assert.equal(normPedir.sessions.blackjackHand, true);
    assert.equal(normPedir.hasPrefix, false);

    const normPlantar = normalizeIncomingMessage({
        key: { remoteJid: testChat, participant: userJid },
        message: { conversation: 'me planto' }
    });
    assert.strictEqual(normPlantar.text, 'me planto');

    const normDoblar = normalizeIncomingMessage({
        key: { remoteJid: testChat, participant: userJid },
        message: { conversation: 'doblar' }
    });
    assert.strictEqual(normDoblar.text, 'doblar');

    // Limpiar partida de prueba
    activeGames.delete(gameKey);
});

test('Blackjack 5: ciclo completo de juego (apuesta, pedir carta y plantarse)', async () => {
    const testChat = `test_bj_${Date.now()}@g.us`;
    const userJid = `5215599999999@s.whatsapp.net`;
    const userName = 'AzaelGambler';

    // Preparar saldo suficiente para el jugador
    await db.getOrCreateUser(userJid);
    await db.addXp(userJid, 500);
    const startXp = (await db.getOrCreateUser(userJid)).xp;

    const sentMessages = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        if (data && data.text) sentMessages.push(data.text);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        // 1. Iniciar partida con apuesta de 100 XP
        await handleBlackjack({ args: ['100'] }, testChat, {
            key: { participant: userJid },
            pushName: userName
        });

        const gameKey = `${testChat}_${userJid}`;
        const activeGame = activeGames.get(gameKey);

        if (activeGame) {
            // Si no fue Blackjack natural a la primera, debe haber partida activa y deducción inicial
            const xpAfterBet = (await db.getOrCreateUser(userJid)).xp;
            assert.ok(xpAfterBet <= startXp - 100, 'Se debe deducir la apuesta inicial');
            assert.strictEqual(activeGame.bet, 100);
            assert.strictEqual(activeGame.playerHand.length, 2);

            // 2. Pedir carta (hit)
            await handleBlackjack({ args: ['pedir'] }, testChat, {
                key: { participant: userJid },
                pushName: userName
            });

            // 3. Plantarse (stand) si la partida sigue viva
            if (activeGames.has(gameKey)) {
                await handleBlackjack({ args: ['plantar'] }, testChat, {
                    key: { participant: userJid },
                    pushName: userName
                });
            }

            // Al finalizar, la partida debe haberse limpiado del mapa
            assert.strictEqual(activeGames.has(gameKey), false);
        }

        // Comprobar que se enviaron mensajes con diseño de Casino Botsky
        assert.ok(sentMessages.length > 0);
        assert.ok(sentMessages.some(m => m.includes('CASINO BOTSKY - BLACKJACK 21')));
    } finally {
        evolution.client.post = origPost;
        activeGames.delete(`${testChat}_${userJid}`);
    }
});

test('Blackjack 6: rechaza apuesta si el usuario no tiene fondos suficientes', async () => {
    const testChat = `test_bj_nofunds_${Date.now()}@g.us`;
    const brokeUserJid = `5215500000000@s.whatsapp.net`;

    // Dejar al usuario con exactamente 10 XP
    await db.getOrCreateUser(brokeUserJid);
    const curr = (await db.getOrCreateUser(brokeUserJid)).xp;
    if (curr > 0) await db.subtractXp(brokeUserJid, curr);
    await db.addXp(brokeUserJid, 10);

    const sentMessages = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        if (data && data.text) sentMessages.push(data.text);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await handleBlackjack({ args: ['500'] }, testChat, {
            key: { participant: brokeUserJid },
            pushName: 'Pobre'
        });

        assert.ok(sentMessages.some(m => m.includes('NO TRAES FERIA SUFICIENTE')), 'Debe rechazar la apuesta');
    } finally {
        evolution.client.post = origPost;
    }
});

test('Blackjack 7: Mesa Multijugador: creación de lobby, unión y rechazo de duplicados', async () => {
    const groupJid = `test_bj_mesa_${Date.now()}@g.us`;
    const hostJid = `5215511111111@s.whatsapp.net`;
    const player2Jid = `5215522222222@s.whatsapp.net`;

    await db.getOrCreateUser(hostJid);
    await db.addXp(hostJid, 500);
    await db.getOrCreateUser(player2Jid);
    await db.addXp(player2Jid, 500);

    const sentMessages = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        if (data && data.text) sentMessages.push(data.text);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        // 1. Host abre la mesa con 100 XP
        await handleBlackjack({ args: ['mesa', '100'] }, groupJid, {
            key: { participant: hostJid },
            pushName: 'HostPlayer'
        });

        assert.strictEqual(hasActiveBlackjackTableLobby(groupJid), true);
        const table = activeTables.get(groupJid);
        assert.ok(table);
        assert.strictEqual(table.bet, 100);
        assert.strictEqual(table.players.length, 1);
        assert.strictEqual(table.players[0].jid, hostJid);

        // 2. Jugador 2 se une a la mesa
        await handleBlackjack({ args: ['entrar'] }, groupJid, {
            key: { participant: player2Jid },
            pushName: 'PlayerTwo'
        });

        assert.strictEqual(table.players.length, 2);
        assert.strictEqual(table.players[1].jid, player2Jid);

        // 3. Jugador 2 intenta unirse otra vez (debe ser rechazado)
        await handleBlackjack({ args: ['entrar'] }, groupJid, {
            key: { participant: player2Jid },
            pushName: 'PlayerTwo'
        });
        assert.strictEqual(table.players.length, 2);
        assert.ok(sentMessages.some(m => m.includes('Ya estás sentado en la mesa')));

        // 4. Cancelar mesa (reembolso íntegro)
        const hostXpBeforeCancel = (await db.getOrCreateUser(hostJid)).xp;
        await handleBlackjack({ args: ['cancelar'] }, groupJid, {
            key: { participant: hostJid },
            pushName: 'HostPlayer'
        });

        assert.strictEqual(hasActiveBlackjackTableLobby(groupJid), false);
        const hostXpAfterCancel = (await db.getOrCreateUser(hostJid)).xp;
        assert.strictEqual(hostXpAfterCancel, hostXpBeforeCancel + 100, 'Debe reembolsar la apuesta');
    } finally {
        evolution.client.post = origPost;
        activeTables.delete(groupJid);
    }
});

test('Blackjack 8: Mesa Multijugador: normalizador conserva texto y expone lobby al router semántico', async () => {
    const groupJid = `test_norm_mesa_${Date.now()}@g.us`;
    const userJid = `5215533333333@s.whatsapp.net`;

    // 1. Detecta apertura de mesa sin prefijo
    const normMesa = normalizeIncomingMessage({
        key: { remoteJid: groupJid, participant: userJid },
        message: { conversation: 'mesa 21 200' }
    });
    assert.strictEqual(normMesa.text, 'mesa 21 200');
    assert.strictEqual(normMesa.hasPrefix, false);

    const normMesaAlt = normalizeIncomingMessage({
        key: { remoteJid: groupJid, participant: userJid },
        message: { conversation: 'botsky mesa 21' }
    });
    assert.strictEqual(normMesaAlt.text, 'botsky mesa 21');

    // 2. Simular mesa en lobby para probar 'le entro' e 'iniciar'
    activeTables.set(groupJid, {
        groupJid,
        state: 'lobby',
        players: [],
        bet: 50,
        timer: null
    });

    const normEntro = normalizeIncomingMessage({
        key: { remoteJid: groupJid, participant: userJid },
        message: { conversation: 'le entro' }
    });
    assert.strictEqual(normEntro.text, 'le entro');
    assert.equal(normEntro.sessions.blackjackLobby, true);
    assert.equal(normEntro.hasPrefix, false);

    const normInicia = normalizeIncomingMessage({
        key: { remoteJid: groupJid, participant: userJid },
        message: { conversation: 'arranca' }
    });
    assert.strictEqual(normInicia.text, 'arranca');

    activeTables.delete(groupJid);
});

test('Blackjack 9: Mesa Multijugador: ciclo completo de juego y showdown de Botsky', async () => {
    const groupJid = `test_round_mesa_${Date.now()}@g.us`;
    const hostJid = `5215577777777@s.whatsapp.net`;
    const p2Jid = `5215588888888@s.whatsapp.net`;

    await db.getOrCreateUser(hostJid);
    await db.addXp(hostJid, 500);
    await db.getOrCreateUser(p2Jid);
    await db.addXp(p2Jid, 500);

    const sentMessages = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        if (data && data.text) sentMessages.push(data.text);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        // 1. Abrir mesa y unirse
        await handleBlackjack({ args: ['mesa', '50'] }, groupJid, {
            key: { participant: hostJid },
            pushName: 'HostPlayer'
        });
        await handleBlackjack({ args: ['entrar'] }, groupJid, {
            key: { participant: p2Jid },
            pushName: 'PlayerTwo'
        });

        // 2. Iniciar partida
        await handleBlackjack({ args: ['iniciar'] }, groupJid, {
            key: { participant: hostJid },
            pushName: 'HostPlayer'
        });

        assert.strictEqual(hasActiveBlackjackTablePlaying(groupJid), true);
        const table = activeTables.get(groupJid);
        assert.ok(table);
        assert.strictEqual(table.state, 'playing');

        // 3. Simular decisiones de los jugadores
        // Si el jugador actual sigue 'playing', simular que se planta
        while (table && activeTables.has(groupJid) && table.currentTurnIndex < table.players.length) {
            const currentP = table.players[table.currentTurnIndex];
            if (currentP && currentP.status === 'playing') {
                await handleBlackjack({ args: ['plantar'] }, groupJid, {
                    key: { participant: currentP.jid },
                    pushName: currentP.name
                });
            } else {
                table.currentTurnIndex++;
            }
        }

        // 4. Al concluir todos los turnos, la mesa debe haberse resuelto y limpiado
        assert.strictEqual(activeTables.has(groupJid), false);
        assert.ok(sentMessages.some(m => m.includes('MESA DE CASINO BOTSKY - RESULTADOS')));
        assert.ok(sentMessages.some(m => m.includes('BALANCE DE LA MESA')));
    } finally {
        evolution.client.post = origPost;
        activeTables.delete(groupJid);
    }
});

