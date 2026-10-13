'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const {installHooks}=require('../../../scripts/refactor/phase3-shadow-hooks.cjs');
function setup(){const records=[],events=[],calls=[];const modules={};const Module={_load(request){if(!(request in modules))throw Error('undeclared module');return modules[request];},_resolveFilename(request){return request==='express'?request:'/fixture/'+request;}};const runtime={recordV1Decision:value=>records.push(value),observeWebhook:value=>events.push(value)};return{records,events,calls,modules,Module,runtime};}
test('Shadow hooks acknowledge first and preserve original webhook behavior',async()=>{
 const f=setup();let handler;f.modules.express=()=>({post(route,fn){handler=fn;return this;}});const originalLoad=f.Module._load;const hooks=installHooks(f);const express=f.Module._load('express');express().post('/webhook',async(req,res)=>{res.sendStatus(200);f.calls.push('business');});const response={sendStatus(code){f.calls.push('ack:'+code);return this;}};
 f.runtime.observeWebhook=value=>{f.calls.push('shadow');f.events.push(value);};await handler({body:{event:'messages.upsert'}},response);assert.deepEqual(f.calls,['ack:200','shadow','business']);assert.equal(f.events.length,1);hooks.stop();assert.equal(f.Module._load,originalLoad);
});
test('Actual ignored AI branch and command decision are observed without extra calls',async()=>{
 const f=setup();let routes=0,operations=0;
 f.modules['src/services/ai.js']={routeWithAIOutcome:async()=>{routes++;return{ok:true,decision:{action:'ignore',addressed_to_bot:false}};}};
 f.modules['src/services/commandUsageRuntime.js']={track:(_name,_from,run)=>run()};
 f.modules['src/core/dispatcher.js']={dispatch:async()=>{await f.modules['src/services/ai.js'].routeWithAIOutcome('x','user',true);}};
 const hooks=installHooks(f);const ai=f.Module._load('src/services/ai.js');const tracker=f.Module._load('src/services/commandUsageRuntime.js');const dispatch=f.Module._load('src/core/dispatcher.js').dispatch;
 await dispatch({from:'group@g.us',messageData:{key:{id:'MESSAGE'}}});assert.equal(routes,1);assert.equal(f.records[0].kind,'ignore');assert.equal(f.records[0].respond,false);
 ai.routeWithAIOutcome=async()=>({ok:true,decision:{action:'ayuda',addressed_to_bot:true,args:{detail:true}}});
 // A fresh dispatcher performs the actual tracked operation once.
 f.modules['other/src/core/dispatcher.js']={dispatch:async()=>{await tracker.track('ayuda','group@g.us',()=>{operations++;return'original';});}};
 const other=f.Module._load('other/src/core/dispatcher.js').dispatch;await other({from:'group@g.us',messageData:{key:{id:'SECOND'}}});assert.equal(operations,1);assert.equal(f.records[1].feature,'help');assert.equal(f.records[1].kind,'command');hooks.stop();
});
test('Acknowledged send and unobserved completion have explicit known/unknown semantics',async()=>{
 const f=setup();let sent=0;f.modules['src/services/evolution.js']={sendText:async()=>{sent++;return'ack';}};
 f.modules['src/core/dispatcher.js']={dispatch:async ctx=>{if(ctx.text==='send')return f.modules['src/services/evolution.js'].sendText('chat','text');return'ignored';}};
 const hooks=installHooks(f);f.Module._load('src/services/evolution.js');const dispatch=f.Module._load('src/core/dispatcher.js').dispatch;
 assert.equal(await dispatch({from:'chat',text:'send',messageData:{key:{id:'1'}}}),'ack');assert.equal(sent,1);assert.equal(f.records[0].kind,'reply');await dispatch({from:'chat',text:'silent',messageData:{key:{id:'2'}}});assert.equal(f.records[1].kind,'unknown','No send is never inferred as ignore');hooks.stop();
});
test('Legacy preload mode does not initialize shadow or patch modules',()=>{
 const file=path.resolve(__dirname,'../../../scripts/refactor/phase3-shadow-preload.cjs');let installs=0;
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{__dirname:path.dirname(file),require(name){if(name==='node:path')return path;if(name.endsWith('/node_modules/dotenv'))return{config:()=>{}};if(name.endsWith('/src/v2/config'))return{readConfigFromProcessEnv:()=>({PIPELINE_MODE:'legacy'})};installs++;throw Error('Unexpected shadow import');},console,process:{once(){throw Error('No process hooks in legacy mode');}}},{filename:file});assert.equal(installs,0);
});

test('Observer exceptions cannot cancel the original dispatcher or command',async()=>{
 const f=setup();f.runtime.recordV1Decision=()=>{throw Error('sidecar failure');};let commands=0;f.modules['src/services/commandUsageRuntime.js']={track:(_name,_from,operation)=>operation()};f.modules['src/core/dispatcher.js']={dispatch:async()=>f.modules['src/services/commandUsageRuntime.js'].track('ayuda','chat',()=>{commands++;return'completed';})};
 const hooks=installHooks(f);f.Module._load('src/services/commandUsageRuntime.js');const dispatcher=f.Module._load('src/core/dispatcher.js');assert.equal(await dispatcher.dispatch({from:'chat',messageData:{key:{id:'x'}}}),'completed');assert.equal(commands,1);hooks.stop();
});
