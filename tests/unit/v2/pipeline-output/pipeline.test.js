'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../../../helpers/pipeline');
const {createRouter}=require('../../../../src/v2/pipeline/router');
const {createExecutor,validArgs}=require('../../../../src/v2/pipeline/executor');
const {createComposer,errorReply}=require('../../../../src/v2/pipeline/composer');
const {AppError}=require('../../../../src/v2/domain/errors');
const {FakeClock}=require('../../../../src/v2/platform/clock');
const {TieredQueue}=require('../../../../src/v2/platform/queue');
const {normalize}=require('../../../../src/v2/pipeline/normalize');
function context(overrides={}){return{event:normalize(raw('x','Botsky do'),{clock:new FakeClock(1000),botJid:BOT}),addressing:{respond:true,reason:'test',addressedBy:'wake-word'},history:[],correlationId:'x',roles:{admins:[],owners:[]},...overrides};}
function feature(handler=async()=>({parts:[{type:'text',text:'done'}]}),extra={}){return{id:'test',commands:[{name:'do',aliases:['execute'],scope:['group','private'],access:'public',tier:'none',help:{short:'Do',examples:[]},handler,...extra}],intents:[{id:'test.do',description:'Do',schema:{type:'object'},command:'do'}]};}
function good(text){return{ok:true,data:{text,parts:[],toolCalls:[],provider:'gemini'}};}
test('Router uses enabled manifests in strict explicit/session/rule/LLM order',async()=>{
 let calls=0;const llm={generate:async()=>{calls++;return good('{"kind":"chat"}');}};
 const f=feature();const router=createRouter({features:[f],llm});
 const ctx=context();ctx.event.text='!execute';assert.equal((await router.route(ctx)).via,'explicit');
 ctx.event.text='2';ctx.session={id:'s',ownerJid:USER,expiresAt:3000,createdAt:0,resultMessageId:'R',selectionValid:true,feature:'test',name:'do',args:{selection:2}};ctx.addressing.addressedBy='session';assert.equal((await router.route(ctx)).via,'session');
 ctx.addressing.addressedBy='quote-bot';assert.equal((await router.route(ctx)).kind,'chat','Quoting another bot message never grants session continuation');
 ctx.event.text='hello';ctx.event.isGroup=false;assert.equal((await router.route(ctx)).kind,'chat','Private text cannot consume numeric session');ctx.event.text='2';ctx.event.isGroup=true;ctx.session.name='unknown';ctx.addressing.addressedBy='session';assert.equal((await router.route(ctx)).kind,'chat');
 f.rules=[{name:'do',match:()=>true,args:{fixed:true}}];assert.equal((await router.route(ctx)).via,'rule');
 f.enabled=false;assert.equal((await router.route(ctx)).kind,'chat');assert.equal(calls,4);
});
test('Router validates proposal intent and never accepts hallucinated commands',async()=>{
 const ctx=context();ctx.event.text='Botsky haz eso';
 for(const text of ['null','invalid','{"kind":"intent","intent":"missing","args":{}}','{"kind":"intent","intent":"test.do","args":[]}']){
  const router=createRouter({features:[feature()],llm:{generate:async()=>good(text)}});await assert.rejects(router.route(ctx),error=>error.kind==='bad_output');
 }
 const router=createRouter({features:[feature()],llm:{generate:async()=>good('{"kind":"intent","intent":"test.do","args":{"count":2}}')}});assert.equal((await router.route(ctx)).args.count,2);
 const ignored=createRouter({features:[],llm:{generate:async()=>good('{"kind":"ignore"}')}});assert.equal((await ignored.route(ctx)).kind,'ignore');
 const failed=createRouter({features:[],llm:{generate:async()=>({ok:false,failure:{kind:'quota',retryable:true}})}});await assert.rejects(failed.route(ctx),error=>error.kind==='quota');
});
test('Argument schemas reject unknown fields, enum/type/range/required errors',()=>{
 const schema={properties:{n:{type:'integer',minimum:1,maximum:3},s:{type:'string',enum:['yes']},a:{type:'array'},o:{type:'object'}},required:['n'],additionalProperties:false};
 for(const value of [null,[],{}, {n:0},{n:4},{n:1.5},{n:1,s:'no'},{n:1,s:3},{n:1,a:{}},{n:1,o:null},{n:1,o:[]},{n:1,extra:true}])assert.equal(validArgs(value,schema),false);
 assert.equal(validArgs({n:2,s:'yes',a:[],o:{}},schema),true);assert.equal(validArgs({},undefined),true);assert.equal(validArgs({anything:true},{properties:{},required:[]}),true);
});
test('Executor authorizes and validates before handlers for all tiers',async()=>{
 const clock=new FakeClock();const queue=new TieredQueue({clock});let executions=0;
 const handler=async()=>{executions++;return{parts:[{type:'text',text:'done'}]};};
 const llm={generate:async()=>good('Chat')};const ctx=context();
 const decision={kind:'intent',feature:'test',name:'do',args:{},confidence:1,via:'llm'};
 const denied=createExecutor({features:[feature(handler,{access:'owner'})],queue,clock,llm});assert.match((await denied.execute(ctx,decision)).parts[0].text,/permisos/);assert.equal(executions,0);
 const invalid=createExecutor({features:[feature(handler,{argsSchema:{required:['missing']}})],queue,clock,llm});await assert.rejects(invalid.execute(ctx,decision),error=>error.kind==='bad_output');
 const executor=createExecutor({features:[feature(handler)],queue,clock,llm});assert.equal((await executor.execute(ctx,{kind:'ignore'})).parts.length,0);assert.equal((await executor.execute(ctx,{kind:'chat'})).parts[0].text,'Chat');await assert.rejects(executor.execute(ctx,{...decision,name:'unknown'}));
 await executor.execute(ctx,decision);
 const queued=createExecutor({features:[feature(handler,{tier:'light'})],queue,clock,llm});await queued.execute(ctx,decision);assert.equal(executions,2);
 const malformed=createExecutor({features:[feature(async()=>null)],queue,clock,llm});await assert.rejects(malformed.execute(ctx,decision),error=>error.kind==='bad_output');
 const failed=createExecutor({features:[],queue,clock,llm:{generate:async()=>({ok:false,failure:{kind:'network'}})}});await assert.rejects(failed.execute(ctx,{kind:'chat'}),error=>error.kind==='network');
 const timed=createExecutor({features:[feature(async()=>new Promise(()=>{}))],queue,clock,llm,timeoutMs:5});const pending=timed.execute(ctx,decision);await clock.advance(5);await assert.rejects(pending,error=>error.kind==='timeout');queue.dispose();
});
test('Composer sends discriminated parts, chunks, records and tracks provider IDs',async()=>{
 const f=fixture();const records=[],ids=[];
 const composer=createComposer({messenger:Object.fromEntries(['sendText','sendMedia','sendVoice','sendSticker','react'].map(name=>[name,async(...args)=>{f.sent.push({name,args});return{data:{key:{id:'ack'}}};}])),llm:{generate:async()=>good('varied')},record:async(_ctx,text)=>records.push(text),rememberSent:(chat,id)=>ids.push([chat,id]),chunkChars:3});
 const reply={parts:[{type:'text',text:'abcdef'},{type:'image',ref:'img',mime:'image/png',caption:'image'},{type:'video',ref:'vid',mime:'video/mp4'},{type:'document',ref:'doc',mime:'application/pdf'},{type:'audio',ref:'audio',mime:'audio/ogg'},{type:'sticker',ref:'sticker',mime:'image/webp'},{type:'reaction',emoji:'👀',messageId:'x'}]};
 await composer.compose(context(),reply);assert.equal(f.sent.length,8);assert.equal(ids.length,8);assert.deepEqual(records,['abcdef']);
 await assert.rejects(composer.compose(context(),{parts:[{type:'poll',name:'Q',options:['a','b']}]}));assert.throws(()=>createComposer({messenger:{},llm:{},chunkChars:0}));f.dispose();
});
test('Composer variation happens once, with stable fallback on repeated/failed output',async()=>{
 for(const behavior of ['same','failed','throws','varied']){
  let calls=0;const sent=[];const composer=createComposer({messenger:{sendText:async(_to,text)=>{sent.push(text);return{};}},llm:{generate:async()=>{calls++;if(behavior==='throws')throw Error('provider');if(behavior==='failed')return{ok:false,failure:{kind:'quota'}};return good(behavior==='varied'?'different':'same');}},recentReplies:async()=>['same']});
  await composer.compose(context(),{parts:[{type:'text',text:'same'}]});assert.equal(calls,1);assert.equal(sent.length,1);assert.equal(sent[0],behavior==='varied'?'different':'¿Quieres que lo explique de otra forma?');
 }
 assert.match(errorReply(new AppError('quota')).parts[0].text,/cuota/);assert.doesNotMatch(errorReply(Error('API_KEY=secret')).parts[0].text,/secret/);
});
test('Shadow decisions never call business IO; duplicate and denied events remain inert',async()=>{
 const f=fixture();const decision=await f.pipeline.decideOnly(raw('1','Botsky do'));assert.equal(decision.kind,'decision');assert.equal(f.sent.length,0);assert.equal(f.executions.length,0);assert.equal(f.passives.length,0);
 assert.equal((await f.pipeline.decideOnly(raw('1','Botsky do'))).reason,'duplicate');assert.equal((await f.pipeline.decideOnly(null)).reason,'invalid-event');
 assert.equal((await f.pipeline.decideOnly(raw('2','',{private:true,media:true}))).reason,'attachment-suggestion');assert.equal(f.sent.length,0);f.dispose();
 const denied=fixture({pipelineOptions:{accessSnapshot:{blocked:[USER]}}});assert.equal((await denied.handle(raw('3','Botsky'))).kind,'denied');assert.equal((await denied.pipeline.decideOnly(raw('4','Botsky'))).kind,'denied');assert.equal(denied.passives.length,0);denied.dispose();
});
test('Pipeline failures return taxonomy feedback in live and shadow without leaked errors',async()=>{
 const f=fixture({generate:async()=>({ok:false,failure:{kind:'quota'}})});assert.equal((await f.handle(raw('1','Botsky'))).kind,'error');assert.match(f.sent[0].args[1],/cuota/);assert.equal((await f.pipeline.decideOnly(raw('2','Botsky'))).kind,'error');assert.equal(f.sent.length,1);assert.equal((await f.handle(raw('1','Botsky'))).reason,'duplicate');f.dispose();
});

test('Acknowledged sends never repeat after history/cache observation errors; reply IDs survive',async()=>{
 const sent=[];const composer=createComposer({messenger:{sendText:async(...args)=>{sent.push(args);return{messageId:'SENT'};}},llm:{},record:async()=>{throw Error('history');},rememberSent:()=>{throw Error('cache');},recentReplies:async()=>{throw Error('read');}});
 await composer.compose(context(),{replyTo:'MESSAGE',parts:[{type:'text',text:'Sent once'}]});assert.equal(sent.length,1);assert.equal(sent[0][2].quoted.key.id,'MESSAGE');assert.equal(composer.observationFailures,3);
 assert.equal(validArgs({text:'long'},{properties:{text:{type:'string',maxLength:3}}}),false);assert.equal(validArgs({text:''},{properties:{text:{type:'string',minLength:1}}}),false);
 assert.equal(validArgs({n:Infinity},{properties:{n:{type:'number'}}}),false);assert.equal(validArgs({n:0},{properties:{n:{type:'number',minimum:1}}}),false);assert.equal(validArgs({n:4},{properties:{n:{type:'number',maximum:3}}}),false);assert.equal(validArgs({n:2},{properties:{n:{type:'number',minimum:1,maximum:3}}}),true);
});
test('Context read errors remain controlled in live and shadow',async()=>{
 const f=fixture({pipelineOptions:{conversation:{recent:async()=>{throw Error('DB');},recentThread:async()=>{throw Error('DB');}}}});
 assert.equal((await f.handle(raw('fail','Botsky'))).kind,'error');assert.equal(f.sent.length,1);assert.equal((await f.pipeline.decideOnly(raw('shadowfail','Botsky'))).kind,'error');assert.equal(f.sent.length,1);f.dispose();
});

test('Allowlist, addressing and roles use the same phone/device/domain normalization',()=>{
 const {gate}=require('../../../../src/v2/pipeline/gate');const {normalizeJid}=require('../../../../src/v2/domain/jid');const {accessPolicy}=require('../../../../src/v2/policies/access.policy');
 const event=context().event;event.sender.jid='5215551234567:4@c.us';
 assert.equal(normalizeJid(event.sender.jid),'525551234567@s.whatsapp.net');assert.equal(gate(event,{accessSnapshot:{numbers:['525551234567']},now:1000}).allow,true);
 assert.equal(accessPolicy({senderJid:event.sender.jid,chatId:GROUP,isGroup:true,roles:{admins:['525551234567@s.whatsapp.net']},requiredAccess:'admin'}).allow,true);
 assert.equal(normalizeJid('525551234567@g.us'),'525551234567@g.us');assert.equal(normalizeJid('5215551234567@lid'),'5215551234567@lid');
});

test('Delivered replies survive optional observation callback failure',async()=>{
 const f=fixture({pipelineOptions:{onAccept:()=>{},onReply:()=>{throw Error('optional state failed');}}});await f.handle(raw('one','Botsky'));assert.equal(f.sent.length,1);assert.equal(f.pipeline.observationFailures,1);f.dispose();
});
test('recordInbound runs after live addressing only; callback failures are counted without failing replies',async()=>{
 const observed=[];const f=fixture({pipelineOptions:{recordInbound:async ctx=>{observed.push(ctx.event.id);}}});
 assert.equal((await f.handle(raw('addressed','Botsky do',{mentions:[BOT]}))).kind,'reply');
 assert.deepEqual(observed,['addressed']);
 assert.equal((await f.pipeline.decideOnly(raw('shadow','Botsky do',{mentions:[BOT]}))).kind,'decision');
 assert.deepEqual(observed,['addressed']);
 assert.equal((await f.handle(raw('passive','no mention'))).kind,'ignore');
 assert.deepEqual(observed,['addressed']);f.dispose();
 const failed=fixture({pipelineOptions:{recordInbound:async()=>{throw Error('sidecar write failed');}}});
 assert.equal((await failed.handle(raw('write-fails','Botsky do',{mentions:[BOT]}))).kind,'reply');
 assert.equal(failed.pipeline.observationFailures,1);assert.equal(failed.sent.length,1);failed.dispose();
});
test('Application composition enforces admission/cooldown and natural minimal features',async()=>{
 const {createApplication}=require('../../../../src/v2/main');const clock=new FakeClock(1000000);const sent=[];
 const app=createApplication({clock,botJid:BOT,conversation:{recent:async()=>[],recentThread:async()=>[]},messenger:{sendText:async(_chat,text)=>{sent.push(text);return{};}},llm:{generate:async()=>good('{"kind":"intent","intent":"system-info.status","args":{}}')},getStatus:async()=>({version:'2',uptimeMs:60000}),rate:{maxEvents:3,cooldownMs:3000}});
 let pending=app.pipeline.handle(raw('1','Botsky estado'));await Promise.resolve();await clock.advance(1200);assert.equal((await pending).kind,'reply');assert.equal(sent.length,1);
 assert.equal((await app.pipeline.handle(raw('2','Botsky estado'))).reason,'cooldown');await clock.advance(3000);pending=app.pipeline.handle(raw('3','Botsky estado'));await Promise.resolve();await clock.advance(1200);assert.equal((await pending).kind,'reply');assert.equal(sent.length,2);app.dispose();
});

test('Composer stops late multipart/chunk sends and generation after shutdown begins',async()=>{
 let closing=false,release;const sent=[];
 const gate=new Promise(resolve=>{release=resolve;});
 const composer=createComposer({messenger:{sendText:async(_chat,text)=>{sent.push(text);await gate;return{};}},llm:{},isClosed:()=>closing,chunkChars:2});
 const pending=composer.compose(context(),{parts:[{type:'text',text:'abcdef'},{type:'text',text:'second'}]});
 await Promise.resolve();assert.deepEqual(sent,['ab']);closing=true;release();await pending;assert.deepEqual(sent,['ab']);
 assert.deepEqual(await composer.compose(context(),{parts:[{type:'text',text:'third'}]}),{parts:[]});
 let closeAfterRead=false;const afterRead=createComposer({messenger:{sendText:async()=>{throw Error('Must not send');}},llm:{},isClosed:()=>closeAfterRead,recentReplies:async()=>{closeAfterRead=true;return[];}});
 assert.deepEqual(await afterRead.compose(context(),{parts:[{type:'text',text:'reply'}]}),{parts:[]});
 let closeAfterVariation=false;const variation=createComposer({messenger:{sendText:async()=>{throw Error('Must not send');}},llm:{generate:async()=>{closeAfterVariation=true;return good('different');}},isClosed:()=>closeAfterVariation,recentReplies:async()=>['same']});
 assert.deepEqual(await variation.compose(context(),{parts:[{type:'text',text:'same'}]}),{parts:[]});
});
test('Pipeline disposal waits for active model replay and blocks new live/shadow ingress',async()=>{
 let release;const waiting=new Promise(resolve=>{release=resolve;});const f=fixture({generate:async()=>{await waiting;return good('{"kind":"chat"}');}});
 const pending=f.pipeline.decideOnly(raw('pending-shadow','Botsky'));await Promise.resolve();await Promise.resolve();const disposal=f.pipeline.dispose();assert.equal(f.pipeline.dispose(),disposal);
 assert.equal((await f.pipeline.handle(raw('new','Botsky'))).reason,'pipeline-closed');assert.equal((await f.pipeline.decideOnly(raw('new-shadow','Botsky'))).reason,'pipeline-closed');
 let disposed=false;disposal.then(()=>{disposed=true;});await Promise.resolve();assert.equal(disposed,false);release();assert.equal((await pending).reason,'pipeline-closed');await disposal;assert.equal(disposed,true);assert.equal(f.sent.length,0);f.dispose();
});


test('composer releases owned media once after delivery, failure or closure without replacing outcome',async()=>{
 for(const mode of ['success','send-failure','closed','cleanup-failure']) {
  const released=[];let sends=0;
  const composer=createComposer({messenger:{sendMedia:async()=>{sends++;if(mode==='send-failure')throw Error('delivery-failed');return{};}},llm:{},isClosed:()=>mode==='closed',releaseMedia:async ref=>{released.push(ref);if(mode==='cleanup-failure')throw Error('cleanup-failed');}});
  const reply={parts:[{type:'image',ref:'/synthetic/owned.png',mime:'image/png'},{type:'image',ref:'/synthetic/owned.png',mime:'image/png'}]};
  const operation=composer.compose(context(),reply);
  if(mode==='send-failure')await assert.rejects(operation,/delivery-failed/);else await operation;
  assert.deepEqual(released,['/synthetic/owned.png']);
  assert.equal(sends,mode==='closed'?0:mode==='send-failure'?1:2);
  assert.equal(composer.observationFailures,mode==='cleanup-failure'?1:0);
 }
});
