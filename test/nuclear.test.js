'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../src/services/db');
const evolution = require('../src/services/evolution');
const { handleNuclear, activeDetonations, NUCLEAR_XP_COST, KICK_DELAY_MS, _setSleepFn } = require('../src/commands/nuclear');
const { isRegisteredCommand } = require('../src/core/commandRegistry');

test('Nuclear: commandRegistry reconoce los aliases de nuclear', () => {
    assert.strictEqual(isRegisteredCommand('nuclear'), true);
    assert.strictEqual(isRegisteredCommand('nuke'), true);
    assert.strictEqual(isRegisteredCommand('bomba'), true);
    assert.strictEqual(isRegisteredCommand('kamikaze'), true);
});

test('Nuclear: rechaza ejecución si no es un grupo', async () => {
    const sentMessages = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        if (data && data.text) sentMessages.push(data.text);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await handleNuclear({}, '5215512345678@s.whatsapp.net', { pushName: 'Tester' });
        assert.ok(sentMessages.length > 0);
        assert.ok(sentMessages[0].includes('solo se puede detonar en grupos'));
    } finally {
        evolution.client.post = origPost;
    }
});

test('Nuclear: rechaza ejecución si el usuario no tiene 5,000 XP', async () => {
    const groupJid = `test_nuke_noxp_${Date.now()}@g.us`;
    const userJid = '5215599999999@s.whatsapp.net';

    // Asegurar que el usuario tenga menos de 5000 XP
    const user = await db.getOrCreateUser(userJid);
    if (user.xp >= NUCLEAR_XP_COST) {
        await db.subtractXp(userJid, user.xp);
    }

    const sentMessages = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        if (data && data.text) sentMessages.push(data.text);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await handleNuclear({}, groupJid, { key: { participant: userJid }, pushName: 'PobreEnXp' });
        assert.ok(sentMessages.length > 0);
        assert.ok(sentMessages[0].includes('No tienes suficiente experiencia'));
        assert.ok(sentMessages[0].includes('5,000 XP'));
    } finally {
        evolution.client.post = origPost;
    }
});

test('Nuclear: ciclo completo de detonación kamikaze con deducción de XP y purga', async () => {
    _setSleepFn(() => Promise.resolve());
    const groupJid = `test_nuke_group_${Date.now()}@g.us`;
    const attackerJid = '5215511112222@s.whatsapp.net';
    const botJid = '5214437367565@s.whatsapp.net';
    const adminJid = '5215533334444@s.whatsapp.net';
    const member1Jid = '5215555556666@s.whatsapp.net';
    const member2Jid = '5215577778888@s.whatsapp.net';

    // Dar 6000 XP al atacante
    await db.getOrCreateUser(attackerJid);
    await db.addXp(attackerJid, 6000);
    const initialXp = (await db.getOrCreateUser(attackerJid)).xp;

    const sentMessages = [];
    const removedParticipants = [];
    const demotedParticipants = [];

    const origPost = evolution.client.post;
    const origGet = evolution.client.get;

    // Mock HTTP para Evolution API
    evolution.client.post = async (url, data) => {
        if (url.includes('/message/sendText')) {
            sentMessages.push(data.text);
        } else if (url.includes('/group/updateParticipant')) {
            if (data.action === 'remove') {
                removedParticipants.push(...data.participants);
            } else if (data.action === 'demote') {
                demotedParticipants.push(...data.participants);
            }
        }
        return { data: { status: 'SUCCESS' } };
    };

    evolution.client.get = async (url) => {
        if (url.includes('/group/findGroupInfos')) {
            return {
                data: {
                    id: groupJid,
                    participants: [
                        { id: botJid, phoneNumber: '5214437367565', admin: 'admin' }, // Bot (admin)
                        { id: adminJid, phoneNumber: '5215533334444', admin: 'admin' }, // Otro Admin
                        { id: attackerJid, phoneNumber: '5215511112222', admin: null }, // Atacante (normal)
                        { id: member1Jid, phoneNumber: '5215555556666', admin: null }, // Miembro 1
                        { id: member2Jid, phoneNumber: '5215577778888', admin: null }  // Miembro 2
                    ]
                }
            };
        }
        return { data: {} };
    };

    try {
        await handleNuclear({}, groupJid, {
            key: { participant: attackerJid },
            pushName: 'KamikazeMaster'
        });

        // 1. Verificar que se dedujeron 5,000 XP
        const finalXp = (await db.getOrCreateUser(attackerJid)).xp;
        assert.strictEqual(finalXp, initialXp - 5000);

        // 2. Verificar que se envió la alerta de cuenta regresiva
        assert.ok(sentMessages.some(m => m.includes('ALERTA NUCLEAR ACTIVADA')));
        assert.ok(sentMessages.some(m => m.includes('KamikazeMaster')));
        assert.ok(sentMessages.some(m => m.includes('Sacrificio Kamikaze')));

        // 3. Verificar los participantes expulsados
        // El bot NO debe haber sido expulsado
        assert.ok(!removedParticipants.some(p => p.includes('5214437367565')), 'El bot no debe ser expulsado');
        // El otro admin NO debe haber sido expulsado
        assert.ok(!removedParticipants.some(p => p.includes('5215533334444')), 'Los admins no deben ser expulsados');
        // Miembro 1 debe haber sido expulsado
        assert.ok(removedParticipants.some(p => p.includes('5215555556666')), 'Miembro 1 debe ser expulsado');
        // Miembro 2 debe haber sido expulsado
        assert.ok(removedParticipants.some(p => p.includes('5215577778888')), 'Miembro 2 debe ser expulsado');
        // El atacante TAMBIÉN debe haber sido expulsado (Kamikaze)
        assert.ok(removedParticipants.some(p => p.includes('5215511112222')), 'El atacante debe ser expulsado');

        // 4. Verificar reporte final
        assert.ok(sentMessages.some(m => m.includes('DETONACIÓN NUCLEAR CONCLUIDA')));
        assert.ok(sentMessages.some(m => m.includes('3 miembros purgados')));
        assert.ok(sentMessages.some(m => m.includes('administradores')));

        // 5. Verificar que el mutex quedó liberado
        assert.strictEqual(activeDetonations.has(groupJid), false);
    } finally {
        evolution.client.post = origPost;
        evolution.client.get = origGet;
        activeDetonations.delete(groupJid);
    }
});
