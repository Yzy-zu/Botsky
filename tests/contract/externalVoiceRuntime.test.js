'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createRuntime}=require('../../src/v2/composition/runtime');
const {FakeClock}=require('../../src/v2/platform/clock');
const {createAttachmentDownload}=require('../../src/v2/composition/media');
const mp3=require('../helpers/syntheticMp3');
const ADMIN='19995550101@s.whatsapp.net',GROUP='120363000000000001@g.us';
test('external voice runtime keeps acknowledgement, transcript, thread and reusable media scoped to the destination',async()=>{
 const clock=new FakeClock(1000);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-external-runtime-'));let runtime;const calls=[];
 const http={post:async(route,body)=>{
  calls.push({route,body});
  if(route.includes('getBase64FromMediaMessage'))return{status:200,data:{base64:mp3().toString('base64'),mimetype:'audio/mpeg',fileName:'voice.mp3'}};
  return{status:200,data:{key:{id:route.includes('sendWhatsAppAudio')?'voice-destination-ack':'local-feedback-ack'}}};
 },get:async()=>assert.fail('Literal main-group destination must not discover contacts'),put:async()=>assert.fail('No PUT')};
 try{
  runtime=await createRuntime({config:{BOT_NUMBER:'19995550000',EVOLUTION_INSTANCE:'fake',MAIN_GROUP_JID:GROUP,TMP_DIR:path.join(directory,'tmp'),ALLOWED_NUMBERS_ADMIN:[ADMIN],ALLOWED_NUMBERS_NORMAL:[],ALLOWED_NUMBERS_TASKS:[],ALLOWED_GROUPS_NORMAL:[],ALLOWED_GROUPS_ADMIN:[]},
   clock,evolutionHttp:http,llm:{generate:async()=>assert.fail('Literal voice needs no LLM')},http:{post:async()=>assert.fail('No provider HTTP')},formData:()=>({append(){},getHeaders(){return{};}}),elevenLabs:async()=>mp3(),sidecarDbFilename:path.join(directory,'state','sidecar.db'),backupPath:path.join(directory,'state','backup.db')});
  const pending=runtime.app.pipeline.handle({key:{id:'private-request',remoteJid:ADMIN},message:{conversation:'voz --voice daniel --scope main_group Hola'}});
  await clock.advance(4000);const result=await pending;
  assert.equal(result.kind,'reply');assert.equal(calls[0].body.number,GROUP);assert.equal(calls[1].body.number,ADMIN);
  assert.match(calls[1].body.text,/Mandé el audio/);
  const targetHistory=await runtime.conversation.recent(GROUP);assert.deepEqual(targetHistory.map(row=>row.content),['[Nota de voz: Hola]']);
  const thread=await runtime.db.get('SELECT message_id,quoted_message_id,owner_jid FROM thread_history WHERE chat_id=?',[GROUP]);
  assert.equal(thread.message_id,'voice-destination-ack');assert.equal(thread.quoted_message_id,null);assert.equal(thread.owner_jid,ADMIN);
  const source=await runtime.conversation.recent(ADMIN);assert.equal(source.some(row=>row.content==='[Nota de voz: Hola]'),false);
  const cached=runtime.app.store.get('pipeline.attachment.id',JSON.stringify([GROUP,'voice-destination-ack']));assert.equal(cached.chatId,GROUP);assert.equal(cached.transcript,'Hola');
  assert.equal(runtime.app.store.get('pipeline.attachment.id',JSON.stringify([ADMIN,'voice-destination-ack'])),undefined);
  await createAttachmentDownload(runtime.evolution)(cached,{maxBytes:1024,signal:new AbortController().signal});
  assert.deepEqual(calls.at(-1).body.message.key,{id:'voice-destination-ack',remoteJid:GROUP,fromMe:true});
 }finally{await runtime?.dispose();await fs.rm(directory,{recursive:true,force:true});}
});
