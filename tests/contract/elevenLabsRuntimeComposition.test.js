'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const axios=require('axios');
const {FakeClock}=require('../../src/v2/platform/clock');
const {defaultGraph}=require('../../src/services/phase4CanaryRuntime');

test('default graph constructs ElevenLabs without network I/O and supplies its buffer on demand',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-eleven-runtime-'));
 // Valid synthetic silence keeps the provider fake compatible with actual duration probing.
 const originalGet=axios.get,originalPost=axios.post;const calls=[];
 axios.get=async(url,options)=>{calls.push({method:'get',url,options});return{status:200,data:{voices:[]}};};
 axios.post=async(url,data,options)=>{calls.push({method:'post',url,data,options});return{status:200,data:require('../helpers/syntheticMp3')()};};
 let runtime;
 try{
  const clock=new FakeClock(1000);
  const config={BOT_NUMBER:'15551234567',EVOLUTION_INSTANCE:'test',EVOLUTION_API_URL:'https://evolution.invalid',EVOLUTION_API_KEY:'test-key',
   DATA_DIR:'state',TMP_DIR:path.join(root,'tmp'),ELEVENLABS_API_KEY:'synthetic-eleven-key',MAX_FILE_SIZE_MB:10,MAX_DOCUMENT_SIZE_MB:10,
   ALLOWED_NUMBERS_NORMAL:[],ALLOWED_NUMBERS_ADMIN:[],ALLOWED_NUMBERS_TASKS:[],ALLOWED_GROUPS_NORMAL:[],ALLOWED_GROUPS_ADMIN:[]};
  runtime=await defaultGraph({config,clock,root});
  assert.deepEqual(calls,[],'provider construction must not call HTTP');
  const media=await runtime.media.services.voice.synthesize('Hola, mundo',{voice:'daniel',signal:new AbortController().signal});
  assert.equal(media.mime,'audio/mpeg');
  assert.equal(calls.length,2);
  assert.equal(calls[0].method,'get');assert.equal(calls[0].options.headers['xi-api-key'],'synthetic-eleven-key');
  assert.equal(calls[1].method,'post');assert.equal(calls[1].options.headers['xi-api-key'],'synthetic-eleven-key');
  assert.deepEqual(calls[1].data,{text:'Hola, mundo',model_id:'eleven_multilingual_v2',voice_settings:{stability:0.5,similarity_boost:0.75}});
  await runtime.media.services.voice.release(media.ref);
 }finally{
  await runtime?.dispose();axios.get=originalGet;axios.post=originalPost;await fs.rm(root,{recursive:true,force:true});
 }
});

test('runtime accepts a typed injected ElevenLabs buffer provider without invoking it during assembly',async()=>{
 const {createRuntime}=require('../../src/v2/composition/runtime');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-eleven-injected-'));let calls=0;let runtime;
 try{
  const clock=new FakeClock(2000);const evolutionHttp={post:async()=>({status:200,data:{key:{id:'sent'}}}),get:async()=>{throw Error('unexpected');},put:async()=>{throw Error('unexpected');}};
  const llm={generate:async()=>({ok:false,failure:{kind:'network'}})};const http={post:async()=>{throw Error('unexpected HTTP');}};
  const elevenLabs=async()=>{calls++;return Buffer.from('synthetic');};
  runtime=await createRuntime({config:{BOT_NUMBER:'15551234567',TMP_DIR:path.join(directory,'tmp'),ALLOWED_NUMBERS_NORMAL:[],ALLOWED_NUMBERS_ADMIN:[],ALLOWED_NUMBERS_TASKS:[],ALLOWED_GROUPS_NORMAL:[],ALLOWED_GROUPS_ADMIN:[]},
   clock,evolutionHttp,llm,http,formData:()=>({append(){},getHeaders(){return{};}}),elevenLabs,sidecarDbFilename:path.join(directory,'state','runtime.sqlite'),backupPath:path.join(directory,'state','backup.sqlite')});
  assert.equal(calls,0);
  assert.equal(typeof runtime.media.services.voice.synthesize,'function');
 }finally{await runtime?.dispose();await fs.rm(directory,{recursive:true,force:true});}
});
