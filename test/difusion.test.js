'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const {
    handleDifusion,
    parallelDispatch,
    getParticipantJid,
    isBotJid,
    DIFUSION_XP_COST
} = require('../src/commands/difusion');
const evolution = require('../src/services/evolution');
const db = require('../src/services/db');

test('Difusion: parallelDispatch ejecuta 12 tareas en lotes concurrentes en menos de 1 segundo', async () => {
    const items = Array.from({ length: 12 }, (_, i) => `item_${i}`);
    const start = Date.now();
    let peakConcurrency = 0;
    let active = 0;

    const results = await parallelDispatch(items, 4, async (item) => {
        active++;
        if (active > peakConcurrency) peakConcurrency = active;
        await new Promise(r => setTimeout(r, 40));
        active--;
        return `done_${item}`;
    });

    const elapsed = Date.now() - start;
    assert.strictEqual(results.length, 12);
    assert.ok(peakConcurrency <= 4, `Concurrencia máxima esperada <= 4, fue ${peakConcurrency}`);
    assert.ok(elapsed < 1000, `El tiempo total (${elapsed}ms) debe ser menor a 1000ms`);
    for (const r of results) {
        assert.strictEqual(r.status, 'fulfilled');
    }
});

test('Difusion: getParticipantJid resuelve números y JIDs correctamente', () => {
    assert.strictEqual(getParticipantJid({ id: '5214431234567@s.whatsapp.net' }), '5214431234567@s.whatsapp.net');
    assert.strictEqual(getParticipantJid({ phoneNumber: '5214439876543' }), '5214439876543@s.whatsapp.net');
    assert.strictEqual(getParticipantJid({ id: '123456789@lid' }), '123456789@lid');
    assert.strictEqual(getParticipantJid('5214430000000@s.whatsapp.net'), '5214430000000@s.whatsapp.net');
    assert.strictEqual(getParticipantJid(null), null);
});

test('Difusion: isBotJid detecta el número del bot', () => {
    const botNum = (process.env.BOT_NUMBER || '5214437367565').replace(/[^0-9]/g, '');
    assert.strictEqual(isBotJid(`${botNum}@s.whatsapp.net`), true);
    assert.strictEqual(isBotJid('5219999999999@s.whatsapp.net'), false);
    assert.strictEqual(isBotJid(null), true);
});

test('Difusion: Usuario no-admin con menos de 5000 XP es rechazado', async () => {
    const testUser = `test_poor_${Date.now()}@s.whatsapp.net`;
    await db.getOrCreateUser(testUser);
    // Asegurar que tiene menos de 5000 XP
    await db.addXp(testUser, 100);

    const origSend = evolution.sendText;
    let sentNotice = '';
    evolution.sendText = async (to, text) => {
        sentNotice = text;
        return { messageId: '123' };
    };

    try {
        await handleDifusion(
            { raw: '!difusion Hola a todos', args: ['Hola', 'a', 'todos'], flags: {} },
            '120363000000000000@g.us',
            { key: { participant: testUser } }
        );

        assert.ok(sentNotice.includes('DIFUSIÓN DENEGADA'), 'Debe denegar la difusión por falta de XP');
        assert.ok(sentNotice.includes('5,000 XP'));
    } finally {
        evolution.sendText = origSend;
    }
});

test('Difusion: Usuario no-admin con 5000 XP paga el costo y ejecuta la difusión', async () => {
    const testUser = `test_rich_${Date.now()}@s.whatsapp.net`;
    await db.getOrCreateUser(testUser);
    await db.addXp(testUser, 6000);

    const groupJid = '120363111111111111@g.us';
    const origGetGroup = evolution.getGroupInfo;
    const origSendText = evolution.sendText;

    evolution.getGroupInfo = async () => ({
        participants: [
            { id: testUser },
            { id: '5214431111111@s.whatsapp.net' },
            { id: '5214432222222@s.whatsapp.net' }
        ]
    });

    const dmsSent = [];
    let reportNotice = '';
    evolution.sendText = async (to, text) => {
        if (to === groupJid) {
            reportNotice = text;
        } else {
            dmsSent.push({ to, text });
        }
        return { messageId: '123' };
    };

    try {
        await handleDifusion(
            { raw: '!difusion Tarea mañana', args: ['Tarea', 'mañana'], flags: {} },
            groupJid,
            { key: { participant: testUser } }
        );

        assert.strictEqual(dmsSent.length, 2, 'Debe enviar DM a los otros 2 participantes');
        assert.ok(reportNotice.includes('DIFUSIÓN COMPLETADA'), 'Debe reportar difusión completada');
        assert.ok(reportNotice.includes('5,000 XP consumidos'), 'Debe indicar deducción de XP');

        const userAfter = await db.getOrCreateUser(testUser);
        assert.strictEqual(userAfter.xp, 1000, 'Debe haber descontado exactamente 5,000 XP');
    } finally {
        evolution.getGroupInfo = origGetGroup;
        evolution.sendText = origSendText;
    }
});

test('Difusion: Administrador autorizado realiza difusión gratis (0 XP)', async () => {
    const origAdmin = process.env.ALLOWED_NUMBERS_ADMIN;
    const adminUser = '5214435810175@s.whatsapp.net';
    process.env.ALLOWED_NUMBERS_ADMIN = '5214435810175';

    const groupJid = '120363222222222222@g.us';
    const origGetGroup = evolution.getGroupInfo;
    const origSendText = evolution.sendText;

    evolution.getGroupInfo = async () => ({
        participants: [
            { id: adminUser },
            { id: '5214433333333@s.whatsapp.net' },
            { id: '5214434444444@s.whatsapp.net' },
            { id: '5214435555555@s.whatsapp.net' }
        ]
    });

    const dmsSent = [];
    let reportNotice = '';
    evolution.sendText = async (to, text) => {
        if (to === groupJid) {
            reportNotice = text;
        } else {
            dmsSent.push({ to, text });
        }
        return { messageId: '123' };
    };

    try {
        await handleDifusion(
            { raw: '!difusion Aviso del profe', args: ['Aviso', 'del', 'profe'], flags: {} },
            groupJid,
            { key: { participant: adminUser } }
        );

        assert.strictEqual(dmsSent.length, 3, 'Debe enviar DM a los 3 integrantes');
        assert.ok(reportNotice.includes('Administrador'), 'Debe reconocer al administrador');
        assert.ok(!reportNotice.includes('5,000 XP consumidos'), 'No debe cobrar XP al admin');
    } finally {
        process.env.ALLOWED_NUMBERS_ADMIN = origAdmin;
        evolution.getGroupInfo = origGetGroup;
        evolution.sendText = origSendText;
    }
});

test('Difusion: Con foto adjunta envía sendMedia a cada participante', async () => {
    const origAdmin = process.env.ALLOWED_NUMBERS_ADMIN;
    const adminUser = '5214435810175@s.whatsapp.net';
    process.env.ALLOWED_NUMBERS_ADMIN = '5214435810175';

    const groupJid = '120363333333333333@g.us';
    const origGetGroup = evolution.getGroupInfo;
    const origSendMedia = evolution.sendMedia;
    const origSendText = evolution.sendText;
    const origDownload = evolution.downloadMedia;

    evolution.getGroupInfo = async () => ({
        participants: [
            { id: adminUser },
            { id: '5214436666666@s.whatsapp.net' },
            { id: '5214437777777@s.whatsapp.net' }
        ]
    });

    evolution.downloadMedia = async () => ({
        buffer: Buffer.from('fake image content'),
        extension: 'jpg'
    });

    const mediaDispatched = [];
    evolution.sendMedia = async (to, filePath, caption) => {
        mediaDispatched.push({ to, filePath, caption });
        return { messageId: 'media_123' };
    };

    let reportNotice = '';
    evolution.sendText = async (to, text) => {
        if (to === groupJid) reportNotice = text;
        return { messageId: 'txt_123' };
    };

    try {
        await handleDifusion(
            { raw: '!difusion Miren la tarea de la foto', args: ['Miren', 'la', 'tarea', 'de', 'la', 'foto'], flags: {} },
            groupJid,
            {
                key: { participant: adminUser },
                messageType: 'imageMessage',
                message: { imageMessage: { url: 'https://example.com/img.jpg' } }
            }
        );

        assert.strictEqual(mediaDispatched.length, 2, 'Debe despachar la foto a los 2 destinatarios');
        assert.ok(mediaDispatched[0].caption.includes('Miren la tarea'));
        assert.ok(reportNotice.includes('DIFUSIÓN COMPLETADA'));
    } finally {
        process.env.ALLOWED_NUMBERS_ADMIN = origAdmin;
        evolution.getGroupInfo = origGetGroup;
        evolution.sendMedia = origSendMedia;
        evolution.sendText = origSendText;
        evolution.downloadMedia = origDownload;
    }
});
