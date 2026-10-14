'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createContentReader}=require('../../../../src/v2/adapters/media/contentReader');
const {createDocumentsFeature}=require('../../../../src/v2/features/documents/manifest');

const PDF=Buffer.from('%PDF-1.4\nsynthetic bytes\n%%EOF\n');
const CHAT='user@s.whatsapp.net';
function source(raw={},attachment={}){
 const media={id:'trace-file',ownerJid:CHAT,chatId:CHAT,ref:'media://file.pdf',mime:'application/pdf',kind:'document',...attachment};
 return{attachment:media,raw:{event:'messages.upsert',data:{key:{id:media.id,remoteJid:media.chatId},message:{}},...raw}};
}
async function setup(t,{download,run,files}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-content-trace3-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const reader=createContentReader({tempDirectory:root,downloadMedia:download|| (async()=>({buffer:PDF,extension:'pdf'})),
  run:run|| (async(command)=>command==='pdfinfo'?{stdout:'Pages: 2\nEncrypted: no\n'}:{stdout:'texto PDF'}),...(files?{files}:{})});
 return{reader,root};
}
async function readFeature(reader,document){
 const feature=createDocumentsFeature({process:async()=>({parts:[]}),readContent:reader.readContent,clock:{now:()=>0},store:{get:()=>undefined,set(){},delete(){}}});
 const command=feature.commands.find(item=>item.name==='leer');
 return command.handler({event:{id:'read',chatId:document.attachment.chatId,sender:{jid:document.attachment.ownerJid,name:'Test'},isGroup:false,text:'leer',raw:document.raw},addressing:{respond:true,reason:'explicit-command'},history:[],correlationId:'read',roles:{admins:[],owners:[]},attachment:document.attachment},{},new AbortController().signal);
}

test('TR-0166: PDF signature keeps native bytes through local page inspection despite JPEG metadata',async t=>{
 const calls=[];let downloadIdentity;
 const {reader}=await setup(t,{download:async value=>{downloadIdentity=[value.attachment.id,value.attachment.chatId];return{buffer:PDF,extension:'jpg',mime:'image/jpeg'};},run:async(command,args)=>{
  calls.push(command);const input=command==='pdfinfo'?args[0]:args[1];assert.equal(await fs.readFile(input).then(bytes=>bytes.equals(PDF)),true,'the temp PDF must contain the exact downloaded bytes');
  return command==='pdfinfo'?{stdout:'Pages: 4\nEncrypted: no\n'}:{stdout:'Texto extraído'};
 }});
 const result=await reader.readContent(source(),{signal:new AbortController().signal});
 assert.equal(result,'Texto extraído');assert.deepEqual(downloadIdentity,['trace-file',CHAT]);assert.deepEqual(calls,['pdfinfo','pdftotext']);
 // V2 currently returns extracted text only; it does not expose native PDF bytes/page metadata to a multimodal model.
});

test('TR-0168: captioned ephemeral document wrapper retains the exact fileLength and message identity',async t=>{
 let downloaded=0;
 const document=source({data:{key:{id:'trace-file',remoteJid:CHAT},message:{ephemeralMessage:{message:{documentWithCaptionMessage:{message:{documentMessage:{fileName:'lesson.pdf',mimetype:'application/pdf',fileLength:8,caption:'solve this',url:'encrypted-ref'}}}}}}}});
 const {reader}=await setup(t,{download:async received=>{downloaded++;assert.equal(received.attachment.id,'trace-file');assert.equal(received.attachment.chatId,CHAT);return{buffer:PDF,extension:'pdf'};}});
 assert.equal(await reader.readContent(document,{signal:new AbortController().signal}),'texto PDF');assert.equal(downloaded,1);
});

test('TR-0179: corrupt and encrypted PDFs return distinct safe resend guidance',async t=>{
 const corrupt=await setup(t,{run:async()=>{throw Error('Invalid xref SECRET /tmp/private');}});
 const encrypted=await setup(t,{run:async()=>{throw Error('Incorrect password SECRET /tmp/private');}});
 for(const [reader,needle] of [[corrupt.reader,/No pude abrir ese PDF/],[encrypted.reader,/protegido con contraseña/]]){
  const reply=await readFeature(reader,source());assert.match(reply.parts[0].text,needle);assert.doesNotMatch(reply.parts[0].text,/SECRET|private|xref/);
 }
});

test('TR-0180: missing PDF reader and timeout receive distinct guidance rather than corrupt-file feedback',async t=>{
 const unavailable=await setup(t,{run:async()=>{throw Object.assign(Error('missing binary private'),{code:'ENOENT'});}});
 const timeout=await setup(t,{run:async()=>{throw Object.assign(Error('process timed out private'),{code:'ETIMEDOUT'});}});
 const a=await readFeature(unavailable.reader,source()),b=await readFeature(timeout.reader,source());
 assert.match(a.parts[0].text,/no está disponible el lector de PDF/);assert.match(b.parts[0].text,/tardó demasiado/);
 assert.doesNotMatch(a.parts[0].text+b.parts[0].text,/private|binary|timed out/);
});

test('TR-0181: pdfinfo encryption metadata asks for an unprotected copy',async t=>{
 const {reader}=await setup(t,{run:async()=>({stdout:'Pages: 1\nEncrypted: yes (print:yes)\n'})});
 const reply=await readFeature(reader,source());assert.match(reply.parts[0].text,/protegido con contraseña/);assert.match(reply.parts[0].text,/copia sin contraseña/);
});

test('TR-0188: quoted attachment identity stays bound to its stanza through hydration',async t=>{
 let hydrated;
 const document=source({data:{key:{id:'reply-id',remoteJid:CHAT},message:{extendedTextMessage:{contextInfo:{stanzaId:'trace-file',participant:CHAT,quotedMessage:{documentMessage:{fileName:'quote.pdf',mimetype:'application/pdf',fileLength:PDF.length,url:'encrypted-quote'}}}}}}});
 const {reader}=await setup(t,{download:async received=>{hydrated={...received.attachment};return{buffer:PDF,extension:'pdf'};}});
 assert.equal(await reader.readContent(document,{signal:new AbortController().signal}),'texto PDF');
 assert.equal(hydrated.id,'trace-file');assert.equal(hydrated.chatId,CHAT);assert.equal(hydrated.ownerJid,CHAT);
});

test('TR-0191: temp creation and write failures give bounded clarification instead of throwing',async t=>{
 for(const operation of ['mkdtemp','writeFile']){
  const files=new Proxy(fs,{get(target,key){if(key===operation)return async()=>{throw Object.assign(Error('disk full SECRET /tmp'),{code:'ENOSPC'});};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  const {reader}=await setup(t,{files});const reply=await readFeature(reader,source());
  assert.match(reply.parts[0].text,/No pude preparar el archivo/);assert.doesNotMatch(reply.parts[0].text,/SECRET|ENOSPC|tmp/);
 }
});

test('TR-0192: temp cleanup failure does not replace the encrypted-PDF diagnosis',async t=>{
 const warnings=[];const files=new Proxy(fs,{get(target,key){if(key==='rm')return async()=>{throw Object.assign(Error('cleanup SECRET'),{code:'EACCES'});};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-content-trace3-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const featureReader=createContentReader({tempDirectory:root,downloadMedia:async()=>({buffer:PDF,extension:'pdf'}),run:async()=>({stdout:'Pages: 1\nEncrypted: yes\n'}),files,onCleanupError:error=>warnings.push(error.code)});
 const reply=await readFeature(featureReader,source());
 assert.match(reply.parts[0].text,/protegido con contraseña/);assert.deepEqual(warnings,['EACCES']);
});

test('TR-0193: failed cleanup after successful extraction prevents extracted text from being published',async t=>{
 const files=new Proxy(fs,{get(target,key){if(key==='rm')return async()=>{throw Error('cleanup SECRET');};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-content-trace3-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const reader=createContentReader({tempDirectory:root,downloadMedia:async()=>({buffer:PDF,extension:'pdf'}),run:async(command)=>command==='pdfinfo'?{stdout:'Pages: 1\nEncrypted: no\n'}:{stdout:'PRIVATE extracted text'},files});
 const reply=await readFeature(reader,source());assert.match(reply.parts[0].text,/No pude terminar de procesar/);assert.doesNotMatch(reply.parts[0].text,/PRIVATE extracted text|SECRET/);
});
