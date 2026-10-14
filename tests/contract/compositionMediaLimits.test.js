'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createMediaServices,configuredMegabytes,sourceByteLimit,MIB,MAX_TRANSCRIPTION_BYTES}=require('../../src/v2/composition/media');
const {FakeClock}=require('../../src/v2/platform/clock');

function dependencies(directory,config,downloads){
 return createMediaServices({config:{TMP_DIR:path.join(directory,'tmp'),...config},clock:new FakeClock(1000),llm:{generate:async()=>({ok:false,failure:{kind:'network'}})},
  evolution:{downloadMedia:async(_message,options)=>{downloads.push(options.maxBytes);throw Error('synthetic stop after limit capture');}},
  http:{post:async()=>{throw Error('unexpected provider request');}},formData:()=>({append(){},getHeaders(){return{};}})});
}

test('composition applies configured file/document caps by attachment kind and MIME without a 20 MiB clamp',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'media-limits-'));let media;
 try{
  const downloads=[];media=dependencies(root,{MAX_FILE_SIZE_MB:64,MAX_DOCUMENT_SIZE_MB:200},downloads);
  const image={id:'img',chatId:'15550000001@s.whatsapp.net',ownerJid:'15550000001@s.whatsapp.net',ref:'provider-media:img',mime:'image/jpeg',kind:'image'};
  const pdf={...image,id:'pdf',ref:'provider-media:pdf',mime:'application/pdf',kind:'document'};
  await assert.rejects(media.services.qr.readText(image,{language:'spa+eng',signal:new AbortController().signal}));
  await assert.rejects(media.services.qr.readText(pdf,{language:'spa+eng',signal:new AbortController().signal}));
  assert.deepEqual(downloads,[64*MIB,200*MIB]);
  assert.equal(sourceByteLimit(image,64*MIB,200*MIB),64*MIB);
  assert.equal(sourceByteLimit(pdf,64*MIB,200*MIB),200*MIB);
  assert.equal(sourceByteLimit({ref:'https://files.test/report.pdf',mime:'application/octet-stream'},64*MIB,200*MIB),200*MIB);
  assert.equal(sourceByteLimit({ref:'https://files.test/audio.pdf',mime:'audio/mpeg'},64*MIB,200*MIB),64*MIB,'identified media MIME takes precedence over a misleading suffix');
  assert.equal(MAX_TRANSCRIPTION_BYTES,25*MIB,'provider-specific transcription ceiling remains independent of upload settings');
 }finally{media?.dispose();await fs.rm(root,{recursive:true,force:true});}
});

test('document conversion uses the configured cap above 20 MiB and reader input remains intrinsically capped at 12 MiB',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'media-document-limits-'));let media;
 try{
  const downloads=[];media=dependencies(root,{MAX_FILE_SIZE_MB:64,MAX_DOCUMENT_SIZE_MB:200},downloads);
  const pdf={attachment:{id:'pdf',chatId:'15550000001@s.whatsapp.net',ownerJid:'15550000001@s.whatsapp.net',ref:'provider-media:pdf',mime:'application/pdf',kind:'document'},raw:{key:{id:'pdf'}}};
  const signal=new AbortController().signal;
  await assert.rejects(media.services.documents.process({operation:'compress-pdf',source:pdf,args:{},signal}));
  await assert.rejects(media.services.documents.readContent(pdf,{signal}));
  assert.deepEqual(downloads,[200*MIB,12*MIB]);
 }finally{media?.dispose();await fs.rm(root,{recursive:true,force:true});}
});

test('media caps default backward compatibly and reject invalid central config values',()=>{
 assert.equal(configuredMegabytes(undefined,64,'MAX_FILE_SIZE_MB'),64*MIB);
 assert.equal(configuredMegabytes(undefined,200,'MAX_DOCUMENT_SIZE_MB'),200*MIB);
 assert.throws(()=>configuredMegabytes(0,64,'MAX_FILE_SIZE_MB'),/positive whole number/);
 assert.throws(()=>configuredMegabytes(1.5,64,'MAX_FILE_SIZE_MB'),/positive whole number/);
});
