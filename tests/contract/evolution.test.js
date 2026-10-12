'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const http=require('node:http'); const {once}=require('node:events');
const {FakeClock}=require('../../src/v2/platform/clock');
const {TtlStore}=require('../../src/v2/platform/ttlStore');
const {EchoGuard}=require('../../src/v2/adapters/evolution/echoGuard');
const {createClient,withRetry}=require('../../src/v2/adapters/evolution/client');
const {createEvolutionAdapter}=require('../../src/v2/adapters/evolution');
async function setup(t){
 const requests=[];let handler=()=>({status:201,data:{key:{id:'ACK'}}});
 const server=http.createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',async()=>{
 const request={method:req.method,url:req.url,headers:req.headers,body:chunks.length?JSON.parse(Buffer.concat(chunks)):null}; requests.push(request);
 const result=await handler(request);res.writeHead(result.status,{'content-type':'application/json'});res.end(JSON.stringify(result.data));});});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const clock=new FakeClock();const records=[];const echo=new EchoGuard({clock,store:new TtlStore({clock,maxEntries:10000}),record:(jid,text)=>records.push({jid,text})});
 const client=createClient({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'fake-key',clock});
 const bytes=Buffer.from('fake file');const io={async stat(){return{size:bytes.length}},async readFile(){return bytes}};
 const adapter=createEvolutionAdapter({client,instance:'fixture',clock,echoGuard:echo,io,history:{addMessage:(jid,role,text)=>records.push({jid,text})}});
 t.after(async()=>{echo.dispose();clock.dispose();server.closeAllConnections();await new Promise(r=>server.close(r));});
 return{requests,records,clock,echo,adapter,client,io,setHandler(fn){handler=fn}};
}
test('Actual HTTP text, mentions, formatting, edit, presence and reactions match Evolution contracts',async t=>{
 const h=await setup(t);const a=h.adapter;
 await a.sendText('19995550101','**Hola**',{mentions:['19995550102'],delay:0});
 assert.equal(h.requests[0].url,'/message/sendText/fixture');assert.equal(h.requests[0].headers.apikey,'fake-key');
 assert.deepEqual(h.requests[0].body,{number:'19995550101@s.whatsapp.net',text:'*Hola*',delay:0,presence:'composing',options:{delay:0,presence:'composing',mentions:{everyOne:false,mentioned:['19995550102@s.whatsapp.net']}}});
 assert.equal(a.consumeOutboundEcho({chatId:'19995550101',messageId:'ACK',text:'*Hola*'}),true);assert.equal(h.records.length,1);
 await a.edit('19995550101','nuevo',{id:'ACK'});assert.equal(h.requests.at(-1).method,'PUT');
 await assert.rejects(a.edit('x','y',{}),/inválida/);
 await a.react('19995550101','👍',{id:'human',participant:'990000000001@lid',fromMe:true});
 assert.equal(h.requests.at(-1).body.key.participant,'990000000001@lid');assert.equal(h.requests.at(-1).body.key.fromMe,true);
 await a.sendReaction('19995550101','👀','id');assert.equal(h.requests.at(-1).body.key.fromMe,false);
 await a.typing('19995550101');await a.sendRecording('19995550101',100);
 assert.equal(h.requests.at(-1).body.presence,'recording');assert.equal(await a.sendText('','empty'),null);
});
test('Media overloads, captions, stickers, voice and polls preserve real HTTP payloads',async t=>{
 const h=await setup(t);const a=h.adapter;
 await a.sendMedia('19995550101','/tmp/fake.mp4',{caption:'**Video**',isHd:true,viewOnce:true,mimetype:'video/mp4',delayMs:0,fileName:'demo.mp4'});
 const media=h.requests.at(-1).body;assert.equal(media.media,Buffer.from('fake file').toString('base64'));assert.equal(media.mediatype,'video');assert.equal(media.caption,'*Video*');assert.equal(media.viewOnce,true);assert.equal(media.delay,0);assert.equal(media.fileName,'demo.mp4');
 await a.sendMedia('19995550101','/tmp/file.bin','doc',{forceDocument:true,customFileName:'doc.bin'});assert.equal(h.requests.at(-1).body.mediatype,'document');
 await a.sendSticker('19995550101','/tmp/fake.webp');assert.equal(h.requests.at(-1).body.notConvertSticker,undefined);
 await a.sendAnimatedSticker('19995550101','/tmp/fake.webp');assert.equal(h.requests.at(-1).body.notConvertSticker,true);
 await a.sendVoice('19995550101','/tmp/fake.ogg',{transcript:'hola',durationSeconds:2.2});assert.equal(h.requests.at(-1).url,'/message/sendWhatsAppAudio/fixture');assert.equal(h.requests.at(-1).body.encoding,true);
 assert.ok(h.records.some(r=>r.text==='[Nota de voz de 2 s: hola]'));
 await a.sendPoll('19995550101','Elige',['A','B']);assert.equal(h.requests.at(-1).body.selectableCount,1);
 h.io.stat=async()=>({size:300*1024*1024});await assert.rejects(a.sendMedia('x','/tmp/large.bin'),/supera/);await assert.rejects(a.sendSticker('x','/tmp/large.webp'),{code:'MEDIA_TOO_LARGE'});
});
test('Groups preserve LID participants, query encoding, settings, delete key and response shape',async t=>{
 const h=await setup(t);const a=h.adapter;const group='120363000000000001@g.us';
 assert.equal((await a.groupInfo(group)).status,201);assert.equal(h.requests.at(-1).url,`/group/findGroupInfos/fixture?groupJid=${encodeURIComponent(group)}`);
 await a.getGroupInviteCode(group);await a.updateParticipant(group,'remove',['990000000001@lid','+1 (999) 555-0101','tiny']);
 assert.deepEqual(h.requests.at(-1).body,{action:'remove',participants:['990000000001@lid','19995550101']});
 await a.updateGroupSetting(group,'announcement');assert.equal(h.requests.at(-1).body.action,'announcement');
 await a.delete(group,{id:'x',fromMe:true});assert.equal(h.requests.at(-1).body.key.fromMe,true);
});
test('Native tables fall back only on definitive rejection and uncertain POSTs never repeat',async t=>{
 const h=await setup(t);const table='| A | B |\n| --- | --- |\n| one | two |';
 h.setHandler(req=>req.url.includes('sendNativeTable')?{status:400,data:{code:'NATIVE_TABLE_UNSUPPORTED'}}:{status:201,data:{key:{id:'fallback'}}});
 await h.adapter.sendText('19995550101',table);assert.equal(h.requests.length,2);assert.ok(h.requests[1].body.text.includes('A: one'));
 h.setHandler(()=>({status:500,data:{message:'uncertain'}}));
 const before=h.requests.length;await assert.rejects(h.adapter.sendText('19995550101','message'),error=>error.sentChunks===0&&error.partialDelivery===false);assert.equal(h.requests.length,before+1);
 h.setHandler(()=>({status:400,data:{code:'INSTANCE_NOT_FOUND'}}));const previous=h.requests.length;await assert.rejects(h.adapter.sendText('19995550101',table));assert.equal(h.requests.length,previous+1);
});
test('Downloads hydrate key-only quotes, validate bounded base64, and infer PDF and image signatures',async t=>{
 const h=await setup(t);const a=h.adapter;const key={id:'request',remoteJid:'19995550101@s.whatsapp.net',fromMe:false};
 h.setHandler(()=>({status:200,data:{base64:'data:application/pdf;base64,JVBERg==',mediaType:'document'}}));
 const result=await a.downloadMedia({key,quotedStanzaId:'original',quotedFromMe:true,quotedParticipant:'bot@s.whatsapp.net',message:{documentMessage:{fileName:'sample.PDF',mimetype:'application/pdf'}}},{maxBytes:4});
 assert.equal(result.buffer.toString(),'%PDF');assert.equal(result.extension,'pdf');assert.equal(result.mimeType,'application/pdf');
 assert.deepEqual(h.requests.at(-1).body.message,{key:{...key,id:'original',participant:'bot@s.whatsapp.net',fromMe:true}});
 h.setHandler(()=>({status:200,data:{base64:Buffer.from('GIF89a').toString('base64'),mediaType:'imageMessage'}}));
 const gif=await a.downloadMedia({key,message:{imageMessage:{mediaKey:'fake-key',mimetype:'image/gif'}}});assert.equal(gif.extension,'gif');assert.ok(h.requests.at(-1).body.message.message);
 await assert.rejects(a.downloadMedia({key},{maxBytes:2}),{code:'MEDIA_TOO_LARGE'});
 h.setHandler(()=>({status:200,data:{base64:'%%%'}}));await assert.rejects(a.downloadMedia({key}),/no se pudo leer/);
 h.setHandler(()=>({status:400,data:{message:'Message not found expired'}}));await assert.rejects(a.downloadMedia({key}),{code:'MEDIA_UNAVAILABLE'});
 await assert.rejects(a.downloadMedia({key},{maxBytes:0}),RangeError);
});
test('HTTP client limits response bytes and never retains credentials/body in errors',async t=>{
 const h=await setup(t);h.setHandler(()=>({status:200,data:{big:'x'.repeat(1000)}}));
 await assert.rejects(h.client.post('/large',{}, {maxContentLength:50}),err=>err.response.status===413&&!JSON.stringify(err).includes('fake-key'));
 await assert.rejects(h.client.get('//external.example'),TypeError);
});
test('Retry delay is injected; definitive errors and oversized media never retry',async()=>{
 const clock=new FakeClock();let calls=0;const pending=withRetry(async()=>{if(++calls<3)throw new Error('transient');return'ok'},clock);
 await clock.flush();await clock.advance(1500);await clock.advance(1500);assert.equal(await pending,'ok');assert.equal(calls,3);
 for(const error of [Object.assign(new Error(),{code:'MEDIA_TOO_LARGE'}),Object.assign(new Error(),{response:{status:403}})])await assert.rejects(withRetry(async()=>{throw error},clock),e=>e===error);
});

test('Messenger quote and delayMs options serialize without inventing message ownership',async t=>{
 const h=await setup(t);const quoted={key:{id:'human',remoteJid:'19995550101@s.whatsapp.net',fromMe:false},message:{conversation:'Human text'}};
 await h.adapter.sendText('19995550101','reply',{quoted,delayMs:12});assert.deepEqual(h.requests.at(-1).body.quoted,quoted);assert.equal(h.requests.at(-1).body.delay,12);
 await h.adapter.sendMedia('19995550101','/tmp/image.jpg',{caption:'reply',quoted});assert.deepEqual(h.requests.at(-1).body.quoted,quoted);
});
test('Client timeout uses injected clock, transport rejects generically and cancels timer',async()=>{
 const clock=new FakeClock();let sawSignal;
 const client=createClient({baseUrl:'http://fake.invalid',apiKey:'secret',clock,timeoutMs:10,
 fetch:async(_,options)=>new Promise((resolve,reject)=>{sawSignal=options.signal;sawSignal.addEventListener('abort',()=>reject(new Error('SECRET_SOURCE')));})});
 const request=client.get('/x');const rejected=assert.rejects(request,error=>error.message==='Evolution request timed out'&&!JSON.stringify(error).includes('SECRET_SOURCE'));
 await clock.advance(10);await rejected;assert.equal(sawSignal.aborted,true);assert.equal(clock.pendingTimers,0);
});
test('Pre-ACK native echo proves delivery despite HTTP failure without replay or duplicate history',async t=>{
 const h=await setup(t);const {buildNativeTableMessage,extractNativeTableText}=require('../../src/v2/adapters/evolution/whatsappText');
 h.setHandler(req=>{const text=extractNativeTableText(buildNativeTableMessage(req.body.table));assert.equal(h.adapter.consumeOutboundEcho({chatId:req.body.number,messageId:'early',text}),true);return{status:500,data:{message:'failed after delivery'}}});
 await assert.rejects(h.adapter.sendText('19995550101','| A | B |\n| --- | --- |\n| a\\|b | `x|y` |'),error=>error.sentChunks===1&&error.partialDelivery);
 assert.equal(h.requests.length,1);assert.equal(h.records.length,1);assert.ok(h.records[0].text.includes('a\\|b'));
});
test('Chunk and caption failures report accepted partial delivery without replay',async t=>{
 const h=await setup(t);let requests=0;h.setHandler(()=>++requests===1?{status:201,data:{key:{id:'first'}}}:{status:500,data:{message:'failed'}});
 await assert.rejects(h.adapter.sendText('19995550101','long paragraph '.repeat(20),{maxLength:64}),error=>error.sentChunks===1&&error.partialDelivery);
 assert.equal(h.requests.length,2);requests=0;
 await assert.rejects(h.adapter.sendMedia('19995550101','/tmp/file.jpg','caption '.repeat(250)),error=>error.sentMedia===true&&error.partialDelivery===true);
 assert.equal(h.requests.filter(req=>req.url.includes('sendMedia')).length,1);
});
test('Download MIME/filename and PNG/WebP magic detection preserve actual media variants',async t=>{
 const h=await setup(t);const key={id:'x',remoteJid:'19995550101@s.whatsapp.net'};
 for(const [bytes,extension]of[[Buffer.from([0x89,0x50,0x4e,0x47]),'png'],[Buffer.from('RIFFxxxxWEBP'),'webp']]){
  h.setHandler(()=>({status:200,data:{base64:bytes.toString('base64'),mediaType:'image'}}));assert.equal((await h.adapter.downloadMedia({key,message:{imageMessage:{}}})).extension,extension);
 }
 for(const [mime,extension]of[['application/vnd.openxmlformats-officedocument.wordprocessingml.document','docx'],['application/msword','doc'],['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','xlsx'],['application/vnd.openxmlformats-officedocument.presentationml.presentation','pptx']]){
  h.setHandler(()=>({status:200,data:{base64:'ZmlsZQ==',mediaType:'documentMessage',mimeType:mime}}));const result=await h.adapter.downloadMedia({key,message:{documentWithCaptionMessage:{message:{documentMessage:{mimetype:mime}}}}});assert.equal(result.extension,extension);assert.equal(result.mimeType,mime);
 }
 h.setHandler(()=>({status:200,data:{}}));await assert.rejects(h.adapter.downloadMedia({key}),/no devolvió/);
 h.setHandler(()=>({status:400,data:{message:'Failed to fetch stream mmg.whatsapp.net'}}));await assert.rejects(h.adapter.downloadMedia({key}),{code:'MEDIA_DOWNLOAD_FAILED'});
});

test('Provider error bodies cannot escape into serializable errors while safe protocol hints survive',async t=>{
 const h=await setup(t);h.setHandler(()=>({status:400,data:{code:'NATIVE_TABLE_INVALID',message:'PRIVATE_ADDRESS token=PRIVATE_TOKEN',nested:{apiKey:'PRIVATE_KEY'}}}));
 await assert.rejects(h.client.post('/private',{private:'request'}),error=>{
  assert.equal(error.response.status,400);assert.deepEqual(error.response.data,{code:'NATIVE_TABLE_INVALID'});
  assert.equal(JSON.stringify(error).includes('PRIVATE_'),false);assert.equal(JSON.stringify(error).includes('request'),false);return true;
 });
 h.setHandler(()=>({status:400,data:{response:{message:'Download Media failed for PRIVATE_PHONE at mmg.whatsapp.net?token=PRIVATE_TOKEN'}}}));
 await assert.rejects(h.client.get('/private'),error=>{assert.deepEqual(error.response.data,{message:'Download Media failed'});assert.equal(JSON.stringify(error).includes('PRIVATE_'),false);return true});
});
