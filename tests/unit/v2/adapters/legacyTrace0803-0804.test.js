'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const FormData=require('form-data');
const {createTranscriptionMedia}=require('../../../../src/v2/adapters/media/transcription');
const runFile=promisify(execFile);

async function syntheticOgg(filename){
 await runFile('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=500:sample_rate=24000','-t','0.4','-c:a','libopus','-f','ogg',filename],{timeout:15000});
 return fs.readFile(filename);
}

test('TR-0803: a synthetic OGG is multipart-submitted to the Groq transcription port and returns its transcript',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-tr-0803-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const filename=path.join(root,'synthetic.ogg'),audio=await syntheticOgg(filename),calls={downloads:[],requests:[],body:[]};
 const media=createTranscriptionMedia({
  downloadMedia:async(source,options)=>{calls.downloads.push({source,options});return{buffer:audio,extension:'ogg',mime:'audio/ogg'};},
  formData:()=>new FormData(),config:{groqApiKey:'fixture-key',groqEndpoint:'https://groq.invalid/audio/transcriptions'},
  fallbackTranscribe:async()=>{assert.fail('successful primary transcription must not use fallback');},
  http:{post:async(url,form,options)=>{
   calls.requests.push({url,options});
   await new Promise((resolve,reject)=>{form.on('data',chunk=>calls.body.push(Buffer.from(chunk)));form.once('error',reject);form.once('end',resolve);form.resume();});
   return{data:{text:'Texto de audio sintético confirmado',duration:0.4,language:'es'}};
  }}
 });
 const started=Date.now();
 const result=await media.transcribe({id:'synthetic-audio',chatId:'chat-test',ownerJid:'user-test',ref:'opaque-media-ref',mime:'audio/ogg'},
  {model:'whisper-large-v3-turbo',language:'es',signal:new AbortController().signal});
 const elapsedMs=Date.now()-started,body=Buffer.concat(calls.body).toString('latin1');
 assert.deepEqual(result,{text:'Texto de audio sintético confirmado',duration:0.4,language:'es'});
 assert.equal(calls.downloads.length,1);assert.equal(calls.downloads[0].source.id,'synthetic-audio');
 assert.equal(calls.requests.length,1);assert.match(calls.requests[0].url,/audio\/transcriptions$/);
 assert.match(body,/filename="audio\.ogg"/);assert.match(body,/whisper-large-v3-turbo/);assert.match(body,/verbose_json/);assert.match(body,/name="language"/);assert.match(body,/\r\nes\r\n/);
 assert.ok(elapsedMs<5000,`fixture transcription completed in ${elapsedMs}ms`);
});

test('TR-0804: long-audio summary receives the complete transcript once and returns concise text',async()=>{
 const sample='Hola compa, te aviso que ya revisamos los reportes de la base de datos y encontramos que el servidor se estaba reiniciando por falta de memoria RAM. Ya ajustamos los límites del pool de conexiones y reiniciamos el servicio de base de datos. Mañana a primera hora confirmamos que todo siga estable.';
 const calls=[];
 const media=createTranscriptionMedia({downloadMedia:async()=>{throw Error('not used');},formData:()=>({append(){},getHeaders(){return{};}}),http:{post:async()=>{assert.fail('summary must not call HTTP');}},config:{groqApiKey:'fixture-key'},
  summarizeText:async(text,{signal})=>{calls.push({text,aborted:signal.aborted});return'• Se corrigió la memoria del servidor.\n• Mañana se verifica estabilidad.';}});
 const summary=await media.summarize(sample,new AbortController().signal);
 assert.ok(summary);assert.ok(summary.length>10);assert.equal(calls.length,1);assert.equal(calls[0].text,sample);assert.equal(calls[0].aborted,false);
});
