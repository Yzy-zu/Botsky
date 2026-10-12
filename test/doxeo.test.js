'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { generateMockDoxeo, handleDoxeo } = require('../src/commands/doxeo');
const { isRegisteredCommand } = require('../src/core/commandRegistry');
const db = require('../src/services/db');
const evolution = require('../src/services/evolution');

test('Doxeo 1: generateMockDoxeo genera reporte técnico serio sin DEVICE VENDOR ni bromas tontas', () => {
    const reportNormal = generateMockDoxeo('@Tester', false);
    const reportRevenge = generateMockDoxeo('@Enemigo', true);

    // Campos técnicos obligatorios
    const requiredFields = [
        'IP:',
        'N:',
        'W:',
        'SS Number:',
        'IPv6:',
        'UPNP:',
        'DMZ:',
        'MAC:',
        'ISP:',
        'DNS:',
        'GATEWAY:',
        'SUBNET MASK:',
        'ROUTER VENDOR:'
    ];

    for (const field of requiredFields) {
        assert.ok(reportNormal.includes(field), `Reporte normal debe incluir ${field}`);
        assert.ok(reportRevenge.includes(field), `Reporte revenge debe incluir ${field}`);
    }

    // Regla estricta del usuario: NO debe incluir DEVICE VENDOR
    assert.ok(!reportNormal.includes('DEVICE VENDOR'), 'NO debe incluir DEVICE VENDOR para no delatar falsedad');
    assert.ok(!reportRevenge.includes('DEVICE VENDOR'), 'NO debe incluir DEVICE VENDOR en revenge');

    // Cero textos de payasada/broma de refri
    assert.ok(!reportNormal.toLowerCase().includes('refri'), 'No debe incluir bromas de refri');
    assert.ok(!reportNormal.toLowerCase().includes('jabón'), 'No debe incluir bromas de jabón');

    // Revenge debe tener mensaje de confrontación
    assert.ok(reportRevenge.includes('aquí a solas'), 'Revenge debe incluir confrontación privada');
    assert.ok(reportRevenge.includes('Quedas advertido'), 'Revenge debe incluir advertencia');
});

test('Doxeo 2: Registro en commandRegistry reconoce aliases', () => {
    assert.ok(isRegisteredCommand('doxeo'), 'doxeo debe estar registrado');
    assert.ok(isRegisteredCommand('doxear'), 'doxear debe estar registrado');
    assert.ok(isRegisteredCommand('doxxeo'), 'doxxeo debe estar registrado');
    assert.ok(isRegisteredCommand('localizar'), 'localizar debe estar registrado');
});

test('Doxeo 3: handleDoxeo extrae menciones o args correctamente', async () => {
    let sentTo = null;
    let sentMsg = null;
    const originalSendText = evolution.sendText;
    evolution.sendText = async (to, msg) => {
        sentTo = to;
        sentMsg = msg;
    };

    try {
        // Caso con mención
        const mockMessageMention = {
            message: {
                extendedTextMessage: {
                    contextInfo: {
                        mentionedJid: ['5214431234567@s.whatsapp.net']
                    }
                }
            }
        };
        await handleDoxeo({}, 'group123@g.us', mockMessageMention);
        assert.equal(sentTo, 'group123@g.us');
        assert.ok(sentMsg.includes('@5214431234567'), 'Debe usar el JID mencionado');

        // Caso con argumento de texto
        await handleDoxeo({ args: ['Juan', 'Perez'] }, 'group123@g.us', {});
        assert.ok(sentMsg.includes('Juan Perez'), 'Debe usar el nombre pasado en args');
    } finally {
        evolution.sendText = originalSendText;
    }
});

test('Doxeo 4: Cooldown de venganza privada en db.js previene spam (24h)', async () => {
    const testJid = `test_revenge_${Date.now()}@s.whatsapp.net`;

    // Inicialmente debe permitir
    const initial = await db.canTriggerPrivateRevenge(testJid);
    assert.equal(initial, true, 'Usuario nuevo debe poder recibir venganza');

    // Registrar venganza
    await db.recordPrivateRevenge(testJid);

    // Inmediatamente después debe bloquear
    const blocked = await db.canTriggerPrivateRevenge(testJid);
    assert.equal(blocked, false, 'Usuario recién vengado debe estar en cooldown');
});
