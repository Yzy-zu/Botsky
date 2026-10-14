'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createWaveAFeatures}=require('../../../../src/v2/features');
const {FakeClock}=require('../../../../src/v2/platform/clock');
const {TtlStore}=require('../../../../src/v2/platform/ttlStore');
const {createApplication}=require('../../../../src/v2/main');
test('media registry exposes only complete capabilities and rejects duplicate OCR ownership',()=>{
 assert.deepEqual(createWaveAFeatures({}),[]);
 assert.throws(()=>createWaveAFeatures({qr:{create:async()=>({ref:'ref'})}}),/Incomplete/);
 assert.throws(()=>createWaveAFeatures({documents:{},ocr:{}}),/both own/);
 assert.deepEqual(createWaveAFeatures({ocr:{readText:async()=>''}}).map(f=>f.id),['ocr']);
 const clock=new FakeClock();const store=new TtlStore({clock});
 const features=createWaveAFeatures({qr:{create:async()=>({ref:'ref'}),read:async()=>''},
 documents:{clock,store,process:async()=>({parts:[]}),readContent:async()=>''},
 transcription:{transcribe:async()=>({text:''})},sticker:{createSticker:async()=>({ref:'r',mime:'image/webp'}),applyEffect:async()=>({ref:'r',mime:'audio/ogg'})},
 voice:{prepareScript:async()=>({text:'fake'}),synthesize:async()=>({ref:'r',mime:'audio/ogg'}),fitDuration:async m=>m}});
 assert.deepEqual(features.map(f=>f.id),['qr','documents','transcription','sticker','voice']);
 const names=features.flatMap(f=>f.commands.flatMap(c=>[c.name,...(c.aliases||[])]));
 assert.equal(new Set(names).size,names.length);store.dispose();
});
test('assembled QR command traverses real pipeline with one delivery and one owned release',async()=>{
 const clock=new FakeClock(1000);const deliveries=[];const released=[];let creates=0;
 const features=createWaveAFeatures({qr:{create:async text=>{creates++;assert.equal(text,'synthetic');return{ref:'/synthetic/qr.png',mime:'image/png'};},read:async()=>''}});
 const app=createApplication({clock,extraFeatures:features,botJid:'19995550199@s.whatsapp.net',conversation:{recent:async()=>[]},llm:{generate:async()=>{throw Error('Explicit QR must not call AI');}},getStatus:async()=>({}),
 messenger:{sendMedia:async(...args)=>{deliveries.push(args);return{messageId:'sent'};}},releaseMedia:async ref=>{released.push(ref);}});
 try {const result=await app.pipeline.handle({key:{id:'request',remoteJid:'19995550101@s.whatsapp.net'},message:{conversation:'/qr synthetic'}});assert.equal(result.kind,'reply');assert.equal(creates,1);assert.equal(deliveries.length,1);assert.equal(deliveries[0][1],'/synthetic/qr.png');assert.deepEqual(released,['/synthetic/qr.png']);}
 finally{await app.dispose();}
});
