'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {FakeClock}=require('../../src/v2/platform/clock');const {TtlStore}=require('../../src/v2/platform/ttlStore');
const {EchoGuard}=require('../../src/v2/adapters/evolution/echoGuard');
const {createMedia}=require('../../src/v2/adapters/evolution/media');
const {createOutbound}=require('../../src/v2/adapters/evolution/outbound');
const {createClient,withRetry}=require('../../src/v2/adapters/evolution/client');
const clock=new FakeClock();
test('group metadata GET preserves caller cancellation and never starts an already cancelled request',async()=>{
 const localClock=new FakeClock();let calls=0;
 const client=createClient({baseUrl:'https://fake.invalid',apiKey:'fake',clock:localClock,fetch:async(_url,options)=>{
  calls++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
 }});
 const stopped=new AbortController();stopped.abort();await assert.rejects(client.get('/group/test',{signal:stopped.signal}),{name:'AbortError'});assert.equal(calls,0);
 const controller=new AbortController();const pending=client.get('/group/test',{signal:controller.signal,maxContentLength:1024});assert.equal(calls,1);controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(localClock.pendingTimers,0);
});
function guard(){return new EchoGuard({clock,store:new TtlStore({clock})})}
function media(encoded){return createMedia({clock,instance:'test',client:{post:async()=>({status:200,data:{base64:encoded}})}})}
test('Download rejects invalid padding, whitespace-only data and noncanonical trailing bits',async()=>{
 for(const encoded of ['A=','A==','AA=','AAAA==','AB==','AAB=',' \n\t','data:image/png;base64,']){
  await assert.rejects(media(encoded).downloadMedia({key:{id:'x'}}),/no se pudo leer|no devolvió/,encoded);
 }
 for(const encoded of ['AA==','AA','AAA=','AAA','Zm9v']){
  const result=await media(encoded).downloadMedia({key:{id:'x'}});assert.ok(result.buffer.length>0);
 }
});
test('Native rejection with explicit delivery ID never falls back and reports accepted partial delivery',async()=>{
 let requests=0;let recorded=0;const echo=new EchoGuard({clock,store:new TtlStore({clock}),record:()=>recorded++});
 const client=createClient({baseUrl:'http://fake.invalid',apiKey:'fake',clock,fetch:async()=>{
  requests++;return new Response(JSON.stringify({code:'NATIVE_TABLE_UNSUPPORTED',key:{id:'PRIVATE_DELIVERED_ID'},message:'PRIVATE_PROVIDER_TOKEN'}),{status:400});
 }});
 const outbound=createOutbound({client,instance:'test',clock,echoGuard:echo,io:{async stat(){return{size:1}},async readFile(){return Buffer.from('x')}}});
 await assert.rejects(outbound.sendText('19995550101','| A | B |\n| --- | --- |\n| x | y |'),error=>{
  assert.equal(error.sentChunks,1);assert.equal(error.partialDelivery,true);assert.equal(JSON.stringify(error).includes('PRIVATE_'),false);return true;
 });
 assert.equal(requests,1);assert.equal(recorded,1);
});
test('Known outbound IDs never promote identical human quote content after acknowledgement',()=>{
 const echo=guard();const sent=echo.begin('120363000000000001@g.us','Same quoted text');echo.finish(sent,{data:{key:{id:'BOT_REAL_ID'}}});echo.record(sent);
 assert.equal(echo.consume({chatId:sent.jid,messageId:'HUMAN_QUOTE_ID',text:sent.text}),false);
 assert.equal(echo.consume({chatId:sent.jid,messageId:'BOT_REAL_ID',text:'different'}),true);
});
test('Invalid constructor limits fail before network or IO',()=>{
 const client={post:async()=>assert.fail('network'),get:async()=>assert.fail('network'),put:async()=>assert.fail('network')};
 const io={async stat(){assert.fail('IO')},async readFile(){assert.fail('IO')}};
 for(const limit of [0,-1,Infinity,NaN,1e300]){
  assert.throws(()=>createOutbound({client,instance:'test',clock,echoGuard:guard(),io,maxFileSizeMb:limit}),RangeError);
  assert.throws(()=>createMedia({client,instance:'test',clock,maxDownloadBytes:limit}),RangeError);
  assert.throws(()=>new EchoGuard({clock,store:new TtlStore({clock}),maxEntries:limit}),RangeError);
 }
});

test('Acknowledged delivery errors carry only boolean proof and do not retry at any status',async()=>{
 for(const keyLocation of ['key','data','response']){
  let attempts=0;const errorBody={code:'NATIVE_TABLE_UNSUPPORTED',message:'PRIVATE_TOKEN'};
  if(keyLocation==='key')errorBody.key={id:'PRIVATE_DELIVERY_ID'};else errorBody[keyLocation]={key:{id:'PRIVATE_DELIVERY_ID'}};
  const client=createClient({baseUrl:'http://fake.invalid',apiKey:'fake',clock,fetch:async()=>{attempts++;return new Response(JSON.stringify(errorBody),{status:500})}});
  await assert.rejects(withRetry(()=>client.post('/send',{}),clock),error=>{
   assert.equal(error.deliveryAcknowledged,true);assert.equal(error.response.data.deliveryAcknowledged,true);assert.equal(JSON.stringify(error).includes('PRIVATE_'),false);return true;
  });
  assert.equal(attempts,1);assert.equal(clock.pendingTimers,0);
 }
 for(const badId of ['', '   ',123,null]){
  const client=createClient({baseUrl:'http://fake.invalid',apiKey:'fake',clock,fetch:async()=>new Response(JSON.stringify({key:{id:badId}}),{status:400})});
  await assert.rejects(client.post('/send',{}),error=>error.deliveryAcknowledged===false&&error.response.data.deliveryAcknowledged===undefined);
 }
});

test('Media cancellation avoids pre-aborted I/O and aborts an in-flight request without retry timers',async()=>{
 const localClock=new FakeClock();let fetches=0;let childSignal;let started;
 const fetchStarted=new Promise(resolve=>{started=resolve;});
 const client=createClient({baseUrl:'http://fake.invalid',apiKey:'fake',clock:localClock,fetch:async(_url,options)=>{
  fetches++;childSignal=options.signal;started();
  return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}));
 }});
 const api=createMedia({client,instance:'test',clock:localClock});
 const preAborted=new AbortController();preAborted.abort();
 await assert.rejects(api.downloadMedia({key:{id:'PRE'}},{signal:preAborted.signal}),error=>error.name==='AbortError');
 assert.equal(fetches,0);assert.equal(localClock.pendingTimers,0);

 const controller=new AbortController();
 const pending=api.downloadMedia({key:{id:'IN_FLIGHT'}},{signal:controller.signal});
 await fetchStarted;assert.equal(fetches,1);assert.equal(localClock.pendingTimers,1);
 controller.abort();
 await assert.rejects(pending,error=>error.name==='AbortError'||error.code==='ERR_CANCELED');
 assert.equal(childSignal.aborted,true);assert.equal(fetches,1);assert.equal(localClock.pendingTimers,0);
});
