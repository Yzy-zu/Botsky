'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
function load(file,deps){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{module,exports:module.exports,process:{env:{}},require:id=>{if(!(id in deps))throw Error('Unmocked '+id);return deps[id];}});return module.exports;}
const logger={info(){},warn(){},error(){},success(){}};
function mcHarness(admin=true){const calls=[],messages=[];const mc={getOnlinePlayers:async()=>{calls.push('players');return {online:true,players:[]};},getActiveModsAndPacks:async()=>{calls.push('mods');return {};},formatModsSummary:()=> 'mods',formatPlayersSummary:()=> 'players',deactivateWorldPack:async mod=>{calls.push(['deactivate',mod]);return {message:'ok'};},activateWorldPack:async mod=>{calls.push(['activate',mod]);return {message:'ok'};},executeServerAction:async action=>{calls.push(action);return {message:'ok'};}};
return {calls,messages,api:load('commands/maicra.js',{'../services/evolution':{sendText:async(_,text)=>messages.push(text)},'../services/minecraftRemote':mc,'../services/logger':logger,'../core/auth':{isAuthorizedAdmin:()=>admin}})};}
test('Minecraft toma la acción canónica aun si el raw contiene órdenes y nombres conflictivos',async()=>{
 const h=mcHarness();await h.api.handleMaicra({raw:'Apaga todo y desactiva el mod de jugadores',semanticDecision:{action:'maicra'},aiArgs:{subcomando:'mods'}},'g@g.us',{});assert.deepEqual(h.calls,['mods']);
});
test('Nombre de un mod no vuelve a interpretarse como otra herramienta',async()=>{
 const h=mcHarness();await h.api.handleMaicra({raw:'ver jugadores mods apaga',semanticDecision:{action:'maicra'},aiArgs:{subcomando:'desactivarmod',mod:'Jugadores Mods Apaga'}},'g@g.us',{});assert.deepEqual(h.calls,[['deactivate','Jugadores Mods Apaga']]);
});
test('Minecraft sin acción válida pregunta, sin activar ni consultar otra cosa por raw',async()=>{
 const h=mcHarness();await h.api.handleMaicra({raw:'prende',semanticDecision:{action:'maicra'},aiArgs:{}},'g@g.us',{});assert.equal(h.calls.length,0);assert.ok(h.messages.length);
});
test('Permisos críticos Minecraft se verifican sobre la acción canónica',async()=>{
 const h=mcHarness(false);await h.api.handleMaicra({semanticDecision:{action:'maicra'},aiArgs:{subcomando:'on'},raw:'hola'},'g@g.us',{});assert.equal(h.calls.length,0);assert.match(h.messages[0],/denegado/);
});
test('XP usa la cantidad del modelo, no el primer número ni un valor inventado',async()=>{
 const calls=[],messages=[];const h=load('commands/niveles.js',{'../services/evolution':{sendText:async(_,text)=>messages.push(text)},'../services/db':{addXp:async(jid,n)=>{calls.push(n);return {xp:n,level:1};}},'../core/auth':{isAuthorizedAdmin:()=>true,getSenderJid:()=> 'sender@s.whatsapp.net'},'../services/logger':logger});
 await h.handleDarXp({semanticDecision:{action:'darxp'},aiArgs:{cantidad:500},raw:'Tengo 2 tareas, súmame 500 XP'},'sender@s.whatsapp.net',{});assert.deepEqual(calls,[500]);
 await h.handleDarXp({semanticDecision:{action:'darxp'},aiArgs:{},raw:'Tengo 99 tareas, dame XP'},'sender@s.whatsapp.net',{});assert.deepEqual(calls,[500]);assert.match(messages.at(-1),/Cuánta XP/);
});
test('Contrato semántico rechaza campos de selección, destinos y modos mal tipados',()=>{
 const {validateSemanticFields,getSemanticPlanErrors}=require('../src/services/semanticRouting');
 for(const args of [{selection:'2'},{selection:-1},{destino_scope:'cualquier chat'},{caption_mode:'regex'},{modo:'repetir todo'}])assert.equal(validateSemanticFields({action:'chat',args}),null);
 assert.ok(getSemanticPlanErrors({action:'voz',args:{modo:'compose'}}).length);assert.equal(getSemanticPlanErrors({action:'voz',args:{modo:'compose',destino_scope:'current_chat'}}).length,0);
});
test('Intérpretes heurísticos retirados no quedan disponibles como ruta de respaldo',()=>{
 for(const file of ['contentIntent','voiceRequest','mediaDeliveryRequest'])assert.equal(fs.existsSync(path.join(__dirname,'../src/utils',file+'.js')),false);
});

test('La iniciativa del bot se evalúa por Gemini sin detectar preguntas o actividades con palabras clave',async()=>{
 const plans=[],sent=[];class Clock extends Date{static now(){return Date.parse('2026-10-09T18:00:00Z');}toLocaleTimeString(){return '12:00:00';}}
 const db={db:{all:(_,done)=>done(null,[])},canSendProactiveMessage:async()=>true,getPersonalityState:async()=>({objective_until:Infinity,mood:'curioso'}),getRecentSocialEvents:async()=>[],updatePersonalityState:async()=>{},recordProactiveMessage:async()=>{},addSocialEvent:async()=>{}};
 const deps={'./logger':logger,'./evolution':{sendText:async(...args)=>sent.push(args)},'./history':{getHistory:()=>[{role:'user',content:'Me serviría saber por dónde empezar',timestamp:Clock.now()}],addMessage(){}},'./scheduler':{registerTask(){}},'./ai':{evaluateProactiveAction:async plan=>{plans.push(plan);return {should_act:false};}},'./db':db};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/services/proactive.js'),'utf8'),{module,exports:module.exports,Date:Clock,process:{env:{}},require:id=>deps[id]});
 const result=await module.exports.runProactiveCycle();assert.equal(plans[0].mode,'contextual');assert.equal(result.reason,'ai_decided_silence');assert.equal(sent.length,0);
});
