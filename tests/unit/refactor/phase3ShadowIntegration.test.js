'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {createShadowBridge}=require('../../../src/v2/shadowBridge');
const {FakeClock}=require('../../../src/v2/platform/clock');
function raw(id='m',text='Botsky hola',options={}) {return {event:'messages.upsert',data:{key:{id,remoteJid:'19995559999@g.us',participant:'100@s.whatsapp.net',...options.key},message:options.message||{conversation:text},pushName:'Transient private name',...options.data}};}
function v1(id='m',options={}) {return {chatId:'19995559999@g.us',messageId:id,kind:'chat',respond:true,reason:'bot-mentioned',...options};}
function setup(options={}) {const clock=new FakeClock(100);const rows=[];const bridge=createShadowBridge({clock,sink:row=>rows.push(row),config:{PIPELINE_MODE:'shadow'},botJid:'19995550000@s.whatsapp.net',...options});return{clock,rows,bridge};}
function loadRuntime(requireOverride) {const file=path.resolve(__dirname,'../../../src/services/phase3ShadowRuntime.js');const context={module:{exports:{}},require:requireOverride};vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:file});return context.module.exports;}
test('imports and OFF factories/runtime perform no config, provider, SQLite or filesystem IO',async()=>{
    const source=fs.readFileSync(path.resolve(__dirname,'../../../src/v2/shadowBridge.js'),'utf8');const module={exports:{}};
    vm.runInNewContext(source,{module,require:()=>{throw Error('OFF dependency load');}});
    const bridge=module.exports.createShadowBridge({config:{PIPELINE_MODE:'legacy'}});assert.equal(bridge.observeWebhook(raw()),false);assert.equal(bridge.recordV1Decision(v1()),false);bridge.stop();await bridge.flush();
    let reads=0;const runtime=loadRuntime(name=>{if(name==='../v2/config')return{readConfigFromProcessEnv:()=>{reads++;return{PIPELINE_MODE:'legacy'};}};throw Error(`forbidden ${name}`);});
    assert.equal(reads,0);assert.equal(runtime.observeWebhook(raw()),false);assert.equal(runtime.recordV1Decision(v1()),false);
    assert.equal(runtime.initialize().enabled,false);assert.equal(reads,1);runtime.stop();await runtime.flush();assert.equal(runtime.status().enabled,false);
});
test('actual chat decision comparison persists closed identifiers and no text, IDs or arguments',async()=>{
    const {bridge,rows}=setup();assert.equal(bridge.observeWebhook(raw('m','Botsky private-contact +521999')),true);assert.equal(bridge.recordV1Decision(v1('m',{via:'llm',reason:'wake-word',plan:{kind:'chat',args:{private:'DO NOT PERSIST'}}})),true);
    await bridge.flush();assert.equal(rows.length,1);assert.equal(rows[0].category,'same');assert.equal(rows[0].v2_decision.kind,'chat');
    const output=JSON.stringify(rows);for(const value of ['521999','private-contact','Transient private name','DO NOT PERSIST','messageId','chatId'])assert.equal(output.includes(value),false,value);
    bridge.stop();
});
test('recorded enabled intent replays only proposal and never executes handlers or gets business status',async()=>{
    let executions=0;const features=[{id:'help',commands:[{name:'ayuda',scope:['group','private'],access:'public',tier:'none',handler:async()=>{executions++;throw Error('business IO');},help:{short:'help',examples:[]}}],intents:[{id:'help.show',description:'help',command:'ayuda',schema:{}}]}];
    const {bridge,rows}=setup({features});assert.equal(bridge.observeWebhook(raw()),true);assert.equal(bridge.recordV1Decision(v1('m',{kind:'intent',feature:'help',plan:{kind:'intent',intent:'help.show',args:{}}})),true);
    await bridge.flush();assert.equal(executions,0);assert.equal(rows[0].v2_decision.feature,'help');assert.equal(rows[0].v2_decision.kind,'intent');bridge.stop();
});
test('absent/unmappable plans are explicitly unknown instead of inferred chat or ignore',async()=>{
    const {bridge,rows}=setup();for(const [id,decision]of [['1',{kind:'command',feature:'unported'}],['2',{kind:'intent',plan:{kind:'intent',intent:'not-enabled',args:{}}}]]){
        bridge.observeWebhook(raw(id));bridge.recordV1Decision(v1(id,decision));await bridge.flush();assert.equal(rows.at(-1).category,'unknown');assert.equal(rows.at(-1).v2_decision.reason,'recorded-plan-unavailable');
    }bridge.stop();
});
test('TTL expires missing v1 evidence, queue is bounded, late/coalesced decisions stay unknown',async()=>{
    const {bridge,rows,clock}=setup({maxPending:1});assert.equal(bridge.observeWebhook(null),false);assert.equal(bridge.observeWebhook(raw('1')),true);assert.equal(bridge.observeWebhook(raw('1')),false);assert.equal(bridge.observeWebhook(raw('2')),false);
    await clock.advance(9999);assert.equal(rows.length,0);await clock.advance(1);await bridge.flush();assert.equal(rows.length,1);assert.equal(rows[0].category,'unknown');assert.equal(bridge.status().v1TimedOut,1);assert.equal(bridge.status().bridgeDropped,2);
    assert.equal(bridge.recordV1Decision(v1('1')),false);assert.equal(bridge.recordV1Decision(null),false);assert.equal(bridge.status().awaitingV1,0);bridge.stop();assert.equal(clock.pendingTimers,0);assert.equal(bridge.observeWebhook(raw('3')),false);
});
test('own webhook seeds exact chat IDs so quote authenticates without sender text heuristics',async()=>{
    const {bridge,rows}=setup();assert.equal(bridge.observeWebhook(raw('sent','answer',{key:{fromMe:true}})),true);assert.equal(bridge.status().echoSeeds,1);assert.equal(bridge.status().awaitingV1,0);
    const quote=raw('q','2',{message:{extendedTextMessage:{text:'2',contextInfo:{stanzaId:'sent',participant:'9900000000001@lid',quotedMessage:{conversation:'answer'}}}}});
    bridge.observeWebhook(quote);bridge.recordV1Decision(v1('q',{reason:'bot-quoted'}));await bridge.flush();assert.equal(rows[0].v2_decision.respond,true);assert.equal(rows[0].v2_decision.reason,'bot-quoted');bridge.stop();
});
test('default features explicit and private attachment paths remain effect-free',async()=>{
    const {bridge,rows}=setup();bridge.observeWebhook(raw('help','/help'));bridge.recordV1Decision(v1('help',{kind:'command',feature:'help',via:'explicit',reason:'explicit-command'}));await bridge.flush();assert.equal(rows[0].v2_decision.feature,'help');
    bridge.observeWebhook(raw('image','',{key:{remoteJid:'100@s.whatsapp.net'},message:{imageMessage:{url:'private-reference',mimetype:'image/jpeg'}}}));bridge.recordV1Decision({...v1('image'),chatId:'100@s.whatsapp.net'});await bridge.flush();assert.equal(rows[1].v2_decision.reason,'attachment-suggestion');assert.equal(JSON.stringify(rows).includes('private-reference'),false);bridge.stop();
});
test('decision plans are snapshotted and clipped input comparison is unknown',async()=>{
    const {bridge,rows}=setup();const decision=v1('1',{plan:{kind:'chat'}});bridge.observeWebhook(raw('1'));bridge.recordV1Decision(decision);decision.plan.kind='intent';await bridge.flush();assert.equal(rows[0].v2_decision.kind,'chat');
    bridge.observeWebhook(raw('2','Botsky '+ 'x'.repeat(17000)));bridge.recordV1Decision(v1('2'));await bridge.flush();assert.equal(rows[1].category,'unknown');assert.equal(rows[1].v2_decision.reason,'shadow-input-clipped');assert.equal(bridge.status().clipped,1);bridge.stop();
});
test('stop resolves pending evidence and observer/sink failures are counted without business effects',async()=>{
    const {bridge,clock}=setup({sink:()=>{throw Error('sidecar failure');}});bridge.observeWebhook(raw());bridge.recordV1Decision(v1());await bridge.flush();assert.equal(bridge.status().exceptions,1);
    bridge.observeWebhook(raw('pending'));bridge.stop();await bridge.flush();assert.equal(bridge.status().awaitingV1,0);assert.equal(clock.pendingTimers,0);
    for(const options of [{maxPending:0},{decisionTimeoutMs:0}])assert.throws(()=>setup(options),/bounds/);
});
function fakeFs() {const files=new Map();const calls=[];return{files,calls,mkdirSync:(...args)=>calls.push(['mkdir',...args]),openSync:(file,flag,mode)=>{assert.equal(flag,'wx');assert.equal(mode,0o600);if(files.has(file))throw Error('EEXIST');files.set(file,'');return 3;},closeSync:()=>{},writeFileSync:(file,data,options)=>{assert.equal(options.flag,'wx');if(files.has(file))throw Error('EEXIST');files.set(file,data);},promises:{appendFile:async(file,data)=>files.set(file,files.get(file)+data),writeFile:async(file,data)=>files.set(file,data),rename:async(from,to)=>{files.set(to,files.get(from));files.delete(from);}}};}
test('runtime enabled initialization is explicit and writes exclusive private sidecars/heartbeat only',async()=>{
    const clock=new FakeClock(500);const files=fakeFs();let loaded=0;const runtime=loadRuntime(name=>{if(name==='node:path')return path;if(name==='../v2/shadowBridge'){loaded++;return{createShadowBridge};}throw Error(`unexpected ${name}`);});
    assert.throws(()=>runtime.initialize({config:{PIPELINE_MODE:'shadow'}}),/filename/);
    runtime.initialize({config:{PIPELINE_MODE:'shadow'},filename:'/synthetic/run.jsonl',clock,fs:files,botJid:'19995550000@s.whatsapp.net'});assert.equal(loaded,1);assert.equal(runtime.status().operationalClock,false);assert.equal(runtime.initialize().enabled,true);
    runtime.observeWebhook(raw());runtime.recordV1Decision(v1());await runtime.flush();assert.ok(files.files.get('/synthetic/run.jsonl').includes('v2_decision'));assert.equal(JSON.parse(files.files.get('/synthetic/run.jsonl.checkpoint.json')).processed,1);
    await clock.advance(60000);assert.equal(JSON.parse(files.files.get('/synthetic/run.jsonl.checkpoint.json')).observedUntil,60500);runtime.stop();await runtime.flush();assert.equal(clock.pendingTimers,0);assert.equal(runtime.observeWebhook(raw('late')),false);assert.equal(runtime.recordV1Decision(v1('late')),false);
});
test('runtime wrappers contain bridge exceptions and sink failure increments separate diagnostics',async()=>{
    const clock=new FakeClock();const files=fakeFs();files.promises.appendFile=async()=>{throw Error('write failed');};const runtime=loadRuntime(name=>{if(name==='node:path')return path;throw Error(`unexpected ${name}`);});
    runtime.initialize({config:{PIPELINE_MODE:'shadow'},filename:'/synthetic/error.jsonl',clock,fs:files,factory:options=>{options.sink({category:'unknown'});return{observeWebhook:()=>{throw Error('observe');},recordV1Decision:()=>{throw Error('record');},status:()=>({enabled:true}),flush:async()=>{},stop:()=>{}};}});
    assert.equal(runtime.observeWebhook(raw()),false);assert.equal(runtime.recordV1Decision(v1()),false);await runtime.flush();assert.equal(runtime.status().sinkErrors,1);runtime.stop();assert.equal(clock.pendingTimers,0);
});
test('elapsed evidence freezes on stop and failed checkpoint initialization installs nothing',async()=>{
    const {bridge,clock}=setup();await clock.advance(10);bridge.stop();const elapsed=bridge.status().elapsedMs;await clock.advance(86400000);assert.equal(bridge.status().elapsedMs,elapsed);
    const files=fakeFs();files.writeFileSync=()=>{throw Error('checkpoint failure');};let stopped=0;
    const runtime=loadRuntime(name=>{if(name==='node:path')return path;throw Error(`unexpected ${name}`);});
    assert.throws(()=>runtime.initialize({config:{PIPELINE_MODE:'shadow'},filename:'/synthetic/fail.jsonl',clock:new FakeClock(),fs:files,factory:()=>({status:()=>({enabled:true}),stop:()=>{stopped++;}})}),/checkpoint failure/);
    assert.equal(stopped,1);assert.equal(runtime.status().enabled,false);assert.equal(runtime.observeWebhook(raw()),false);
});
