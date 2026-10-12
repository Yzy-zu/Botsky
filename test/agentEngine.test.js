'use strict';

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { getToolDeclarations, executeTool } = require('../src/services/toolRegistry');
const { runUniversalAgent } = require('../src/services/agentEngine');

test('Tool Registry: getToolDeclarations filtra herramientas de admin según privilegios', () => {
    const regularTools = getToolDeclarations(false)[0].functionDeclarations;
    const adminTools = getToolDeclarations(true)[0].functionDeclarations;

    assert.ok(regularTools.length > 0, 'Debe haber herramientas para usuarios regulares');
    const adminOnly = ['ejecutar_terminal', 'enviar_mensaje_contacto', 'enviar_archivo_contacto'];
    for (const name of adminOnly) {
        assert.ok(!regularTools.some(tool => tool.name === name), `Usuarios regulares NO deben ver ${name}`);
        assert.ok(adminTools.some(tool => tool.name === name), `Administradores SÍ deben tener ${name}`);
    }
    const regularNames = new Set(regularTools.map(tool => tool.name));
    assert.ok(regularTools.every(tool => adminTools.some(adminTool => adminTool.name === tool.name)), 'El administrador conserva las herramientas regulares');
    assert.deepEqual(adminTools.filter(tool => !regularNames.has(tool.name)).map(tool => tool.name).sort(), adminOnly.sort());
});

test('Tool Registry: executeTool maneja herramientas desconocidas con mensaje de error', async () => {
    const res = await executeTool('herramienta_fantasma', {}, {});
    assert.ok(res.error);
    assert.match(res.error, /no está registrada/);
});

test('Tool Registry: executeTool bloquea ejecutar_terminal para no administradores', async () => {
    const res = await executeTool('ejecutar_terminal', { comando: 'id' }, { isAdmin: false });
    assert.ok(res.error);
    assert.match(res.error, /solo el administrador autorizado/);
});

test('Tool Registry [Live]: executeTool google_drive espacio devuelve cuota válida', async () => {
    const res = await executeTool('google_drive', { accion: 'espacio' }, {});
    assert.ok(res.limiteGB, 'Debe contener limiteGB');
    assert.ok(res.usadoGB, 'Debe contener usadoGB');
    assert.ok(res.libreGB, 'Debe contener libreGB');
});

test('Tool Registry [Live]: executeTool minecraft_control telemetria devuelve telemetría viva', async () => {
    const res = await executeTool('minecraft_control', { accion: 'telemetria' }, {});
    assert.equal(typeof res.online, 'boolean');
    assert.ok(res.uptime, 'Debe contener uptime');
    assert.ok(res.latencia_tailscale_ms >= 0, 'Debe medir latencia');
    assert.ok(res.salud_lag, 'Debe incluir salud/lag');
});

test('Tool Registry: executeTool notas_tablon ciclo completo guardar y borrar', async () => {
    const context = {
        from: 'test_unit@s.whatsapp.net',
        senderJid: 'test_user@s.whatsapp.net',
        userName: 'Tester',
        isAdmin: true
    };

    // Guardar
    const saveRes = await executeTool('notas_tablon', { accion: 'guardar', contenido: 'Nota temporal de prueba unitaria' }, context);
    assert.ok(saveRes.success);
    assert.ok(saveRes.nota_id);

    // Borrar
    const delRes = await executeTool('notas_tablon', { accion: 'borrar', id: saveRes.nota_id }, context);
    assert.ok(delRes.success);
});

test('Universal Agent [Live]: Conversación casual no ejecuta herramientas', async () => {
    const res = await runUniversalAgent({
        userMessage: 'hola qué onda Botsky',
        userName: 'Petrov',
        from: 'test_chat@s.whatsapp.net',
        messageData: {},
        isAdmin: false
    });

    assert.equal(res.executedTools.length, 0, 'No debe llamar herramientas en charla casual');
    assert.ok(res.text.length > 5, 'Debe devolver respuesta de texto');
});

test('Universal Agent [Live]: Consulta de telemetría de Minecraft ejecuta tool y sintetiza respuesta', async () => {
    const res = await runUniversalAgent({
        userMessage: 'cuánto tiempo lleva sin reiniciarse el servidor de minecraft?',
        userName: 'Petrov',
        from: 'test_chat@s.whatsapp.net',
        messageData: {},
        isAdmin: false
    });

    assert.ok(res.executedTools.some(t => t.name === 'minecraft_control'), 'Debe haber llamado a minecraft_control');
    assert.ok(res.text.length > 10, 'Debe devolver síntesis conversacional');
    assert.match(res.text, /d[ií]a|hora|reinici|septiembre|tiempo/i, 'Debe contener referencia al tiempo real');
});

test('Tool Registry: executeTool bloquea activar_mod y desactivar_mod para no administradores', async () => {
    const resAct = await executeTool('minecraft_control', { accion: 'activar_mod', mod: 'testMod' }, { isAdmin: false });
    assert.ok(resAct.error);
    assert.match(resAct.error, /Acceso denegado/);

    const resDes = await executeTool('minecraft_control', { accion: 'desactivar_mod', mod: 'testMod' }, { isAdmin: false });
    assert.ok(resDes.error);
    assert.match(resDes.error, /Acceso denegado/);
});
