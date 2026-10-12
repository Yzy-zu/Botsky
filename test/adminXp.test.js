'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/services/db');
const evolution = require('../src/services/evolution');
const { handleDarXp } = require('../src/commands/niveles');
const { isRegisteredCommand } = require('../src/core/commandRegistry');

test('AdminXP: aliases registrados correctamente en commandRegistry', () => {
    assert.equal(isRegisteredCommand('darxp'), true);
    assert.equal(isRegisteredCommand('addxp'), true);
    assert.equal(isRegisteredCommand('añademe'), true);
    assert.equal(isRegisteredCommand('anademe'), true);
    assert.equal(isRegisteredCommand('damexp'), true);
    assert.equal(isRegisteredCommand('sumarxp'), true);
    assert.equal(isRegisteredCommand('xpadmin'), true);
});

test('AdminXP: usuario no autorizado es rechazado con acceso denegado y no recibe XP', async () => {
    const intruderJid = `intruder_test_${Date.now()}@s.whatsapp.net`;
    const groupJid = '120363999999999999@g.us';

    const initialUser = await db.getOrCreateUser(intruderJid);
    const initialXp = initialUser.xp;

    const fakeMessageData = {
        key: {
            remoteJid: groupJid,
            participant: intruderJid
        },
        pushName: 'Intruso'
    };

    const sentMessages = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        if (data && data.text) sentMessages.push(data.text);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await handleDarXp({ raw: 'añademe 1000 de experiencia', args: ['1000'], flags: {} }, groupJid, fakeMessageData);

        assert.ok(sentMessages.length > 0);
        assert.ok(sentMessages[0].includes('Acceso denegado'), 'Debe denegar acceso');

        const afterUser = await db.getOrCreateUser(intruderJid);
        assert.equal(afterUser.xp, initialXp, 'No debe haber cambiado la experiencia del intruso');
    } finally {
        evolution.client.post = origPost;
    }
});

test('AdminXP: administrador autorizado en grupo se otorga 1000 XP exitosamente', async () => {
    // Número configurado en ALLOWED_NUMBERS_ADMIN
    const adminJid = '5214435810175@s.whatsapp.net';
    const groupJid = '120363999999999999@g.us';

    const before = await db.getOrCreateUser(adminJid);
    const startXp = before.xp;

    const fakeMessageData = {
        key: {
            remoteJid: groupJid,
            participant: adminJid
        },
        pushName: 'Dueño'
    };

    const sentMessages = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        if (data && data.text) sentMessages.push(data.text);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await handleDarXp({ raw: 'añademe 1000 de experiencia', args: ['1000'], flags: {} }, groupJid, fakeMessageData);

        assert.ok(sentMessages.length > 0);
        assert.ok(sentMessages[0].includes('EXPERIENCIA AÑADIDA'), 'Debe confirmar que se añadió la experiencia');
        assert.ok(sentMessages[0].includes('+1,000 XP'), 'Debe mostrar la cantidad formateada');

        const after = await db.getOrCreateUser(adminJid);
        assert.equal(after.xp, startXp + 1000, 'Debe sumar exactamente 1000 XP en SQLite');
    } finally {
        evolution.client.post = origPost;
    }
});

test('AdminXP: extrae la cantidad solicitada si pide un número diferente (ej: 500)', async () => {
    const adminJid = '5214435810175@s.whatsapp.net';
    const groupJid = '120363999999999999@g.us';

    const before = await db.getOrCreateUser(adminJid);
    const startXp = before.xp;

    const fakeMessageData = {
        key: {
            remoteJid: groupJid,
            participant: adminJid
        },
        pushName: 'Dueño'
    };

    const sentMessages = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        if (data && data.text) sentMessages.push(data.text);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await handleDarXp({ raw: 'añademe 500 de experiencia', args: ['500'], flags: {} }, groupJid, fakeMessageData);

        assert.ok(sentMessages.length > 0);
        assert.ok(sentMessages[0].includes('+500 XP'));
        const after = await db.getOrCreateUser(adminJid);
        assert.equal(after.xp, startXp + 500);
    } finally {
        evolution.client.post = origPost;
    }
});

test('AdminXP: admin puede otorgar XP a un amigo mencionado con @', async () => {
    const adminJid = '5214435810175@s.whatsapp.net';
    const friendJid = `5214432173905@s.whatsapp.net`;
    const groupJid = '120363999999999999@g.us';

    const friendBefore = await db.getOrCreateUser(friendJid);
    const friendStartXp = friendBefore.xp;
    const adminBefore = await db.getOrCreateUser(adminJid);
    const adminStartXp = adminBefore.xp;

    const fakeMessageData = {
        key: {
            remoteJid: groupJid,
            participant: adminJid
        },
        pushName: 'Dueño',
        message: {
            extendedTextMessage: {
                text: 'botsky dale 500 de xp a @5214432173905',
                contextInfo: {
                    mentionedJid: [friendJid]
                }
            }
        }
    };

    const sentRequests = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        sentRequests.push(data);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await handleDarXp({
            raw: 'botsky dale 500 de xp a @5214432173905',
            args: ['500', '@5214432173905'],
            flags: {},
            aiArgs: { cantidad: 500, target: '@5214432173905' }
        }, groupJid, fakeMessageData);

        assert.ok(sentRequests.length > 0);
        assert.ok(sentRequests[0].text.includes('EXPERIENCIA AÑADIDA'), 'Debe confirmar experiencia añadida');
        assert.ok(sentRequests[0].text.includes('+500 XP'), 'Debe mostrar +500 XP');
        assert.ok(sentRequests[0].text.includes('@5214432173905'), 'Debe mencionar al amigo beneficiario');
        assert.deepEqual(sentRequests[0].options?.mentions?.mentioned, [friendJid], 'Debe enviar mención en Evolution options');

        const friendAfter = await db.getOrCreateUser(friendJid);
        assert.equal(friendAfter.xp, friendStartXp + 500, 'El amigo debe recibir los 500 XP');

        const adminAfter = await db.getOrCreateUser(adminJid);
        assert.equal(adminAfter.xp, adminStartXp, 'El admin no debe recibir XP en este caso');
    } finally {
        evolution.client.post = origPost;
    }
});

test('AdminXP: usuario no admin intentando dar XP a un amigo es bloqueado', async () => {
    const intruderJid = `intruder_friend_${Date.now()}@s.whatsapp.net`;
    const friendJid = `5214432173905@s.whatsapp.net`;
    const groupJid = '120363999999999999@g.us';

    const friendBefore = await db.getOrCreateUser(friendJid);
    const friendStartXp = friendBefore.xp;

    const fakeMessageData = {
        key: {
            remoteJid: groupJid,
            participant: intruderJid
        },
        pushName: 'Intruso',
        message: {
            extendedTextMessage: {
                text: 'botsky dale 1000 de xp a @5214432173905',
                contextInfo: {
                    mentionedJid: [friendJid]
                }
            }
        }
    };

    const sentRequests = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        sentRequests.push(data);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await handleDarXp({
            raw: 'botsky dale 1000 de xp a @5214432173905',
            args: ['1000', '@5214432173905'],
            flags: {},
            aiArgs: { cantidad: 1000, target: '@5214432173905' }
        }, groupJid, fakeMessageData);

        assert.ok(sentRequests.length > 0);
        assert.ok(sentRequests[0].text.includes('Acceso denegado'), 'Debe denegar acceso');

        const friendAfter = await db.getOrCreateUser(friendJid);
        assert.equal(friendAfter.xp, friendStartXp, 'El amigo no debe recibir XP');
    } finally {
        evolution.client.post = origPost;
    }
});

test('AdminXP: admin en grupo con LID puede otorgar XP a un amigo mencionado con LID (@231829483315369)', async () => {
    const adminPhone = '5214435810175';
    const adminLid = '80530972373009@lid';
    const friendLid = '231829483315369@lid';
    const groupJid = '120363315296139888@g.us';

    const friendBefore = await db.getOrCreateUser(friendLid);
    const friendStartXp = friendBefore.xp;
    const adminBefore = await db.getOrCreateUser(adminLid);
    const adminStartXp = adminBefore.xp;

    const fakeMessageData = {
        key: {
            remoteJid: groupJid,
            participant: adminLid,
            participantPn: `${adminPhone}@s.whatsapp.net`
        },
        pushName: 'Azael',
        message: {
            extendedTextMessage: {
                text: 'botsky dale 500 de exp al gay este @231829483315369',
                contextInfo: {
                    mentionedJid: [friendLid]
                }
            }
        }
    };

    const sentRequests = [];
    const origPost = evolution.client.post;
    evolution.client.post = async (url, data) => {
        sentRequests.push(data);
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await handleDarXp({
            raw: 'botsky dale 500 de exp al gay este @231829483315369',
            args: ['500', '@231829483315369'],
            flags: {},
            aiArgs: { cantidad: 500, target: '@231829483315369' }
        }, groupJid, fakeMessageData);

        assert.ok(sentRequests.length > 0);
        assert.ok(sentRequests[0].text.includes('EXPERIENCIA AÑADIDA'));
        assert.ok(sentRequests[0].text.includes('+500 XP'));
        assert.ok(sentRequests[0].text.includes('@231829483315369'), 'Debe incluir el tag del amigo con LID');
        assert.deepEqual(sentRequests[0].options?.mentions?.mentioned, [friendLid]);

        const friendAfter = await db.getOrCreateUser(friendLid);
        assert.equal(friendAfter.xp, friendStartXp + 500, 'El amigo con LID debe recibir los 500 XP');

        const adminAfter = await db.getOrCreateUser(adminLid);
        assert.equal(adminAfter.xp, adminStartXp, 'El admin no debe recibir XP extra');
    } finally {
        evolution.client.post = origPost;
    }
});
