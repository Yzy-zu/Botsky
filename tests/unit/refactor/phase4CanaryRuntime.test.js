'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createPhase4Service}=require('../../../src/services/phase4CanaryRuntime');
const {FakeClock}=require('../../../src/v2/platform/clock');
const CHAT='19995550101@s.whatsapp.net';
const raw=(text,chat=CHAT)=>({key:{id:'m',remoteJid:chat},message:{conversation:text}});
test('legacy import/startup does not construct graph; private canary owns only its selected wave',async()=>{
 const clock=new FakeClock();const calls=[];let builds=0,disposed=0;
 const service=createPhase4Service({root:'/synthetic',clock,buildGraph:async()=>{builds++;return{app:{pipeline:{handle:async input=>calls.push(input)}},dispose:async()=>{disposed++;}};}});
 assert.deepEqual(await service.initialize({PIPELINE_MODE:'legacy'}),{enabled:false});assert.equal(builds,0);
 await service.initialize({PIPELINE_MODE:'canary',V2_CANARY_CHAT_IDS:[CHAT]});assert.equal(builds,1);
 assert.equal(await service.tryHandle(raw('Botsky crea un QR hola')),true);
 assert.equal(await service.tryHandle(raw('Botsky crea un QR','19995550102@s.whatsapp.net')),false);
 assert.equal(await service.tryHandle(raw('Botsky recordatorio mañana')),false);
 assert.equal(await service.tryHandle(raw('Botsky estado de minecraft')),false);
 assert.equal(await service.tryHandle(raw('Botsky voz hola')),false);
 assert.equal(await service.tryHandle(raw('Botsky lee un QR')),false);
 assert.equal(await service.tryHandle({key:{id:'quote',remoteJid:CHAT},message:{ephemeralMessage:{message:{extendedTextMessage:{text:'Botsky qr',contextInfo:{stanzaId:'media'}}}}}}),false);
 assert.equal(await service.tryHandle(raw('Botsky qr minecraft --to otro-chat')),true);
 assert.equal(calls.length,2);await service.dispose();assert.equal(disposed,1);
 assert.equal(await service.tryHandle(raw('estado')),true);
 assert.equal(await service.tryHandle(raw('voz hola')),false);
});
test('failed owned request never replays; uncaptioned media keeps legacy owner; full/group cutover refused',async()=>{
 const clock=new FakeClock();let calls=0;
 const service=createPhase4Service({root:'/synthetic',clock,buildGraph:async()=>({app:{pipeline:{handle:async()=>{calls++;throw Error('private provider failure');}}},dispose:async()=>{}})});
 await assert.rejects(service.initialize({PIPELINE_MODE:'v2'}));await assert.rejects(service.initialize({PIPELINE_MODE:'canary',V2_CANARY_CHAT_IDS:['120000001@g.us']}));
 await service.initialize({PIPELINE_MODE:'canary',V2_CANARY_CHAT_IDS:[CHAT]});assert.equal(await service.tryHandle(raw('Botsky qr hola')),true);
 const image={key:{id:'file',remoteJid:CHAT},message:{imageMessage:{url:'opaque-ref'}}};assert.equal(await service.tryHandle(image),false);
 await clock.advance(90000);assert.equal(await service.tryHandle(image),false);assert.equal(calls,1);await service.dispose();
});

const config={PIPELINE_MODE:'canary',V2_CANARY_CHAT_IDS:[CHAT]};
test('shutdown waits for asynchronous startup and never publishes a late owner',async()=>{
 let finish,disposed=0,calls=0,drained=false;
 const pending=new Promise(resolve=>{finish=resolve;});
 const service=createPhase4Service({root:'/synthetic',clock:new FakeClock(),buildGraph:()=>pending});
 const starting=service.initialize(config);
 const closing=service.dispose().then(()=>{drained=true;});
 await Promise.resolve();assert.equal(drained,false);
 assert.equal(await service.tryHandle(raw('Botsky qr hola')),false);
 finish({app:{pipeline:{handle:async()=>{calls++;}}},dispose:async()=>{disposed++;}});
 assert.deepEqual(await starting,{enabled:false});await closing;
 assert.equal(disposed,1);assert.equal(calls,0);assert.equal(service.status.enabled,false);
 assert.deepEqual(service.status.features,[]);
 await service.dispose();assert.equal(disposed,1);
 await assert.rejects(service.initialize(config),/lifecycle/);
});
test('concurrent startup is rejected; failed startup can retry without stale feature flags',async()=>{
 let fail,builds=0,disposed=0;
 const pending=new Promise((resolve,reject)=>{fail=reject;});
 const service=createPhase4Service({root:'/synthetic',clock:new FakeClock(),buildGraph:()=>{
  builds++;return builds===1?pending:Promise.resolve({app:{pipeline:{handle:async()=>({kind:'reply'})}},dispose:async()=>{disposed++;}});
 }});
 const first=service.initialize({...config,V2_CANARY_FEATURES:['voice']});
 await assert.rejects(service.initialize(config),/lifecycle/);assert.equal(builds,1);
 fail(Error('synthetic startup failure'));await assert.rejects(first,/synthetic/);
 assert.deepEqual(service.status.features,[]);
 await service.initialize(config);assert.equal(builds,2);assert.equal(await service.tryHandle(raw('voz hola')),false);
 assert.equal(await service.tryHandle(raw('estado')),true);await service.dispose();assert.equal(disposed,1);
});
test('shutdown drains resources and reports a synchronous disposer failure',async()=>{
 const service=createPhase4Service({root:'/synthetic',clock:new FakeClock(),buildGraph:async()=>({app:{pipeline:{handle:async()=>{}}},dispose:()=>{throw Error('synthetic disposal failure');}})});
 await service.initialize(config);await assert.rejects(service.dispose(),/synthetic disposal/);
 assert.equal(service.status.enabled,false);assert.deepEqual(service.status.features,[]);
 assert.equal(await service.tryHandle(raw('estado')),true);
});

test('shutdown runs runtime disposal concurrently with the accepted owner drain',async()=>{
 let release,entered;const running=new Promise(resolve=>{entered=resolve;});
 const pending=new Promise(resolve=>{release=resolve;});let disposed=0;
 const service=createPhase4Service({root:'/synthetic',clock:new FakeClock(),buildGraph:async()=>({
  app:{pipeline:{handle:async()=>{entered();await pending;return{kind:'ignore'};}}},
  dispose:async()=>{disposed++;release();}
 })});
 await service.initialize(config);const handling=service.tryHandle(raw('estado'));await running;
 await service.dispose();assert.equal(await handling,true);assert.equal(disposed,1);
 assert.equal(service.status.enabled,false);assert.equal(service.status.counters.handled,1);
});
