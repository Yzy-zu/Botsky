'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const runFile=promisify(execFile);
const {createVoiceMedia,cleanTextForSpeech,resolveVoice}=require('../../../../src/v2/adapters/media/voice');

async function syntheticMp3(filename){
 await runFile('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=500:sample_rate=24000','-t','0.4','-c:a','libmp3lame','-b:a','96k',filename],{timeout:15000});
 return fs.readFile(filename);
}

test('TR-0726: speech cleanup removes emoji, markdown, URL and keeps the spoken question',()=>{
 const raw='*Hola* _compa_ 😄 https://ejemplo.com ¿cómo estás?';
 assert.equal(cleanTextForSpeech(raw),'Hola compa ¿cómo estás?');
});

test('TR-0727: regional and character voice requests resolve to their supported synthesis profiles',()=>{
 const cases=[
  ['loquendo','loquendo','es-ES-AlvaroNeural'],['goku','goku','es-MX-JorgeNeural'],['dross','dross','es-AR-TomasNeural'],
  ['babidi','babidi','es-MX-JorgeNeural'],['donramon','donramon','es-MX-JorgeNeural'],['colombiano','colombiano','es-CO-GonzaloNeural'],
  ['argentino','argentino','es-AR-TomasNeural'],['ardilla','ardilla','es-MX-DaliaNeural'],['demonio','demonio','es-MX-JorgeNeural'],
  ['anime','anime','es-ES-ElviraNeural'],['hombre','hombre','es-MX-JorgeNeural']
 ];
 for(const [input,key,providerVoice] of cases){const resolved=resolveVoice(input);assert.equal(resolved.key,key,input);assert.equal(resolved.profile.voice,providerVoice,input);}
 assert.equal(resolveVoice('goku').profile.pitch,'+10Hz');
 assert.match(resolveVoice('babidi').profile.filter,/asetrate/);
 assert.match(resolveVoice('donramon').profile.filter,/equalizer/);
 assert.match(resolveVoice('ardilla').profile.filter,/atempo/);
 assert.match(resolveVoice('demonio').profile.filter,/bass/);
});

test('TR-0728: failed primary TTS falls back to synthetic local gTTS output and release removes the measured MP3',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-tr-0728-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const calls=[];const tempDirectory=path.join(root,'botsky-v2-media');
 const media=createVoiceMedia({tempDirectory,run:async(command,args,options)=>{
  calls.push({command,args});
  if(command==='edge-tts')throw Error('synthetic primary provider unavailable');
  if(command==='gtts-cli')return runFile('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=500:sample_rate=24000','-t','0.4','-c:a','libmp3lame','-b:a','96k',args[args.indexOf('--output')+1]],{timeout:15000});
  return runFile(command,args,{timeout:options.timeoutMs,signal:options.signal});
 }});
 const result=await media.synthesize('Audio de prueba para tests',{voice:'colombiano',signal:new AbortController().signal});
 assert.deepEqual(calls.map(item=>item.command),['edge-tts','gtts-cli','ffprobe']);
 assert.equal(resolveVoice('colombiano').profile.voice,'es-CO-GonzaloNeural');
 assert.ok((await fs.stat(result.ref)).size>1000);assert.ok(result.durationSeconds>0);
 assert.equal(await media.release(result.ref),true);await assert.rejects(fs.stat(result.ref),{code:'ENOENT'});
});

test('TR-0729: the optional ElevenLabs contract receives daniel and its synthetic MP3 is released',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-tr-0729-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const generated=path.join(root,'fixture.mp3'),buffer=await syntheticMp3(generated);const calls=[];const runs=[];
 const media=createVoiceMedia({tempDirectory:path.join(root,'botsky-v2-media'),elevenLabs:async(text,voice)=>{calls.push({text,voice});return buffer;},
  run:async(command,args,options)=>{runs.push(command);return runFile(command,args,{timeout:options.timeoutMs,signal:options.signal});}});
 const result=await media.synthesize('Prueba corta para ElevenLabs',{voice:'daniel',signal:new AbortController().signal});
 assert.deepEqual(calls,[{text:'Prueba corta para ElevenLabs',voice:'daniel'}]);
 assert.deepEqual(runs,['ffprobe']);assert.ok((await fs.stat(result.ref)).size>1000);assert.ok(result.durationSeconds>0);
 assert.equal(await media.release(result.ref),true);await assert.rejects(fs.stat(result.ref),{code:'ENOENT'});
});
