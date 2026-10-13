'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {FakeClock}=require('../../../src/v2/platform/clock');
const {createShadowObserver,createNullMessenger}=require('../../../src/v2/platform/shadow');
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
function create(options={}){const clock=new FakeClock(1000);const output=[];return{clock,output,observer:createShadowObserver({clock,decideOnly:async()=>({kind:'ignore',respond:false,reason:'group-not-addressed'}),writeDiff:diff=>output.push(diff),...options})}}
test('Admission is nonblocking and bounded; only safe decision category vocabulary reaches sink',async()=>{
 const pending=deferred();let calls=0;const {observer,clock,output}=create({maxPending:2,decideOnly:async()=>{calls++;await pending.promise;return{kind:'decision',addressing:{respond:false,reason:'group-not-addressed'},decision:{kind:'ignore',via:'rule',feature:'PRIVATE_PHONE_APIKEY',args:{secret:'PRIVATE_KEY'},name:'PRIVATE_USER'}}}});
 const raw={data:{message:'PRIVATE_TEXT',jid:'PRIVATE_PHONE',apiKey:'PRIVATE_KEY'}};
 assert.equal(observer.observe(raw,{kind:'chat',respond:true,reason:'PRIVATE_TEXT',raw}),true);
 assert.equal(calls,0);assert.equal(observer.observe(raw,{kind:'chat',respond:true}),true);
 assert.equal(observer.observe(raw,Promise.reject(new Error('PRIVATE_TOKEN'))),false);
 await clock.flush();assert.equal(calls,1);assert.equal(observer.stats().pending,2);assert.equal(observer.stats().dropped,1);
 pending.resolve();await observer.flush();assert.equal(calls,2);assert.equal(output.length,2);
 assert.equal(JSON.stringify(output).includes('PRIVATE_'),false);assert.equal(output[0].category,'v2-less');assert.equal(output[0].v1_decision.reason,'unknown');
 assert.equal(observer.stats().processed,2);await observer.dispose();assert.equal(clock.pendingTimers,0);
});
test('Comparator treats unknown v1 as unknown and records more/same/changed without inventing a decision',async()=>{
 const clock=new FakeClock();const output=[];let v2={kind:'chat',respond:true,reason:'private-chat'};
 const observer=createShadowObserver({clock,decideOnly:async()=>v2,writeDiff:diff=>output.push(diff),allowedFeatures:['help']});
 observer.observe({},undefined);await observer.flush();assert.equal(output.at(-1).category,'unknown');
 observer.observe({},{kind:'ignore',respond:false});await observer.flush();assert.equal(output.at(-1).category,'v2-more');
 observer.observe({},v2);await observer.flush();assert.equal(output.at(-1).category,'same');
 v2={kind:'command',respond:true,feature:'help',via:'explicit',reason:'private-chat'};
 observer.observe({},{kind:'chat',respond:true});await observer.flush();assert.equal(output.at(-1).category,'changed');assert.equal(output.at(-1).v2_decision.feature,'help');
 await observer.dispose();
});
test('Decision, v1 and sink exceptions are counted without leaking errors or clearing slots prematurely',async()=>{
 const clock=new FakeClock();const gate=deferred();let signal;const output=[];
 const observer=createShadowObserver({clock,timeoutMs:10,maxPending:1,decideOnly:async(_,abort)=>{signal=abort;return gate.promise},writeDiff:diff=>output.push(diff)});
 observer.observe({},Promise.resolve({kind:'chat'}));await clock.flush();await clock.advance(10);
 assert.equal(signal.aborted,true);assert.equal(observer.stats().exceptions,1);assert.equal(observer.stats().pending,1);assert.equal(observer.observe({},{}),false);
 gate.resolve({kind:'chat',respond:true});await observer.flush();assert.equal(output[0].v2_decision.kind,'unknown');await observer.dispose();
 const errors=create({decideOnly:async()=>{throw Error('PRIVATE_STACK')},writeDiff:()=>{throw Error('PRIVATE_IO')}});
 errors.observer.observe({},Promise.reject(Error('PRIVATE_V1')));await errors.observer.flush();assert.equal(errors.observer.stats().exceptions,3);await errors.observer.dispose();
});
test('Stop drops queued raw input, aborts active decision and prevents future admission',async()=>{
 const pending=deferred();let signal;const {observer,clock}=create({decideOnly:async(_,abort)=>{signal=abort;return pending.promise}});
 observer.observe({},{});observer.observe({},{});await clock.flush();observer.stop();assert.equal(signal.aborted,true);assert.equal(observer.stats().dropped,1);
 assert.equal(observer.observe({},{}),false);assert.equal(observer.stats().dropped,2);
 pending.resolve({kind:'ignore'});await observer.dispose();assert.equal(observer.stats().pending,0);
 const stopped=observer.stats().observedUntil;await clock.advance(1000);assert.equal(observer.stats().observedUntil,stopped);assert.equal(observer.stats().elapsedMs,stopped-observer.stats().startedAt);
});
test('Checkpoint validates monotonic counters and restart begins a new continuity segment',async()=>{
 const previous={startedAt:100,observedUntil:500,observed:3,processed:2,exceptions:1,dropped:2};
 const {observer,clock}=create({initialCheckpoint:previous});const stats=observer.stats();assert.equal(stats.startedAt,1000);assert.equal(stats.previousObservedUntil,500);assert.equal(stats.observed,3);
 await clock.advance(86400000);assert.equal(observer.stats().elapsedMs,86400000);assert.equal(observer.checkpoint().startedAt,1000);await observer.dispose();
 for(const checkpoint of [{...previous,observedUntil:1001},{...previous,processed:4},{...previous,dropped:-1},{...previous,startedAt:600}])assert.throws(()=>create({initialCheckpoint:checkpoint}),RangeError);
 for(const options of [{maxPending:0},{maxPending:1001},{timeoutMs:0}])assert.throws(()=>create(options),RangeError);
 assert.throws(()=>create({clock:{now:()=>NaN}}),RangeError);
});
test('NullMessenger traps every port method and input accessors are not serialized',async()=>{
 const nullMessenger=createNullMessenger();
 for(const operation of Object.values(nullMessenger))assert.throws(()=>operation(),error=>error.code==='SHADOW_IO');
 let reads=0;const decision={kind:'chat',get args(){reads++;throw Error('PRIVATE_GETTER')},get reason(){reads++;throw Error('PRIVATE_GETTER')}};
 const {observer,output}=create({decideOnly:async()=>decision});observer.observe({},decision);await observer.flush();assert.equal(reads,0);assert.equal(JSON.stringify(output).includes('PRIVATE_'),false);await observer.dispose();
});
