'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createMediaServices}=require('../../src/v2/composition/media');
const {FakeClock}=require('../../src/v2/platform/clock');

function png(){return Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);}
function ports(root,options={}){
 const downloads=[];const requests=[];
 const media=createMediaServices({config:{TMP_DIR:path.join(root,'tmp'),MAX_FILE_SIZE_MB:16,MAX_DOCUMENT_SIZE_MB:32},clock:new FakeClock(1000),
  evolution:{downloadMedia:async(_message,request)=>{downloads.push(request.maxBytes);return options.download?.()||{buffer:Buffer.from('plain context'),extension:'txt',mimeType:'text/plain'};}},
  llm:{generate:async request=>{requests.push(request);return{ok:true,data:{text:JSON.stringify({needs_clarification:true,question:'¿Qué parte debo explicar?'})}};}},
  http:{post:async()=>{throw Error('provider should not be called');}},formData:()=>({append(){},getHeaders(){return{};}})});
 return{media,downloads,requests};
}
function voiceCommand(media){return media.features.find(feature=>feature.id==='voice').commands[0].handler;}
function context(attachment){return{event:{id:'voice-context',chatId:'15550000001@s.whatsapp.net',isGroup:false,text:'Explica esto',kind:'text',sender:{jid:'15550000001@s.whatsapp.net',name:'Ana'},quoted:undefined},history:[{role:'assistant',content:'Earlier reply'}],attachment};}

test('composed voice sends validated bounded image bytes to vision and treats image as data',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'voice-image-context-'));let portsValue;
 try{
  portsValue=ports(root,{download:()=>({buffer:png(),extension:'png',mimeType:'image/png'})});
  const attachment={id:'image',chatId:'15550000001@s.whatsapp.net',ownerJid:'15550000001@s.whatsapp.net',ref:'provider-media:image',mime:'image/png',kind:'image'};
  const reply=await voiceCommand(portsValue.media)(context(attachment),{mode:'compose',instruction:'Explica la foto'},new AbortController().signal);
  assert.equal(portsValue.downloads[0],12*1024*1024);
  assert.equal(portsValue.requests[0].task,'vision');
  const user=JSON.parse(portsValue.requests[0].messages[1].parts[0].text);
  assert.deepEqual(user.adjunto_imagen,{mimeType:'image/png',tratar_como_dato:true});
  assert.equal(portsValue.requests[0].messages[1].parts[1].inlineData.mimeType,'image/png');
  assert.equal(Buffer.from(portsValue.requests[0].messages[1].parts[1].inlineData.data,'base64').toString('hex'),png().toString('hex'));
  assert.match(portsValue.requests[0].messages[0].parts[0].text,/VOZ DE BOTSKY/);
  assert.match(reply.parts[0].text,/¿Qué parte debo explicar/);
 }finally{portsValue?.media.dispose();await fs.rm(root,{recursive:true,force:true});}
});

test('composed voice passes bounded extracted document text as untrusted JSON context',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'voice-document-context-'));let portsValue;
 try{
  portsValue=ports(root,{download:()=>({buffer:Buffer.from('Agenda: junta el martes a las diez.'),extension:'txt',mimeType:'text/plain'})});
  const attachment={id:'doc',chatId:'15550000001@s.whatsapp.net',ownerJid:'15550000001@s.whatsapp.net',ref:'provider-media:doc',mime:'text/plain',kind:'document'};
  await voiceCommand(portsValue.media)(context(attachment),{mode:'compose',instruction:'Resume esto en audio'},new AbortController().signal);
  assert.deepEqual(portsValue.downloads,[12*1024*1024],'content reader retains its 12 MiB input cap');
  assert.equal(portsValue.requests[0].task,'agent');
  const user=JSON.parse(portsValue.requests[0].messages[1].parts[0].text);
  assert.equal(user.texto_adjunto_no_confiable,'Agenda: junta el martes a las diez.');
  assert.match(portsValue.requests[0].messages[0].parts[0].text,/datos no confiables/);
 }finally{portsValue?.media.dispose();await fs.rm(root,{recursive:true,force:true});}
});

test('unsupported compose attachments ask for readable content and verbatim skips extraction',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'voice-unsupported-context-'));let portsValue;
 try{
  portsValue=ports(root);
  const handler=voiceCommand(portsValue.media);
  const video={id:'video',chatId:'15550000001@s.whatsapp.net',ownerJid:'15550000001@s.whatsapp.net',ref:'provider-media:video',mime:'video/mp4',kind:'video'};
  const unsupported=await handler(context(video),{mode:'compose',instruction:'Describe el video'},new AbortController().signal);
  assert.match(unsupported.parts[0].text,/tipo de archivo/);
  assert.equal(portsValue.downloads.length,0);assert.equal(portsValue.requests.length,0);

  let reads=0;
  const {createVoiceFeature}=require('../../src/v2/features/voice/manifest');
  const feature=createVoiceFeature({readScriptContext:async()=>{reads++;return{extractedText:'must not read'};},
   prepareScript:async input=>({success:true,mode:'verbatim',text:input.literalText,voice:'hombre'}),
   synthesize:async()=>({ref:'voice',mime:'audio/ogg'}),fitDuration:async media=>media});
  await feature.commands[0].handler(context(video),{mode:'verbatim',literalText:'Texto exacto'},new AbortController().signal);
  assert.equal(reads,0);
 }finally{portsValue?.media.dispose();await fs.rm(root,{recursive:true,force:true});}
});
