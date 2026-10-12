'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/services/db');
const { handleAfinidad, renderBar } = require('../src/commands/afinidad');
const evolution = require('../src/services/evolution');

test('Affinity 1: Usuario nuevo inicia por defecto en modo grosero y desconfiado (-20)', async () => {
    const testJid = `test_affinity_new_${Date.now()}@s.whatsapp.net`;
    const aff = await db.getUserAffinity(testJid, 'Paco');

    assert.equal(aff.jid, testJid);
    assert.equal(aff.score, -20, 'El score inicial debe ser -20 (desconfiado)');
    assert.equal(aff.mood, 'desconfiado', 'El estado inicial debe ser desconfiado');
    assert.ok(aff.last_reason.includes('confianza'), 'El motivo inicial debe indicar falta de confianza');

    const context = await db.getUserAffinityContext(testJid, 'Paco');
    assert.ok(context.includes('Grosero y Desconfiado por defecto'), 'El prompt debe instruir modo desconfiado y grosero');
    assert.ok(context.includes('pocas pulgas'), 'Debe instruir pocas pulgas y desdén');
});

test('Affinity 2: Insultos bajan score y activan modo rencoroso (<= -50)', async () => {
    const testJid = `test_affinity_rencor_${Date.now()}@s.whatsapp.net`;
    // Inicializar (-20)
    await db.getUserAffinity(testJid, 'Tito');

    // Insulto fuerte (-35) -> score -55
    const updated = await db.adjustUserAffinity(testJid, 'Tito', -35, 'Le mentó la madre a Botsky');
    assert.equal(updated.score, -55);
    assert.equal(updated.mood, 'rencoroso');
    assert.equal(updated.grievances, 1);
    assert.equal(updated.last_reason, 'Le mentó la madre a Botsky');

    const context = await db.getUserAffinityContext(testJid, 'Tito');
    assert.ok(context.includes('Rencoroso y Encabronado'));
    assert.ok(context.includes('frialdad cortante'));
});

test('Affinity 3: Disculpas suben score y perdonan gradualmente el rencor', async () => {
    const testJid = `test_affinity_perdon_${Date.now()}@s.whatsapp.net`;
    await db.getUserAffinity(testJid, 'Charly');
    await db.adjustUserAffinity(testJid, 'Charly', -40, 'Insultó');

    // Charly pide disculpas (+25) -> -20 - 40 + 25 = -35
    const forgiven = await db.adjustUserAffinity(testJid, 'Charly', 25, 'Pidió perdón sinceramente');
    assert.equal(forgiven.score, -35);
    assert.equal(forgiven.mood, 'desconfiado'); // Sube de rencoroso a desconfiado

    // Charly es buena onda y cotorrea (+40) -> +5
    const neutral = await db.adjustUserAffinity(testJid, 'Charly', 40, 'Le invitó unos tacos');
    assert.equal(neutral.score, 5);
    assert.equal(neutral.mood, 'neutral');

    // Más interacciones positivas (+40) -> +45
    const camarada = await db.adjustUserAffinity(testJid, 'Charly', 40, 'Compa leal');
    assert.equal(camarada.score, 45);
    assert.equal(camarada.mood, 'camarada');

    const context = await db.getUserAffinityContext(testJid, 'Charly');
    assert.ok(context.includes('Camarada / Compa del alma'));
});

test('Affinity 4: Clamping estricto entre -100 y +100', async () => {
    const testJid = `test_affinity_clamp_${Date.now()}@s.whatsapp.net`;
    await db.getUserAffinity(testJid, 'Extremo');

    const min = await db.adjustUserAffinity(testJid, 'Extremo', -500, 'Ofensas masivas');
    assert.equal(min.score, -100, 'Score no debe bajar de -100');

    const max = await db.adjustUserAffinity(testJid, 'Extremo', 1000, 'Amor incondicional');
    assert.equal(max.score, 100, 'Score no debe subir de +100');
});

test('Affinity 5: renderBar dibuja barras proporcionales', () => {
    assert.equal(renderBar(-100), '⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛');
    assert.equal(renderBar(100), '🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩');
    const mid = renderBar(0);
    assert.ok(mid.includes('🟩') && mid.includes('⬛'));
});

test('Affinity 6: handleAfinidad envía reporte visual con estado y consejos', async () => {
    const testJid = `test_affinity_cmd_${Date.now()}@s.whatsapp.net`;
    const origHttp = evolution.client.post;
    let sentMessages = [];

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await handleAfinidad({}, testJid, {
            pushName: 'Beto',
            participant: testJid
        });

        assert.equal(sentMessages.length, 1);
        const msg = sentMessages[0].text;
        assert.ok(msg.includes('NIVEL DE AFINIDAD CON BOTSKY'));
        assert.ok(msg.includes('Beto'));
        assert.ok(msg.includes('-20/100'));
        assert.ok(msg.includes('Desconfiado'));
        assert.ok(msg.includes('Consejo'));
    } finally {
        evolution.client.post = origHttp;
    }
});

test('Affinity 7: handleAfinidad resuelve JID telefónico real en grupos con @lid', async () => {
    const phoneJid = `52155${Date.now().toString().slice(-8)}@s.whatsapp.net`;
    const lidJid = `999888${Date.now().toString().slice(-8)}@lid`;
    const groupJid = '120363000000000000@g.us';

    // Crear registro con rencor bajo el teléfono real
    await db.adjustUserAffinity(phoneJid, 'AzaelTest', -40, 'Insulto de prueba');

    const origHttp = evolution.client.post;
    let sentMessages = [];

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    try {
        // Enviar webhook como grupo donde key.participant es @lid pero participantAlt es el teléfono
        await handleAfinidad({}, groupJid, {
            key: {
                remoteJid: groupJid,
                participant: lidJid,
                participantAlt: phoneJid
            },
            pushName: 'AzaelTest'
        });

        assert.equal(sentMessages.length, 1);
        const msg = sentMessages[0].text;
        // Debe resolver el perfil del teléfono (-60/100, Rencoroso), NO el -20 del @lid vacío
        assert.ok(msg.includes('AzaelTest'));
        assert.ok(msg.includes('-60/100'), `Debe reportar el score real (-60/100) en lugar del default (-20): ${msg}`);
        assert.ok(msg.includes('Rencoroso y Encabronado'));
    } finally {
        evolution.client.post = origHttp;
    }
});

