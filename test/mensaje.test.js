'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleMensaje, findGroupContact } = require('../src/commands/mensaje');
const { executeTool, getToolDeclarations } = require('../src/services/toolRegistry');
const evolution = require('../src/services/evolution');

test('Mensaje: findGroupContact resuelve contactos de Gente del señor chiqui', async () => {
    const fer = await findGroupContact('Fernando');
    assert.ok(fer);
    assert.equal(fer.jid, '5214431851495@s.whatsapp.net');

    const lisandro = await findGroupContact('Lisandro');
    assert.ok(lisandro);
    assert.equal(lisandro.jid, '5214435846547@s.whatsapp.net');

    const none = await findGroupContact('PersonaInexistente12345XYZ');
    assert.equal(none, null);
});

test('Mensaje: handleMensaje rechaza no-administradores', async () => {
    let sent = '';
    const origSend = evolution.sendText;
    evolution.sendText = async (to, text) => {
        sent = text;
        return { messageId: 'test_reject' };
    };

    try {
        await handleMensaje(
            { args: ['Fernando', 'hola'] },
            '5219999999999@s.whatsapp.net',
            { key: { participant: '5219999999999@s.whatsapp.net' } }
        );
        assert.match(sent, /Acceso denegado/i);
    } finally {
        evolution.sendText = origSend;
    }
});

test('Mensaje: handleMensaje envía mensaje a contacto para admin', async () => {
    let sentTo = [];
    let sentMessages = [];
    const origSend = evolution.sendText;
    evolution.sendText = async (to, text) => {
        sentTo.push(to);
        sentMessages.push(text);
        return { messageId: 'test_send' };
    };

    try {
        await handleMensaje(
            { args: ['Fernando', 'dile que lo extraño'] },
            '5214435810175@s.whatsapp.net',
            { pushName: 'Azael', key: { participant: '5214435810175@s.whatsapp.net' } }
        );

        // Se envía al destinatario (Fernando)
        assert.ok(sentTo.includes('5214431851495@s.whatsapp.net'));
        const ferMsg = sentMessages.find(m => m.toLowerCase().includes('azael'));
        assert.ok(ferMsg);
        assert.match(ferMsg, /extrañ/i);
        // Debe hablar como Botsky y no como un robot
        assert.ok(!ferMsg.includes('💬 *Mensaje de'));

        // Y se envía confirmación al emisor (Azael)
        assert.ok(sentTo.includes('5214435810175@s.whatsapp.net'));
        const confirmMsg = sentMessages.find(m => m.includes('Mensaje enviado') || m.includes('Ya le escribí'));
        assert.ok(confirmMsg);
    } finally {
        evolution.sendText = origSend;
    }
});

test('Mensaje: executeTool en toolRegistry ejecuta enviar_mensaje_contacto', async () => {
    let sentTo = [];
    const origSend = evolution.sendText;
    evolution.sendText = async (to, text) => {
        sentTo.push(to);
        return { messageId: 'test_tool' };
    };

    try {
        // Bloqueado para no-admin
        const resBlock = await executeTool('enviar_mensaje_contacto', { contacto: 'Fernando', mensaje: 'hola' }, { isAdmin: false });
        assert.match(resBlock.error, /Acceso denegado/i);

        // Permitido para admin
        const resOk = await executeTool(
            'enviar_mensaje_contacto',
            { contacto: 'Fernando', mensaje: 'hola bro' },
            { isAdmin: true, userName: 'Azael' }
        );
        assert.equal(resOk.success, true);
        assert.equal(resOk.destinatario, 'Fernando');
        assert.equal(resOk.jid, '5214431851495@s.whatsapp.net');
        assert.ok(sentTo.includes('5214431851495@s.whatsapp.net'));
    } finally {
        evolution.sendText = origSend;
    }
});

test('Mensaje: findGroupContact resuelve el grupo Gente del señor chiqui', async () => {
    const group = await findGroupContact('el grupo');
    assert.ok(group);
    assert.equal(group.is_group, true);
    assert.equal(group.jid, '120363315296139888@g.us');

    const chiqui = await findGroupContact('chiqui');
    assert.ok(chiqui);
    assert.equal(chiqui.is_group, true);
    assert.equal(chiqui.jid, '120363315296139888@g.us');
});

test('Mensaje: mensaje cizañoso al grupo sale de Botsky y NO menciona al emisor', async () => {
    let sentTo = [];
    let sentMessages = [];
    const origSend = evolution.sendText;
    evolution.sendText = async (to, text) => {
        sentTo.push(to);
        sentMessages.push(text);
        return { messageId: 'test_group' };
    };

    try {
        await handleMensaje(
            { args: ['grupo', 'mentándole la madre a todos'], raw: 'manda un mensaje al grupo mentándole la madre a todos' },
            '5214435810175@s.whatsapp.net',
            { pushName: 'Azael', key: { participant: '5214435810175@s.whatsapp.net' } }
        );

        // Se envía al grupo Gente del señor chiqui
        assert.ok(sentTo.includes('120363315296139888@g.us'));
        const groupMsg = sentMessages.find(m => m.toLowerCase().includes('madre') || m.toLowerCase().includes('bola') || m.toLowerCase().includes('inútil') || m.toLowerCase().includes('chiqui'));
        assert.ok(groupMsg);

        // NO debe delatar a Azael
        assert.ok(!groupMsg.toLowerCase().includes('azael'));
        assert.ok(!groupMsg.toLowerCase().includes('dice azael'));
        assert.ok(!groupMsg.toLowerCase().includes('me manda azael'));
    } finally {
        evolution.sendText = origSend;
    }
});

test('Mensaje: mandales un mensaje al grupo y mientales la madre a Adrian se envía al grupo', async () => {
    let sentTo = [];
    let sentMessages = [];
    const origSend = evolution.sendText;
    evolution.sendText = async (to, text) => {
        sentTo.push(to);
        sentMessages.push(text);
        return { messageId: 'test_group_exact' };
    };

    try {
        await handleMensaje(
            { raw: 'mandales un mensaje al grupo y mientales la madre a todos en especial a Adrian, pero no digas que fui yo' },
            '5214435810175@s.whatsapp.net',
            { pushName: 'Azael', key: { participant: '5214435810175@s.whatsapp.net' } }
        );

        // Se envía al grupo Gente del señor chiqui
        assert.ok(sentTo.includes('120363315296139888@g.us'));
        const groupMsg = sentMessages[0];
        assert.ok(groupMsg);

        // NO debe delatar a Azael
        assert.ok(!groupMsg.toLowerCase().includes('azael'));
    } finally {
        evolution.sendText = origSend;
    }
});

