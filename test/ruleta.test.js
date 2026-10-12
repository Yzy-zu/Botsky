'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../src/services/db');
const evolution = require('../src/services/evolution');
const { handleRuleta, hasActiveRouletteLobby, activeRooms, checkRouletteExiles } = require('../src/commands/ruleta');
const { normalizeIncomingMessage } = require('../src/core/message_normalizer');
const { isRegisteredCommand } = require('../src/core/commandRegistry');

test('Ruleta: commandRegistry reconoce los aliases de ruleta', () => {
    assert.strictEqual(isRegisteredCommand('ruleta'), true);
    assert.strictEqual(isRegisteredCommand('ruletarusa'), true);
    assert.strictEqual(isRegisteredCommand('roulette'), true);
});

test('Ruleta: ciclo completo de creación de sala, mensaje sin comandos y unión natural', async () => {
    const groupJid = `test_ruleta_${Date.now()}@g.us`;
    const hostJid = '5215511111111@s.whatsapp.net';
    const player2Jid = '5215522222222@s.whatsapp.net';

    // Preparar usuarios con suficiente XP
    const hostUser = await db.getOrCreateUser(hostJid);
    await db.addXp(hostJid, 500);
    const p2User = await db.getOrCreateUser(player2Jid);
    await db.addXp(player2Jid, 500);

    const initialHostXp = (await db.getOrCreateUser(hostJid)).xp;
    const initialP2Xp = (await db.getOrCreateUser(player2Jid)).xp;

    const sentMessages = [];
    const origPost = evolution.client.post;
    const origGet = evolution.client.get;
    const botNumber = (process.env.BOT_NUMBER || '5214437367565').replace(/[^0-9]/g, '');

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push(data.text);
        }
        return { data: { status: 'SUCCESS' } };
    };

    evolution.client.get = async (url) => {
        if (url.includes('/group/findGroupInfos')) {
            return {
                data: {
                    id: groupJid,
                    participants: [
                        { id: `${botNumber}@s.whatsapp.net`, phoneNumber: botNumber, admin: 'admin' },
                        { id: hostJid, phoneNumber: '5215511111111', admin: null },
                        { id: player2Jid, phoneNumber: '5215522222222', admin: null }
                    ]
                }
            };
        }
        return { data: {} };
    };

    try {
        // 1. Verificar que no hay lobby activo
        assert.strictEqual(hasActiveRouletteLobby(groupJid), false);

        // 2. Crear sala con apuesta de 100 XP
        await handleRuleta(
            { args: ['100'] },
            groupJid,
            { key: { participant: hostJid }, pushName: 'HostPlayer' }
        );

        // Debe haber lobby activo
        assert.strictEqual(hasActiveRouletteLobby(groupJid), true);
        const room = activeRooms.get(groupJid);
        assert.ok(room);
        assert.strictEqual(room.bet, 100);
        assert.strictEqual(room.pot, 100);
        assert.strictEqual(room.players.length, 1);

        // Verificar que se dedujo la apuesta del host
        const afterHostXp = (await db.getOrCreateUser(hostJid)).xp;
        assert.strictEqual(afterHostXp, initialHostXp - 100);

        // Verificar que el mensaje NO contiene comandos para entrar, sino invitaciones en lenguaje natural
        assert.ok(sentMessages.length > 0);
        const lobbyMsg = sentMessages[0];
        assert.ok(lobbyMsg.includes('RULETA RUSA'));
        assert.ok(lobbyMsg.includes('yo juego'));
        assert.ok(lobbyMsg.includes('yo le entro'));
        assert.ok(lobbyMsg.includes('yo también'));
        assert.ok(!lobbyMsg.includes('/ruleta entrar'), 'No debe contener comandos para unirse');
        assert.ok(!lobbyMsg.includes('!ruleta entrar'), 'No debe contener comandos para unirse');

        // 3. Probar que message_normalizer convierte frases naturales a 'ruleta entrar' durante el lobby
        const msgYoJuego = normalizeIncomingMessage({
            key: { remoteJid: groupJid, participant: player2Jid, fromMe: false, id: 'msg_yj' },
            message: { conversation: 'yo juego' },
            pushName: 'Player2'
        });
        assert.ok(msgYoJuego);
        assert.strictEqual(msgYoJuego.text, 'ruleta entrar');
        assert.strictEqual(msgYoJuego.hasPrefix, true);

        const msgLeEntro = normalizeIncomingMessage({
            key: { remoteJid: groupJid, participant: player2Jid, fromMe: false, id: 'msg_le' },
            message: { conversation: 'yo le entro' },
            pushName: 'Player2'
        });
        assert.ok(msgLeEntro);
        assert.strictEqual(msgLeEntro.text, 'ruleta entrar');

        // 4. Jugador 2 se une a la partida
        sentMessages.length = 0;
        await handleRuleta(
            { args: ['entrar'] },
            groupJid,
            { key: { participant: player2Jid }, pushName: 'Player2' }
        );

        // Verificar estado de la sala
        assert.strictEqual(room.players.length, 2);
        assert.strictEqual(room.pot, 200);

        // Verificar deducción de XP a Player2
        const afterP2Xp = (await db.getOrCreateUser(player2Jid)).xp;
        assert.strictEqual(afterP2Xp, initialP2Xp - 100);

        // 5. Cancelar sala para limpiar
        sentMessages.length = 0;
        await handleRuleta(
            { args: ['cancelar'] },
            groupJid,
            { key: { participant: hostJid }, pushName: 'HostPlayer' }
        );

        assert.strictEqual(hasActiveRouletteLobby(groupJid), false);
        // Reembolso verificado
        const finalHostXp = (await db.getOrCreateUser(hostJid)).xp;
        assert.strictEqual(finalHostXp, initialHostXp);
    } finally {
        evolution.client.post = origPost;
        evolution.client.get = origGet;
        if (activeRooms.has(groupJid)) {
            const r = activeRooms.get(groupJid);
            if (r.timer) clearTimeout(r.timer);
            activeRooms.delete(groupJid);
        }
    }
});

test('Ruleta: no se puede crear sala si el bot no es administrador del grupo', async () => {
    const groupJid = `test_ruleta_noadmin_${Date.now()}@g.us`;
    const hostJid = '5215511111111@s.whatsapp.net';

    await db.getOrCreateUser(hostJid);
    await db.addXp(hostJid, 500);

    const sentMessages = [];
    const origPost = evolution.client.post;
    const origGet = evolution.client.get;

    evolution.client.post = async (url, data) => {
        if (data && data.text) sentMessages.push(data.text);
        return { data: { status: 'SUCCESS' } };
    };

    evolution.client.get = async (url) => {
        if (url.includes('/group/findGroupInfos')) {
            return {
                data: {
                    id: groupJid,
                    participants: [
                        { id: '5214437367565@s.whatsapp.net', phoneNumber: '5214437367565', admin: null }, // Bot NO es admin
                        { id: hostJid, phoneNumber: '5215511111111', admin: 'admin' }
                    ]
                }
            };
        }
        return { data: {} };
    };

    try {
        await handleRuleta(
            { args: ['100'] },
            groupJid,
            { key: { participant: hostJid }, pushName: 'HostPlayer' }
        );

        assert.strictEqual(hasActiveRouletteLobby(groupJid), false, 'No debe crearse sala si el bot no es admin');
        assert.ok(sentMessages.length > 0);
        assert.ok(sentMessages[0].includes('Botsky requiere permisos de *Administrador*'));
    } finally {
        evolution.client.post = origPost;
        evolution.client.get = origGet;
    }
});

test('Ruleta: exilio en SQLite y mensaje privado limpio a los 20 minutos', async () => {
    const groupJid = `test_exile_group_${Date.now()}@g.us`;
    const victimJid = '5215544444444@s.whatsapp.net';
    const victimName = 'CaídoEnCombate';
    const inviteLink = 'https://chat.whatsapp.com/TestCode123';

    // 1. Registrar exilio vencido (en el pasado para que lo tome el worker)
    const pastUnbanAt = Date.now() - 1000;
    const exile = await db.addRouletteExile(groupJid, victimJid, victimName, pastUnbanAt, inviteLink);
    assert.ok(exile.id);

    // 2. Comprobar que aparece en pendientes
    const pending = await db.getPendingRouletteExiles(Date.now());
    assert.ok(pending.some(e => e.id === exile.id));

    // 3. Ejecutar el worker de exilio con sendText interceptado
    const dmMessages = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            dmMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await checkRouletteExiles();

        // Verificar que se envió el DM al usuario exiliado
        const sentDm = dmMessages.find(m => m.to.includes('5215544444444'));
        assert.ok(sentDm, 'Debe enviar DM privado');
        assert.ok(sentDm.text.includes('Ruleta Rusa'));
        assert.ok(sentDm.text.includes('20 minutos'));
        assert.ok(sentDm.text.includes(inviteLink));

        // Verificar que el mensaje es 100% limpio y sin insultos
        assert.ok(!sentDm.text.toLowerCase().includes('cabrón'));
        assert.ok(!sentDm.text.toLowerCase().includes('chingar'));
        assert.ok(!sentDm.text.toLowerCase().includes('pendejo'));

        // 4. Verificar que se marcó como completado en SQLite
        const pendingAfter = await db.getPendingRouletteExiles(Date.now());
        assert.ok(!pendingAfter.some(e => e.id === exile.id));
    } finally {
        evolution.client.post = origPost;
    }
});
