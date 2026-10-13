'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {harness,proactiveHarness,loadModule,gemini}=require('./aiOfflineHarness.test');
const h=harness();const ai=h.ai;const {isAllowedPrivateTarget}=proactiveHarness().api;
test('Observación 1: Router aísla contexto por usuario/chat sin reutilizar intenciones', async () => {
    const local=harness({post:async(_url,payload)=>{const input=JSON.parse(payload.contents[0].parts[0].text);return gemini(JSON.stringify({action:'descargar',args:{query:input.contexto.historial[0].content},addressed_to_bot:true}));}});
    const first=await local.ai.routeWithAI('misma petición','PersonaA',false,[{role:'user',content:'contextoA'}],null,null,'userA','chatA');
    const second=await local.ai.routeWithAI('misma petición','PersonaB',true,[{role:'user',content:'contextoB'}],null,null,'userB','chatB');
    assert.equal(first.args.query,'contextoA');assert.equal(second.args.query,'contextoB');assert.equal(local.calls.length,2);
    assert.equal(JSON.parse(local.calls[0][1].contents[0].parts[0].text).usuario,'PersonaA');
});

test('Router: rechaza acciones desconocidas y argumentos no escalares', () => {
    assert.equal(ai.validateAiDecision({ action: 'inventar_comando', args: {} }), null);
    assert.equal(ai.validateAiDecision({ action: 'info', args: { query: { nested: true } } }), null);
    assert.equal(ai.validateAiDecision({ action: 'info', args: { cantidad: -1 } }), null);
    assert.equal(ai.validateAiDecision({ action: 'video', args: {} }).action, 'descargar');
});

test('Router: conserva sólo metadatos internos seguros para diagnóstico', () => {
    const decision = ai.validateAiDecision({
        action: 'info',
        confidence: 0.92,
        reason_code: 'explicit_command'
    });
    assert.equal(decision.confidence, 0.92);
    assert.equal(decision.reason_code, 'explicit_command');
    assert.equal(ai.validateAiDecision({ action: 'info', confidence: 4 }).confidence, null);
    assert.equal(ai.validateAiDecision({ action: 'info', reason_code: 'bad code\nsecret' }).reason_code, 'unspecified');
});

test('Router: permite opciones controladas sólo para encuestas', () => {
    const decision = ai.validateAiDecision({
        action: 'encuesta',
        args: { pregunta: '¿Qué hacemos?', opciones: ['Minecraft', 'Película'] }
    });
    assert.deepEqual(decision.args.opciones, ['Minecraft', 'Película']);
    assert.equal(ai.validateAiDecision({ action: 'info', args: { opciones: ['A', 'B'] } }), null);
});

test('Router: tareas visuales conservan plan semántico sin confundir sticker explícito', async () => {
    const local=harness({post:async(_url,payload)=>{const input=JSON.parse(payload.contents[0].parts[0].text);const sticker=input.peticion==='hazme sticker';return gemini(JSON.stringify({action:sticker?'sticker':'chat',args:{},addressed_to_bot:true,uses_attachment:true,attachment_id:'file-id',content_intent:sticker?'transform':'analysis'}));}});
    for(const text of ['haz el ejercicio de la foto','¿qué significa esto?','hazme sticker']){
        const result=await local.ai.routeWithAI(text,'Persona',false,[],{type:'imageMessage',mimetype:'image/jpeg',attachmentId:'file-id'});
        assert.equal(result.action,text==='hazme sticker'?'sticker':'chat');assert.equal(result.attachment_id,'file-id');
        assert.equal(JSON.parse(local.calls.at(-1)[1].contents[0].parts[0].text).contexto.adjunto_actual.id,'file-id');
    }
});

test('Proactivo: sólo permite destinatarios presentes en rencores activos', () => {
    const grudges = [{ jid: '5215512345678@s.whatsapp.net' }];
    assert.equal(isAllowedPrivateTarget('5215512345678@s.whatsapp.net', grudges), true);
    assert.equal(isAllowedPrivateTarget('5215512345678:2@s.whatsapp.net', grudges), true);
    assert.equal(isAllowedPrivateTarget('5215512345679@s.whatsapp.net', grudges), false);
    assert.equal(isAllowedPrivateTarget('5215512345678@g.us', grudges), false);
});

test('Observación 2: evaluateProactiveAction aplica rate-limit a resultados semánticos', async () => {
    const local=harness({post:async()=>gemini(JSON.stringify({should_act:true,channel:'group',message:'Mensaje contextual',reason:'context'}))});
    const first=await local.ai.evaluateProactiveAction({idleMinutes:90});const second=await local.ai.evaluateProactiveAction({idleMinutes:91});
    assert.equal(first.should_act,true);assert.equal(second.should_act,false);assert.equal(second.reason,'rate_limited_cooldown');
    assert.equal((await local.ai.evaluateProactiveAction({idleMinutes:92,bypassCooldown:true})).should_act,true);
});

test('Observación 3: Fallo visual conserva referencia y no consulta respaldo sin imagen', async () => {
    const local=harness({post:async()=>{throw Object.assign(Error('fake unavailable'),{response:{status:400}});}});
    const reply=await local.ai.chatWithBotsky('¿qué ves en esta foto?','Persona',false,[],{type:'imageMessage',mimetype:'image/jpeg',base64:'aW1hZ2U='});
    assert.match(reply,/No pude analizar la imagen/);assert.match(reply,/conservé la referencia/);
    assert.equal(local.calls.length,1);assert.ok(!local.logs.join('').includes('Persona'));
});

test('Problema A: handleTerminal preserva el verbo y texto completo en lenguaje natural', async () => {
    let passedPrompt='';
    const {handleTerminal}=loadModule('commands/terminal.js',{'../services/agent':{runAgentWithTerminal:async({userMessage})=>{passedPrompt=userMessage;return{text:'ok'};}},'../services/evolution':{sendText:async()=>{},sendTyping:async()=>{}},'../services/logger':{info(){},error(){}},'../services/history':{getHistory:()=>[]},'../core/auth':{isAuthorizedAdmin:()=>true,getSenderJid:()=> 'offline-admin@s.whatsapp.net'}});
    const mockMessageData = {
        key: { participant: '5214435810175@s.whatsapp.net' },
        pushName: 'Admin'
    };

    try {
        // Caso 1: Lenguaje natural general ("reinicia el contenedor de minecraft")
        // parser tradicionalmente dejaba command: 'reinicia', args: ['el', 'contenedor', 'de', 'minecraft']
        const naturalParsed1 = {
            command: 'terminal',
            originalCommand: 'reinicia',
            hasPrefix: false,
            args: ['el', 'contenedor', 'de', 'minecraft'],
            raw: 'reinicia el contenedor de minecraft'
        };
        await handleTerminal(naturalParsed1, '120363432759815247@g.us', mockMessageData);
        assert.equal(passedPrompt, 'reinicia el contenedor de minecraft', 'Debe conservar el verbo "reinicia" completo');

        // Caso 2: Otra orden en lenguaje natural ("apaga el servicio redis de inmediato")
        const naturalParsed2 = {
            command: 'terminal',
            originalCommand: 'apaga',
            hasPrefix: false,
            args: ['el', 'servicio', 'redis', 'de', 'inmediato'],
            raw: 'apaga el servicio redis de inmediato'
        };
        await handleTerminal(naturalParsed2, '120363432759815247@g.us', mockMessageData);
        assert.equal(passedPrompt, 'apaga el servicio redis de inmediato', 'Debe conservar el verbo "apaga" completo');

        // Caso 3: Comando explícito con prefijo (/@terminal docker ps -a)
        const explicitParsed = {
            command: 'terminal',
            originalCommand: 'terminal',
            hasPrefix: true,
            args: ['docker', 'ps', '-a'],
            raw: '/@terminal docker ps -a'
        };
        await handleTerminal(explicitParsed, '120363432759815247@g.us', mockMessageData);
        assert.equal(passedPrompt, 'docker ps -a', 'Comandos con prefijo deben extraer solo los argumentos');
    } finally { /* VM owns all dependencies; no shared globals modified. */ }
});


test('Proactivo rechaza should_act/channel mal tipados sin convertir strings en intervención',async()=>{
    for(const proposal of [
        {should_act:'false',channel:'group',message:'No autorizado'},
        {should_act:true,channel:'unexpected',message:'No autorizado'},
        {should_act:true,channel:'group',message:42},
        {should_act:true,channel:'private',message:'No autorizado',target_jid:42}
    ]){
        const local=harness({post:async()=>gemini(JSON.stringify(proposal))});
        const result=await local.ai.evaluateProactiveAction({mode:'contextual'});
        assert.equal(result.should_act,false);
    }
});
