'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {FakeClock}=require('../../../src/v2/platform/clock');
const {createApplication}=require('../../../src/v2/main');
const {loadConfig}=require('../../../src/v2/config');
function raw(id='request',text='/hold'){return{key:{id,remoteJid:'19995550101@s.whatsapp.net'},message:{conversation:text}};}
function good(text){return{ok:true,data:{text,parts:[],toolCalls:[],provider:'gemini'}};}
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};}
function setup(options={}){const clock=new FakeClock(1000);const sends=[];const app=createApplication({clock,botJid:'19995550199@s.whatsapp.net',conversation:{recent:async()=>[]},messenger:{sendText:async(_chat,text)=>{sends.push(text);return{};}},llm:{generate:async()=>good('{"kind":"chat"}')},getStatus:async()=>({}),...options});return{clock,sends,app};}
function holdFeature(tier,handler){return{id:'hold',commands:[{name:'hold',scope:['private','group'],access:'public',tier,help:{short:'hold',examples:[]},handler}]};}
for(const tier of ['heavy','none'])test(`dispose stops ${tier} handler output and waits for genuine settlement`,async()=>{
    const blocked=deferred();let signal;let exits=0;
    const {clock,sends,app}=setup({extraFeatures:[holdFeature(tier,async(_ctx,_args,abort)=>{signal=abort;await blocked.promise;exits++;abort.throwIfAborted();return{parts:[{type:'text',text:'late reply'}]};})]});
    const operation=app.pipeline.handle(raw());await clock.flush();assert.ok(signal);assert.equal(sends.length,0);
    const shutdown=app.dispose();assert.equal(app.dispose(),shutdown);assert.equal(signal.aborted,true);let settled=false;void shutdown.then(()=>{settled=true;});await clock.flush();assert.equal(settled,false,'Blocked handler still owns resources');
    const rejected=await app.pipeline.handle(raw('new'));assert.equal(rejected.kind,'ignore');assert.equal(rejected.reason,'pipeline-closed');
    blocked.resolve();assert.equal((await operation).reason,'pipeline-closed');await shutdown;
    assert.equal(exits,1);assert.equal(sends.length,0);assert.equal(app.queue.stats.heavy.running,0);assert.equal(app.store.size,0);assert.equal(clock.pendingTimers,0);
});
test('dispose waits for route inference without starting chat or sending after close',async()=>{
    const routed=deferred();let calls=0;
    const {clock,sends,app}=setup({llm:{generate:async()=>{calls++;return routed.promise;}}});
    const operation=app.pipeline.handle(raw('route','Botsky hola'));await clock.advance(1200);assert.equal(calls,1);
    const shutdown=app.dispose();let settled=false;void shutdown.then(()=>{settled=true;});await clock.flush();assert.equal(settled,false);
    routed.resolve(good('{"kind":"chat"}'));assert.equal((await operation).reason,'pipeline-closed');await shutdown;assert.equal(calls,1);assert.equal(sends.length,0);assert.equal(clock.pendingTimers,0);
});
test('dispose waits for already running chat inference and suppresses its reply',async()=>{
    const generated=deferred();let calls=0;
    const {clock,sends,app}=setup({llm:{generate:async request=>{calls++;return request.task==='route'?good('{"kind":"chat"}'):generated.promise;}}});
    const operation=app.pipeline.handle(raw('chat','Botsky hola'));await clock.advance(1200);assert.equal(calls,2);
    const shutdown=app.dispose();generated.resolve(good('late response'));assert.equal((await operation).reason,'pipeline-closed');await shutdown;assert.equal(sends.length,0);assert.equal(clock.pendingTimers,0);
});
test('dispose prevents subsequent chunks after an already issued send settles',async()=>{
    const sent=deferred();let calls=0;
    const {clock,app}=setup({messenger:{sendText:async()=>{calls++;return sent.promise;}},extraFeatures:[holdFeature('none',async()=>({parts:[{type:'text',text:'x'.repeat(5000)}]}))]});
    // allowLong permits a multi-chunk payload; the first send started before closure.
    app.features.find(feature=>feature.id==='hold').commands[0].allowLong=true;
    const operation=app.pipeline.handle(raw());await clock.flush();assert.equal(calls,1);
    const shutdown=app.dispose();sent.resolve({});await operation;await shutdown;assert.equal(calls,1);assert.equal(clock.pendingTimers,0);
});
test('disposing an idle application is awaitable, idempotent and cleans all ephemeral state',async()=>{
    const {clock,app}=setup();app.store.set('synthetic','key',true,1000);
    const shutdown=app.dispose();assert.equal(typeof shutdown.then,'function');assert.equal(app.dispose(),shutdown);await shutdown;assert.equal(app.store.size,0);assert.equal(clock.pendingTimers,0);
});
test('central config controls route, chat, repeated-response budgets and private/group character limits',async()=>{
    const clock=new FakeClock(1000);const sends=[];const requests=[];let replyReads=0;
    const app=createApplication({clock,botJid:'19995550199@s.whatsapp.net',conversation:{recent:async()=>[]},
        recentReplies:async()=>++replyReads===1?[]:['A generated answer that is deliberately much longer than the configured limit.'],
        messenger:{sendText:async(_chat,text)=>{sends.push(text);return{};}},
        llm:{generate:async request=>{requests.push(request);if(request.task==='route')return good('{"kind":"chat"}');
            if(request.messages[0]?.parts?.[0]?.text?.startsWith('Restate'))return good('A distinct varied answer that is also longer than the configured limit.');
            return good('A generated answer that is deliberately much longer than the configured limit.');}},getStatus:async()=>({}),
        config:loadConfig({RESPONSE_PRIVATE_MAX_CHARS:'24',RESPONSE_GROUP_MAX_CHARS:'12',LLM_CHAT_MAX_OUTPUT_TOKENS:'77',LLM_ROUTE_MAX_OUTPUT_TOKENS:'33'})});
    const privateReply=app.pipeline.handle(raw('private','Botsky hello'));await clock.advance(1200);await privateReply;
    assert.equal(requests[0].budget.maxOutputTokens,33);
    assert.equal(requests[1].budget.maxOutputTokens,77);
    assert.equal(requests.length,2);
    assert.equal(Array.from(sends.join('')).length,24);
    sends.length=0;requests.length=0;
    const groupReply=app.pipeline.handle({id:'group',chatId:'19995559999@g.us',isGroup:true,sender:{jid:'19995550101@s.whatsapp.net',number:'19995550101',name:'User'},text:'Botsky hello',kind:'text',mentions:[],isFromMe:false,receivedAt:clock.now(),raw:{}});await clock.advance(1200);const groupResult=await groupReply;assert.equal(groupResult.kind,'reply',JSON.stringify(groupResult));
    assert.equal(requests[0].budget.maxOutputTokens,33);
    assert.equal(requests[1].budget.maxOutputTokens,77);
    assert.equal(requests[2].budget.maxOutputTokens,77,'repetition variation uses the configured chat generation budget');
    assert.equal(Array.from(sends.join('')).length,12);
    await app.dispose();
});
