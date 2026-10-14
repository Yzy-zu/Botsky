'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createDocumentsFeature}=require('../../../../src/v2/features/documents/manifest');
const {createDocumentsMedia}=require('../../../../src/v2/adapters/media/documents');
const {createComposer}=require('../../../../src/v2/pipeline/composer');
const {FakeClock}=require('../../../../src/v2/platform/clock');
const {TtlStore}=require('../../../../src/v2/platform/ttlStore');

const signal=new AbortController().signal;
const USER='19995550101@s.whatsapp.net';
function ctx(attachment){return{event:{id:'trace-event',chatId:USER,sender:{jid:USER,name:'Test'},isGroup:false,text:'',raw:{}},addressing:{respond:true,reason:'explicit-command'},history:[],correlationId:'trace',roles:{admins:[],owners:[]},...(attachment?{attachment}:{})};}
function mediaSource(){return{attachment:{id:'media-in',ownerJid:USER,chatId:USER,ref:'media://input.mp4',mime:'video/mp4',kind:'video'},raw:{}};}

test('TR-0479: converting a URL preserves requested format, speed and bitrate through the feature port',async()=>{
 const clock=new FakeClock(),store=new TtlStore({clock}),calls=[];
 const feature=createDocumentsFeature({clock,store,readContent:async()=>'',process:async request=>{calls.push(request);return{parts:[{type:'text',text:'done'}]};}});
 try{
  const command=feature.commands.find(item=>item.name==='convertir');
  const reply=await command.handler(ctx(),{url:'https://media.invalid/audio',format:'ogg',quality:'alta',speed:1.5,bitrate:'128k'},signal);
  assert.equal(reply.parts[0].text,'done');assert.equal(calls.length,1);assert.equal(calls[0].operation,'convert-media');
  assert.deepEqual(calls[0].args,{url:'https://media.invalid/audio',format:'ogg',quality:'alta',speed:1.5,bitrate:128000});
 }finally{store.dispose();}
});

test('TR-0480: video speed applies matching setpts and atempo filters with the requested video bitrate',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-tr-0480-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const commands=[];
 const adapter=createDocumentsMedia({tempDirectory:path.join(root,'botsky-v2-media'),download:async()=>({buffer:Buffer.from('synthetic video'),extension:'mp4'}),
  run:async(command,args)=>{commands.push({command,args});await fs.writeFile(args.at(-1),Buffer.from('synthetic output'));return{stdout:''};}});
 const reply=await adapter.process({operation:'convert-media',source:mediaSource(),args:{format:'mp4',speed:4,bitrate:2_000_000},signal:new AbortController().signal});
 const args=commands.find(item=>item.command==='ffmpeg').args;
 assert.equal(reply.parts.at(-1).type,'video');assert.equal(args[args.indexOf('-vf')+1],'setpts=(PTS-STARTPTS)/4');
 assert.equal(args[args.indexOf('-af')+1],'atempo=2,atempo=2');assert.equal(args[args.indexOf('-b:v')+1],'2000000');
 await adapter.release(reply.parts.at(-1).ref);
});

test('TR-0481: invalid speed, bitrate and unsupported format combinations fail before download or process',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-tr-0481-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let downloads=0,runs=0;
 const adapter=createDocumentsMedia({tempDirectory:path.join(root,'botsky-v2-media'),download:async()=>{downloads++;return{buffer:Buffer.from('synthetic'),extension:'mp4'};},
  downloadUrl:async()=>{downloads++;return{buffer:Buffer.from('synthetic'),extension:'mp4'};},run:async()=>{runs++;return{};}});
 const cases=[
  {format:'mp4',speed:0},{format:'mp4',speed:'rapido'},{format:'mp3',bitrate:'128kbps basura'},
  {format:'mp3',bitrate:'1k'},{format:'wav',bitrate:128000},{format:'pdf',speed:2,url:'https://media.invalid/input'}
 ];
 for(const args of cases) await assert.rejects(adapter.process({operation:'convert-media',source:mediaSource(),args,signal:new AbortController().signal}),/Document operation failed/);
 assert.equal(downloads,0);assert.equal(runs,0);
});

test('TR-0482: conversion delivery failure releases the generated audio and does not mask the send error',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-tr-0482-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const adapter=createDocumentsMedia({tempDirectory:path.join(root,'botsky-v2-media'),download:async()=>({buffer:Buffer.from('synthetic source'),extension:'mp4'}),
  run:async(_command,args)=>{await fs.writeFile(args.at(-1),Buffer.from('synthetic output'));return{stdout:''};}});
 const reply=await adapter.process({operation:'convert-media',source:mediaSource(),args:{format:'mp3'},signal:new AbortController().signal});
 const composer=createComposer({messenger:{sendVoice:async()=>{throw Error('fixture delivery failure');}},llm:{},releaseMedia:ref=>adapter.release(ref)});
 await assert.rejects(composer.compose(ctx(),reply),/fixture delivery failure/);
 assert.deepEqual(await fs.readdir(path.join(root,'botsky-v2-media')),[]);
});
