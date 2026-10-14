'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createVoiceMedia}=require('../../../../src/v2/adapters/media/voice');
const {createVoiceFeature}=require('../../../../src/v2/features/voice/manifest');
const {buildConversationStyle}=require('../../../../src/v2/adapters/ai/conversationStyle');
const {AppError}=require('../../../../src/v2/domain/errors');
const {createAiAdapter}=require('../../../../src/v2/adapters/ai');
const {FakeClock}=require('../../../../src/v2/platform/clock');

const signal=()=>new AbortController().signal;
function ctx(overrides={}){
 const jid='15555550123@s.whatsapp.net';
 return{event:{id:'voice-event',chatId:jid,isGroup:false,sender:{jid,name:'Ana'},text:'voz',kind:'text',...overrides},
  addressing:{respond:true,reason:'explicit-command'},history:[{role:'assistant',content:'Mañana se revisa el servidor.'}],correlationId:'voice-trace',roles:{admins:[],owners:[]}};
}
async function adapter(t,options={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-tr-voice-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 return createVoiceMedia({tempDirectory:path.join(root,'botsky-v2-media'),...options});
}
const draft=(text='Mañana revisamos el servidor.',extra={})=>JSON.stringify({mode:'compose',text,voice:'hombre',durationSeconds:null,...extra});

test('TR-0741: speech provider receives complete profanity after formatting cleanup',async t=>{
 const calls=[];
 const media=await adapter(t,{run:async(command,args)=>{
  calls.push({command,args});
  if(command==='ffprobe')return{stdout:'2.5'};
  if(command==='edge-tts')await fs.writeFile(args.at(-1),Buffer.from('synthetic mp3'));
  return{stdout:''};
 }});
 const result=await media.synthesize('*Qué pinche pedo, cabrón.* 😄 No mames. https://example.invalid/x',{voice:'hombre',signal:signal()});
 const edge=calls.find(row=>row.command==='edge-tts');
 assert.ok(edge.args.includes('--text=Qué pinche pedo, cabrón. No mames.'));
 assert.equal(result.durationSeconds,2.5);
 await media.release(result.ref);
});

test('TR-0742: Gemini finish metadata is retained in the result but never replayed as a content part',async()=>{
 const payloads=[];const clock=new FakeClock();
 const ai=createAiAdapter({clock,config:()=>({GEMINI_API_KEY:'fake-gemini'}),http:{post:async(_url,payload)=>{
  payloads.push(structuredClone(payload));
  return{data:{candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:'Mañana revisamos el servidor.'}]}}]}};
 }}});
 const budget={maxOutputTokens:800,timeoutMs:30000};
 const first=await ai.generate({task:'agent',budget,messages:[{role:'system',parts:[{text:'voice system'}]},{role:'user',parts:[{text:'voice request and context'}]}]});
 assert.equal(first.ok,true);
 if(!first.ok)return;
 assert.equal(first.data.finishReason,'STOP');
 assert.deepEqual(first.data.parts,[{text:'Mañana revisamos el servidor.'}]);
 const second=await ai.generate({task:'agent',budget,messages:[{role:'assistant',parts:first.data.parts},{role:'user',parts:[{text:'revise'}]}]});
 assert.equal(second.ok,true);
 assert.equal(payloads.length,2);
 assert.deepEqual(payloads[1].contents,[
  {role:'model',parts:[{text:'Mañana revisamos el servidor.'}]},
  {role:'user',parts:[{text:'revise'}]},
 ]);
 assert.equal(JSON.stringify(payloads[1].contents).includes('finishReason'),false);
 assert.equal(first.data.finishReason,'STOP','provider completion metadata remains available outside replayable content');
});

test('TR-0750: Gemini-to-Groq voice fallback preserves the same request, quote and history context',async t=>{
 const calls=[];const clock=new FakeClock();
 const ai=createAiAdapter({clock,config:()=>({GEMINI_API_KEY:'fake-gemini',GROQ_API_KEY:'fake-groq'}),http:{post:async(url,payload)=>{
  calls.push({url,payload:structuredClone(payload)});
  if(url.includes('generativelanguage.googleapis.com'))throw Object.assign(new Error('temporary Gemini outage'),{response:{status:503,data:{error:{message:'unavailable'}}}});
  return{data:{choices:[{finish_reason:'stop',message:{content:draft('El servicio vuelve mañana.')}}]}};
 }}});
 const media=await adapter(t,{callLLM:async input=>{
  const result=await ai.generate({task:'agent',budget:{maxOutputTokens:input.maxOutputTokens,timeoutMs:30000},messages:[
   {role:'system',parts:[{text:input.system}]},{role:'user',parts:[{text:input.user}]},
  ]});
  if(!result.ok)throw new AppError(result.failure.kind);
  return{text:result.data.text,finishReason:result.data.finishReason||undefined};
 }});
 const result=await media.prepareScript({request:'haz un audio de la cita',quotedText:'El servicio vuelve mañana.',history:[{role:'assistant',content:'Ya revisamos los logs.'}],mode:'compose'},signal());
 assert.equal(result.success,true);
 assert.equal(result.text,'El servicio vuelve mañana.');
 assert.equal(calls.length,2);
 assert.match(calls[0].url,/generativelanguage\.googleapis\.com/);
 assert.match(calls[1].url,/api\.groq\.com/);
 const geminiContext=calls[0].payload.contents[0].parts[0].text;
 const groqUser=calls[1].payload.messages.find(message=>message.role==='user').content;
 assert.equal(geminiContext,groqUser,'provider fallback receives byte-for-byte equivalent voice context');
 assert.match(geminiContext,/El servicio vuelve mañana\./);
 assert.match(geminiContext,/Ya revisamos los logs\./);
 assert.match(geminiContext,/haz un audio de la cita/);
 assert.equal(calls[1].payload.messages.find(message=>message.role==='system').content,calls[0].payload.systemInstruction.parts[0].text);
});

test('TR-0743: composed script uses the request, quote and recent history without speaking the instruction',async t=>{
 let received;
 const media=await adapter(t,{callLLM:async input=>{received=input;return{text:draft('El servidor se reinicia mañana.'),finishReason:'STOP'};}});
 const result=await media.prepareScript({request:'manda un audio explicando lo de mañana',quotedText:'El servicio vuelve mañana.',history:[{role:'assistant',content:'Ya revisamos logs.'}],mode:'compose'},signal());
 const payload=JSON.parse(received.user);
 assert.equal(payload.peticion,'manda un audio explicando lo de mañana');
 assert.equal(payload.cita,'El servicio vuelve mañana.');
 assert.equal(payload.historial[0].content,'Ya revisamos logs.');
 assert.equal(result.text,'El servidor se reinicia mañana.');
 assert.notEqual(result.text,payload.peticion);
});

test('TR-0744: a 30-second request uses a spoken-word target separate from output-token budget',async t=>{
 let received;
 const media=await adapter(t,{callLLM:async input=>{received=input;return{text:draft(),finishReason:'STOP'};}});
 const result=await media.prepareScript({request:'resume la reunión',durationSeconds:30,mode:'compose'},signal());
 assert.equal(result.durationSeconds,30);
 assert.match(received.system,/cerca de 72 palabras/);
 assert.match(received.system,/30 segundos/);
 assert.equal(received.maxOutputTokens,800,'voice length target does not become a chat token quota');
});

test('TR-0745: explicit verbatim wording bypasses composition and preserves profanity',async t=>{
 let calls=0;
 const media=await adapter(t,{callLLM:async()=>{calls++;return{text:draft()};}});
 const result=await media.prepareScript({request:'voz goku Qué pinche pedo, cabrón.',literalText:'Qué pinche pedo, cabrón.',mode:'verbatim',voice:'goku'},signal());
 assert.deepEqual(result,{success:true,mode:'verbatim',text:'Qué pinche pedo, cabrón.',voice:'goku',durationSeconds:null});
 assert.equal(calls,0);
});

test('TR-0746: requested vulgar style is retained in the composed voice instructions',async t=>{
 let received;
 const media=await adapter(t,{buildStyle:input=>buildConversationStyle({userMessage:input.request,userName:'Ana',history:input.history}),
  callLLM:async input=>{received=input;return{text:draft('No mames, qué pinche desastre.'),finishReason:'STOP'};}});
 const result=await media.prepareScript({request:'haz un audio bien vulgar sobre el desastre',mode:'compose'},signal());
 assert.match(received.system,/Puedes usar groserías y vulgaridades fuertes/);
 assert.match(JSON.parse(received.user).peticion,/bien vulgar/);
 assert.equal(result.text,'No mames, qué pinche desastre.');
});

test('TR-0747: missing topic asks for clarification without synthesizing a blank or literal command',async()=>{
 let syntheses=0;
 const feature=createVoiceFeature({prepareScript:async()=>({success:false,needsClarification:true,question:'¿Sobre qué tema?'}),
  synthesize:async()=>{syntheses++;return{ref:'voice',mime:'audio/mpeg'};},fitDuration:async media=>media});
 const reply=await feature.commands[0].handler(ctx(),{instruction:'haz un audio'},signal());
 assert.equal(reply.parts[0].text,'¿Sobre qué tema?');assert.equal(syntheses,0);
});

test('TR-0748: malformed and echoed drafts never reach the voice synthesizer',async t=>{
 for(const answer of ['not JSON',draft('haz un audio diciendo que ya voy')]){
  const media=await adapter(t,{callLLM:async()=>({text:answer,finishReason:'STOP'})});let syntheses=0;
  const feature=createVoiceFeature({prepareScript:(input,abort)=>media.prepareScript(input,abort),
   synthesize:async()=>{syntheses++;return{ref:'voice',mime:'audio/mpeg'};},fitDuration:async value=>value});
  const reply=await feature.commands[0].handler(ctx(),{instruction:'haz un audio diciendo que ya voy',mode:'compose'},signal());
  assert.equal(reply.parts[0].type,'text');assert.equal(syntheses,0);
 }
});

test('TR-0749: invalid duration asks for clarification before any provider request',async t=>{
 let calls=0;
 const media=await adapter(t,{callLLM:async()=>{calls++;return{text:draft()};}});
 for(const durationSeconds of [0,-1,601,Infinity]){
  const result=await media.prepareScript({request:'saluda',durationSeconds,mode:'compose'},signal());
  assert.equal(result.needsClarification,true);
 }
 assert.equal(calls,0);
});

test('TR-0751: provider errors and truncated output never fall back to reading the request literally',async t=>{
 const truncated=await adapter(t,{callLLM:async()=>({text:draft('Texto parcial'),finishReason:'length'})});
 const partial=await truncated.prepareScript({request:'graba un audio contando lo de ayer',mode:'compose'},signal());
 assert.equal(partial.success,false);assert.equal(partial.text,undefined);
 const failed=await adapter(t,{callLLM:async()=>{throw new AppError('network');}});
 await assert.rejects(failed.prepareScript({request:'graba un audio contando lo de ayer',mode:'compose'},signal()),{kind:'network'});
});

test('TR-0752: image context is sent as vision data and a vision failure has no text-only retry',async t=>{
 const received=[];
 const media=await adapter(t,{callLLM:async input=>{received.push(input);throw new AppError('unsupported_media');}});
 await assert.rejects(media.prepareScript({request:'explica esta imagen en un audio',mode:'compose',mediaContext:{inlineData:{mimeType:'image/png',data:'cG5n'}}},signal()),{kind:'unsupported_media'});
 assert.equal(received.length,1);
 assert.deepEqual(received[0].media,{mimeType:'image/png',data:'cG5n'});
 assert.match(received[0].user,/"tratar_como_dato":true/);
});
