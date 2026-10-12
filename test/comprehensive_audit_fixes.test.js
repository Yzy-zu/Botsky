'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../src/services/db');
const evolution = require('../src/services/evolution');
const { isAuthorizedAdmin } = require('../src/core/auth');
const { normalizeIncomingMessage } = require('../src/core/message_normalizer');
const { handleDarXp } = require('../src/commands/niveles');
const { cambiarTele } = require('../src/commands/cambiarTV');

test('Audit Fix 1 (Seguridad Auth): isAuthorizedAdmin rechaza miembros no-admin en grupos permitidos', () => {
    const groupJid = '120363315296139888@g.us'; // grupo admin en .env
    const randomMemberJid = '5219998887777@s.whatsapp.net';

    const fakeMsg = {
        key: {
            remoteJid: groupJid,
            participant: randomMemberJid
        }
    };

    // Miembro común del grupo no debe ser reconocido como admin
    assert.strictEqual(isAuthorizedAdmin(groupJid, fakeMsg), false, 'Miembro ordinario no debe ser admin');

    // Admin real configurado
    const adminJid = '5214435810175@s.whatsapp.net';
    const fakeAdminMsg = {
        key: {
            remoteJid: groupJid,
            participant: adminJid
        }
    };
    assert.strictEqual(isAuthorizedAdmin(groupJid, fakeAdminMsg), true, 'Admin configurado debe ser admin');
});

test('Audit Fix 2 (Resiliencia Normalizer): normalizeIncomingMessage maneja remoteJid inválido o no-string sin crash', () => {
    const badData1 = { key: { remoteJid: null } };
    assert.strictEqual(normalizeIncomingMessage(badData1), null);

    const badData2 = { key: { remoteJid: 12345 } };
    assert.strictEqual(normalizeIncomingMessage(badData2), null);

    const badData3 = { key: {} };
    assert.strictEqual(normalizeIncomingMessage(badData3), null);
});

test('Audit Fix 3 (Lógica Niveles): handleDarXp otorga experiencia al usuario mencionado y no al admin', async () => {
    const adminJid = '5214435810175@s.whatsapp.net';
    const targetJid = `beneficiary_test_${Date.now()}@s.whatsapp.net`;
    const groupJid = '120363999999999999@g.us';

    const beforeAdmin = await db.getOrCreateUser(adminJid);
    const beforeTarget = await db.getOrCreateUser(targetJid);

    const fakeMessageData = {
        key: {
            remoteJid: groupJid,
            participant: adminJid
        },
        message: {
            extendedTextMessage: {
                text: 'dame 300 xp @beneficiario',
                contextInfo: {
                    mentionedJid: [targetJid]
                }
            }
        },
        pushName: 'AdminDueño'
    };

    const sentMessages = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        if (data?.text) sentMessages.push(data.text);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await handleDarXp({ raw: 'darxp 300', args: ['300'], flags: {} }, groupJid, fakeMessageData);

        const afterAdmin = await db.getOrCreateUser(adminJid);
        const afterTarget = await db.getOrCreateUser(targetJid);

        // El beneficiario debe haber recibido exactamente 300 XP
        assert.strictEqual(afterTarget.xp, beforeTarget.xp + 300, 'El beneficiario debe recibir 300 XP');
        // El admin NO debe haber recibido los 300 XP
        assert.strictEqual(afterAdmin.xp, beforeAdmin.xp, 'El admin no debe recibir XP cuando se la da a un tercero');
    } finally {
        evolution.client.post = origPost;
    }
});

test('Audit Fix 4 (Estabilidad TV): cambiarTele responde con mensaje informativo sin crashear si el script no existe', async () => {
    const sentMessages = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        if (data?.text) sentMessages.push(data.text);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await cambiarTele('test_chat@s.whatsapp.net', 'https://ejemplo.com/canal');
        assert.ok(sentMessages.length > 0);
        assert.ok(sentMessages[0].includes('no está configurado') || sentMessages[0].includes('Cambiando'));
    } finally {
        evolution.client.post = origPost;
    }
});
