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
});
test('failed owned request never replays; uncaptioned media keeps legacy owner; full/group cutover refused',async()=>{
 const clock=new FakeClock();let calls=0;
 const service=createPhase4Service({root:'/synthetic',clock,buildGraph:async()=>({app:{pipeline:{handle:async()=>{calls++;throw Error('private provider failure');}}},dispose:async()=>{}})});
 await assert.rejects(service.initialize({PIPELINE_MODE:'v2'}));await assert.rejects(service.initialize({PIPELINE_MODE:'canary',V2_CANARY_CHAT_IDS:['120000001@g.us']}));
 await service.initialize({PIPELINE_MODE:'canary',V2_CANARY_CHAT_IDS:[CHAT]});assert.equal(await service.tryHandle(raw('Botsky qr hola')),true);
 const image={key:{id:'file',remoteJid:CHAT},message:{imageMessage:{url:'opaque-ref'}}};assert.equal(await service.tryHandle(image),false);
 await clock.advance(90000);assert.equal(await service.tryHandle(image),false);assert.equal(calls,1);await service.dispose();
});
