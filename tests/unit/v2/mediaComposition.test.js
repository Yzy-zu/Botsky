'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createAttachmentDownload,createMediaServices}=require('../../../src/v2/composition/media');
const {createContext}=require('../../../src/v2/pipeline/context');
const {FakeClock}=require('../../../src/v2/platform/clock');const {TtlStore}=require('../../../src/v2/platform/ttlStore');
const abort=new AbortController().signal;
const source={id:'media',chatId:'525550000001@s.whatsapp.net',ownerJid:'525550000001@s.whatsapp.net',ref:'encrypted-ref',mime:'image/png',providerKey:{id:'media',remoteJid:'5215550000001@c.us',fromMe:false}};
test('hydration preserves the original provider key and bounds bytes without trusting URL refs',async()=>{
 const calls=[];const download=createAttachmentDownload({downloadMedia:async(...args)=>{calls.push(args);return{buffer:Buffer.from('fake'),extension:'png',mimeType:'image/png'};}});
 const result=await download(source,{maxBytes:8,signal:abort});assert.equal(result.mime,'image/png');assert.deepEqual(calls[0][0],{key:source.providerKey,message:{}});
 await assert.rejects(download({...source,providerKey:{id:'other',remoteJid:source.chatId}},{maxBytes:8,signal:abort}),{kind:'unsupported_media'});
 await assert.rejects(download({...source,chatId:undefined},{maxBytes:8,signal:abort}),{kind:'unsupported_media'});
 await assert.rejects(download(source,{maxBytes:2,signal:abort}),{kind:'too_large'});
 const cancel=new AbortController();cancel.abort();await assert.rejects(download(source,{maxBytes:8,signal:cancel.signal}),{name:'AbortError'});assert.equal(calls.length,2);
});
test('attachment cache carries provider identities for canonical Mexican-phone aliases',()=>{
 const clock=new FakeClock();const store=new TtlStore({clock});const context=createContext({clock,store,conversation:{recent:async()=>[]}});
 const event={id:source.id,chatId:source.chatId,sender:{jid:source.ownerJid},isGroup:false,isFromMe:false,media:{ref:source.ref,mime:source.mime},raw:{key:source.providerKey}};
 context.observe(event);assert.deepEqual(context.addressingMetadata(event).attachment.providerKey,source.providerKey);
 context.observe({...event,id:'other',raw:{key:source.providerKey}});assert.equal(context.addressingMetadata(event).attachment.providerKey,undefined);store.dispose();
});
test('media assembly enables five unique feature owners without runtime IO at construction',()=>{
 const clock=new FakeClock();const forbidden=()=>{throw Error('construction must not perform IO');};
 const runtime=createMediaServices({config:{TMP_DIR:'/tmp/synthetic-root'},clock,llm:{generate:forbidden},evolution:{downloadMedia:forbidden},http:{post:forbidden},formData:forbidden,urlDownload:{download:forbidden}});
 assert.deepEqual(runtime.features.map(f=>f.id),['qr','documents','transcription','sticker','voice']);
 const names=runtime.features.flatMap(f=>f.commands.flatMap(c=>[c.name,...(c.aliases||[])]));assert.equal(new Set(names).size,names.length);
 assert.equal(clock.pendingTimers,0);runtime.dispose();assert.equal(clock.pendingTimers,0);
});
