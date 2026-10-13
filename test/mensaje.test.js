'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const syntheticEnv = { ALLOWED_NUMBERS_ADMIN: '19995550100' };
const logger = { info() {}, warn() {}, error() {} };
function load(file, dependencies) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'), {
        module, exports:module.exports, process:{env:syntheticEnv}, Date, Buffer,
        require(name) { if (!(name in dependencies)) throw new Error('Missing explicit test dependency: '+name); return dependencies[name]; }
    }, {filename:file});
    return module.exports;
}
const auth = load('core/auth.js', {});
const contacts = [
    {jid:'19995550101@s.whatsapp.net',user_name:'Fernando'},
    {jid:'19995550102@s.whatsapp.net',user_name:'Lisandro'}
];
const database = { db:{ all(sql,params,callback) { callback(null,contacts.filter(contact=>contact.user_name.toLowerCase().includes(params[0].replace(/%/g,'')))); } } };
const evolution = {sendText:async()=>({key:{id:'synthetic-default'}}),getGroupInfo:async()=>({data:{participants:contacts.map(contact=>({id:contact.jid,name:contact.user_name}))}})};
const ai = {
    async callGemini({userMessage}) { return userMessage.includes('para enviar a el grupo') ? 'Bola de inútiles, dejen de mentar madres.' : 'Qué onda Fernando, dice Azael que te extraña.'; },
    async callGroq() { assert.fail('Unexpected fallback model'); },
    async routeWithAI() { return {action:'mensaje',args:{destino_scope:'main_group',mensaje:'Mientales la madre a todos',anonimo:true}}; }
};
let outbound;
const mensaje = load('commands/mensaje.js', {'../services/evolution':evolution,'../core/auth':auth,'../services/db':database,'../services/logger':logger,'../services/ai':ai,
    '../services/outboundDelivery':{deliverSemantic:options=>outbound.deliverSemantic(options)}});
outbound = load('services/outboundDelivery.js',{'./evolution':evolution,'./logger':logger,'../core/auth':auth,'../commands/mensaje':mensaje});
const {handleMensaje,findGroupContact}=mensaje;
const {executeTool,getToolDeclarations}=load('services/toolRegistry.js',{'./logger':logger,'./db':database,'./evolution':evolution,
    '../utils/messageText':{resolveMessageText:(text)=>text||''},'../utils/reminderInput':{},'../core/auth':auth,'../commands/mensaje':mensaje});

test('Mensaje: findGroupContact resuelve contactos de Gente del señor chiqui', async () => {
    const fer = await findGroupContact('Fernando');
    assert.ok(fer);
    assert.equal(fer.jid, '19995550101@s.whatsapp.net');

    const lisandro = await findGroupContact('Lisandro');
    assert.ok(lisandro);
    assert.equal(lisandro.jid, '19995550102@s.whatsapp.net');

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
            '19995550199@s.whatsapp.net',
            { key: { participant: '19995550199@s.whatsapp.net' } }
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
            '19995550100@s.whatsapp.net',
            { pushName: 'Azael', key: { participant: '19995550100@s.whatsapp.net' } }
        );

        // Se envía al destinatario (Fernando)
        assert.ok(sentTo.includes('19995550101@s.whatsapp.net'));
        const ferMsg = sentMessages.find(m => m.toLowerCase().includes('azael'));
        assert.ok(ferMsg);
        assert.match(ferMsg, /extrañ/i);
        // Debe hablar como Botsky y no como un robot
        assert.ok(!ferMsg.includes('💬 *Mensaje de'));

        // Y se envía confirmación al emisor (Azael)
        assert.ok(sentTo.includes('19995550100@s.whatsapp.net'));
        const confirmMsg = sentMessages.find(m => m.toLowerCase().includes('mensaje enviado') || m.toLowerCase().includes('ya le escribí'));
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
        const resBlock = await executeTool('enviar_mensaje_contacto', { contacto: 'Fernando', mensaje: 'hola' }, { isAdmin: false, from:'19995550199@s.whatsapp.net',messageData:{key:{participant:'19995550199@s.whatsapp.net'}} });
        assert.match(resBlock.error, /Acceso denegado/i);

        // Permitido para admin
        const resOk = await executeTool(
            'enviar_mensaje_contacto',
            { contacto: 'Fernando', mensaje: 'hola bro' },
            { isAdmin: true, userName: 'Azael', from:'19995550100@s.whatsapp.net',messageData:{pushName:'Azael',key:{participant:'19995550100@s.whatsapp.net'}} }
        );
        assert.equal(resOk.success, true);
        assert.equal(resOk.destinatario, 'Fernando');
        assert.equal(resOk.jid, '19995550101@s.whatsapp.net');
        assert.ok(sentTo.includes('19995550101@s.whatsapp.net'));
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
            '19995550100@s.whatsapp.net',
            { pushName: 'Azael', key: { participant: '19995550100@s.whatsapp.net' } }
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
            '19995550100@s.whatsapp.net',
            { pushName: 'Azael', key: { participant: '19995550100@s.whatsapp.net' } }
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



test('Mensaje: forged admin and sender claims cannot authorize tool delivery',async()=>{
    let sends=0;const original=evolution.sendText;evolution.sendText=async()=>{sends++;return{key:{id:'forged'}}};
    try {
        const result=await executeTool('enviar_mensaje_contacto',{contacto:'Fernando',mensaje:'fake'},
            {isAdmin:true,senderJid:'19995550100@s.whatsapp.net',from:'19995550199@s.whatsapp.net',messageData:{key:{participant:'19995550199@s.whatsapp.net'}}});
        assert.equal(result.success,false);assert.match(result.error,/Acceso denegado/i);assert.equal(sends,0);
    } finally {evolution.sendText=original;}
    assert.equal(await findGroupContact('grupo desconocido XYZ'),null);
});

test('Mensaje: tool arguments with cycles, BigInt or accessors fail before delivery',async()=>{
    const circular={contacto:'Fernando',mensaje:'no enviar'};circular.self=circular;
    let reads=0;const accessor={contacto:'Fernando',get mensaje(){reads++;throw Error('getter must not run');}};
    const context={from:'19995550100@s.whatsapp.net',messageData:{key:{participant:'19995550100@s.whatsapp.net'}}};
    let sends=0;const original=evolution.sendText;evolution.sendText=async()=>{sends++;return{key:{id:'bad-input'}}};
    try {
        for(const args of [circular,{contacto:'Fernando',mensaje:'no enviar',amount:1n},accessor]){
            const result=await executeTool('enviar_mensaje_contacto',args,context);
            assert.equal(result.success,false);assert.match(result.error,/inválidos/i);
        }
        assert.equal(reads,0);assert.equal(sends,0);
    } finally {evolution.sendText=original;}
});

test('Mensaje: absent chat and forged terminal admin return errors without loading terminal',async()=>{
    const absent=await executeTool('ejecutar_terminal',{comando:'id'},null);
    assert.equal(absent.success,false);assert.match(absent.error,/chat autenticado/i);
    const forged=await executeTool('ejecutar_terminal',{comando:'id'},
        {isAdmin:true,from:'19995550199@s.whatsapp.net',messageData:{key:{participant:'19995550199@s.whatsapp.net'}}});
    assert.equal(forged.success,false);assert.match(forged.error,/Acceso denegado/i);
});


test('Mensaje: telemetry wrapper rejects getters without evaluating them and never duplicates tool execution',async()=>{
    const enabledEnv=syntheticEnv.LEGACY_COMMAND_USAGE_ENABLED;
    syntheticEnv.LEGACY_COMMAND_USAGE_ENABLED='true';
    let reads=0;let tracks=0;let sends=0;const original=evolution.sendText;
    evolution.sendText=async()=>{sends++;return{key:{id:'telemetry-only-once'}}};
    const registry=load('services/toolRegistry.js',{'./logger':logger,'./db':database,'./evolution':evolution,
        '../utils/messageText':{resolveMessageText:text=>text||''},'../utils/reminderInput':{},'../core/auth':auth,'../commands/mensaje':mensaje,
        './commandUsageRuntime':{trackTool(name,args,context,run){tracks++;run();throw Error('Synthetic telemetry failure after operation start');}}});
    const context={from:'19995550100@s.whatsapp.net',messageData:{key:{participant:'19995550100@s.whatsapp.net'}}};
    try{
        const result=await registry.executeTool('enviar_mensaje_contacto',{contacto:'Fernando',mensaje:'hola'},context);
        assert.equal(result.success,true);assert.equal(tracks,1);assert.equal(sends,2,'One delivery and one confirmation');
        const invalid=await registry.executeTool('enviar_mensaje_contacto',{get contacto(){reads++;throw Error('must not read');}},context);
        assert.equal(invalid.success,false);assert.equal(reads,0);assert.equal(tracks,1);assert.equal(sends,2);
    }finally{evolution.sendText=original;if(enabledEnv===undefined)delete syntheticEnv.LEGACY_COMMAND_USAGE_ENABLED;else syntheticEnv.LEGACY_COMMAND_USAGE_ENABLED=enabledEnv;}
});
