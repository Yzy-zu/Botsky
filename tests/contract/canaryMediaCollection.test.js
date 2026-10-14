'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPhase4Service}=require('../../src/services/phase4CanaryRuntime');
const {createApplication}=require('../../src/v2/main');
const {createWaveAFeatures}=require('../../src/v2/features');
const {FakeClock}=require('../../src/v2/platform/clock');
const {TtlStore}=require('../../src/v2/platform/ttlStore');
const CHAT='19995550101@s.whatsapp.net',BOT='19995550000@s.whatsapp.net';
const text=(id,value)=>({key:{id,remoteJid:CHAT},message:{conversation:value}});
const image=(id,caption='')=>({key:{id,remoteJid:CHAT},message:{imageMessage:{url:'opaque:'+id,mimetype:'image/png',caption}}});
test('complete private media canary keeps a multi-event PDF collection with one owner and no legacy replay',async()=>{
 const clock=new FakeClock(10000),store=new TtlStore({clock});const operations=[],sent=[];let llmCalls=0,legacy=0;
 const features=createWaveAFeatures({
  qr:{create:async()=>({ref:'synthetic:qr'}),read:async()=>null},
  documents:{clock,store,readContent:async()=>'',process:async({operation,sources})=>{operations.push({operation,ids:sources.map(s=>s.attachment.id),keys:sources.map(s=>s.attachment.providerKey)});return{parts:[{type:'document',ref:'synthetic:pdf',mime:'application/pdf'}]};}},
  sticker:{createSticker:async()=>({ref:'synthetic:sticker'}),applyEffect:async()=>({ref:'synthetic:effect'})},
  voice:{prepareScript:async()=>({success:true,mode:'verbatim',text:'hola'}),synthesize:async()=>({ref:'synthetic:voice'}),fitDuration:async media=>media},
  transcription:{transcribe:async()=>({text:'synthetic'})}
 });
 const messenger=Object.fromEntries(['sendText','sendMedia','sendVoice','sendSticker','react','typing','delete','edit','groupInfo'].map(name=>[name,async(...args)=>{sent.push({name,args});return{messageId:'ack-'+sent.length};}]));
 const service=createPhase4Service({root:'/synthetic/media',clock,buildGraph:async()=>{
  const app=createApplication({clock,botJid:BOT,messenger,llm:{generate:async()=>{llmCalls++;throw Error('unexpected LLM');}},conversation:{recent:async()=>[],append:async()=>{}},getStatus:()=>({}),extraFeatures:features});
  return{app,dispose:()=>app.dispose()};
 }});
 try{
  await service.initialize({PIPELINE_MODE:'canary',V2_CANARY_CHAT_IDS:[CHAT],V2_CANARY_FEATURES:['qr','help','system-info','documents','sticker','voice','transcription']});
  for(const event of [image('first','pdf'),image('second'),text('finish','pdf terminar')]){
   const pending=service.tryHandle(event);for(let n=0;n<6;n++)await Promise.resolve();await clock.advance(1200);
   if(!await pending)legacy++;await clock.advance(4000);
  }
  assert.equal(legacy,0);assert.equal(llmCalls,0);
  assert.equal(operations.length,1,JSON.stringify(sent));assert.equal(operations[0].operation,'images-to-pdf');
  assert.deepEqual(operations[0].ids,['first','second']);
  assert.deepEqual(operations[0].keys.map(k=>k.id),['first','second']);
  const outputs=sent.filter(s=>s.name==='sendMedia');assert.equal(outputs.length,1);assert.equal(outputs[0].args[0],CHAT);
  assert.equal(service.status.counters.handled,3);assert.equal(service.status.counters.errors,0);
 }finally{await service.dispose();store.dispose();clock.dispose();}
});
