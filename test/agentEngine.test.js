'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {loadModule}=require('./aiOfflineHarness.test');
const logger={info(){},warn(){},error(){}};
const notes=new Map();let nextNote=1;
const db={addNote:async(from,sender,name,content)=>{const id=nextNote++;notes.set(id,{id,chat_id:from,content});return{id};},getNotes:async()=>[...notes.values()],deleteNote:async(_from,id)=>notes.delete(id)};
const mcCalls=[];
const registry=loadModule('services/toolRegistry.js',{
    './logger':logger,'./db':db,'./evolution':{sendText:async()=>{}},
    '../core/auth':loadModule('core/auth.js',{}, {env:{ALLOWED_NUMBERS_ADMIN:'19995550001'}}),
    '../utils/messageText':loadModule('utils/messageText.js',{'./whatsappText':loadModule('utils/whatsappText.js',{})}),
    '../utils/reminderInput':loadModule('utils/reminderInput.js',{'./messageText':loadModule('utils/messageText.js',{'./whatsappText':loadModule('utils/whatsappText.js',{})})}),
    './minecraftRemote':{getRemoteServerStatus:async()=>{mcCalls.push('status');return{online:true,uptime:'2 horas',latencyMs:3,lag:'saludable'};},getOnlinePlayers:async()=>({players:[],count:0,max:10}),getActiveModsAndPacks:async()=>({behaviorPacks:[],resourcePacks:[]})},
    './drive':{getQuota:async()=>({limiteGB:15,usadoGB:2,libreGB:13})},
    './commandUsageRuntime':{trackTool:(_name,_args,_context,run)=>run()}
});
const {getToolDeclarations,executeTool}=registry;
let planTelemetry=false;const plannerCalls=[];
const ai={getConfiguredApiKeys:()=>['offline'],formatHistoryForPrompt:()=>'',callGemini:async options=>{plannerCalls.push(structuredClone(options));const answered=options.contents.some(c=>c.parts.some(p=>p.functionResponse));return{role:'model',parts:planTelemetry&&!answered?[{functionCall:{name:'minecraft_control',args:{accion:'telemetria'}}}]:[{text:'discard planner voice'}]};},chatWithBotsky:async(_request,_name,_group,_history,_media,_affinity,ctx)=>ctx.toolResults.length?`Tiempo activo: ${ctx.toolResults[0].result.uptime}`:'Qué onda, aquí ando.'};
const {runUniversalAgent}=loadModule('services/agentEngine.js',{'./logger':logger,'./ai':ai,'./conversationStyle':require('../src/services/conversationStyle'),'./aiConfig':{getAiConfig:()=>({})},'./toolRegistry':registry});

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
    assert.deepEqual(Array.from(adminTools.filter(tool => !regularNames.has(tool.name)).map(tool => tool.name).sort()), adminOnly.sort());
});

test('Tool Registry: executeTool maneja herramientas desconocidas con mensaje de error', async () => {
    const res = await executeTool('herramienta_fantasma', {}, {});
    assert.ok(res.error);
    assert.match(res.error, /no está registrada/);
});

test('Tool Registry: executeTool bloquea ejecutar_terminal para no administradores', async () => {
    const res = await executeTool('ejecutar_terminal', { comando: 'id' }, { from:'19995550002@s.whatsapp.net',messageData:{key:{participant:'19995550002@s.whatsapp.net'}},isAdmin:false });
    assert.ok(res.error);
    assert.match(res.error, /solo el administrador autorizado/);
});

test('Tool Registry [Offline]: executeTool google_drive espacio devuelve cuota válida', async () => {
    const res = await executeTool('google_drive', { accion: 'espacio' }, {from:'offline@s.whatsapp.net'});
    assert.ok(res.limiteGB, 'Debe contener limiteGB');
    assert.ok(res.usadoGB, 'Debe contener usadoGB');
    assert.ok(res.libreGB, 'Debe contener libreGB');
});

test('Tool Registry [Offline]: executeTool minecraft_control telemetria devuelve telemetría viva', async () => {
    const res = await executeTool('minecraft_control', { accion: 'telemetria' }, {from:'offline@s.whatsapp.net'});
    assert.equal(typeof res.online, 'boolean');
    assert.ok(res.uptime, 'Debe contener uptime');
    assert.ok(res.latencia_tailscale_ms >= 0, 'Debe medir latencia');
    assert.ok(res.salud_lag, 'Debe incluir salud/lag');
});

test('Tool Registry: executeTool notas_tablon ciclo completo guardar y borrar', async () => {
    const context = {
        from: 'test_unit@s.whatsapp.net',
        senderJid: '19995550001@s.whatsapp.net',
        userName: 'Tester',
        isAdmin: true, messageData:{key:{participant:'19995550001@s.whatsapp.net'}}
    };

    // Guardar
    const saveRes = await executeTool('notas_tablon', { accion: 'guardar', contenido: 'Nota temporal de prueba unitaria' }, context);
    assert.ok(saveRes.success);
    assert.ok(saveRes.nota_id);

    // Borrar
    const delRes = await executeTool('notas_tablon', { accion: 'borrar', id: saveRes.nota_id }, context);
    assert.ok(delRes.success);
});

test('Universal Agent [Offline]: Conversación casual no ejecuta herramientas', async () => {
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

test('Universal Agent [Offline]: Consulta de telemetría de Minecraft ejecuta tool y sintetiza respuesta', async () => {
    planTelemetry=true;mcCalls.length=0;
    const res = await runUniversalAgent({
        userMessage: 'cuánto tiempo lleva sin reiniciarse el servidor de minecraft?',
        userName: 'Petrov',
        from: 'test_chat@s.whatsapp.net',
        messageData: {},
        isAdmin: false
    });

    assert.ok(res.executedTools.some(t => t.name === 'minecraft_control'), 'Debe haber llamado a minecraft_control');
    assert.ok(res.text.length > 10, 'Debe devolver síntesis conversacional');
    assert.equal(mcCalls.length,1);assert.equal(plannerCalls.at(-1).contents.at(-1).parts[0].functionResponse.name,'minecraft_control');
    planTelemetry=false;
    assert.match(res.text, /d[ií]a|hora|reinici|septiembre|tiempo/i, 'Debe contener referencia al tiempo real');
});

test('Tool Registry: executeTool bloquea activar_mod y desactivar_mod para no administradores', async () => {
    const resAct = await executeTool('minecraft_control', { accion: 'activar_mod', mod: 'testMod' }, {from:'offline@s.whatsapp.net'});
    assert.ok(resAct.error);
    assert.match(resAct.error, /Acceso denegado/);

    const resDes = await executeTool('minecraft_control', { accion: 'desactivar_mod', mod: 'testMod' }, {from:'offline@s.whatsapp.net'});
    assert.ok(resDes.error);
    assert.match(resDes.error, /Acceso denegado/);
});
