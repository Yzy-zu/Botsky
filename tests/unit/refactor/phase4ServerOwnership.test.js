'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function harness(owned){
    const routes=new Map(),calls=[],signals=new Map();
    const logger={info(){},error(){},success(){},warn(){}};
    const service={status:{enabled:true},initialize:async()=>{},tryHandle:async()=>{calls.push('v2');return owned;},dispose:async()=>{calls.push('dispose');}};
    const app={use(){},get(){},post:(name,fn)=>routes.set(name,fn),listen:()=>({close(){calls.push('close');}})};
    const express=()=>app;express.json=express.urlencoded=()=>()=>{};
    const mocks={express,fs:{mkdirSync(){}},path,dotenv:{config(){}},
        '../services/phase4CanaryRuntime':{createPhase4Service:()=>service},
        '../services/logger':logger,'../core/dispatcher':{dispatch(){calls.push('dispatch');}},
        '../services/history':{addMessage(){calls.push('history');}},
        '../services/evolution':{consumeOutboundEcho:()=>false},
        '../utils/whatsappText':{extractNativeTableText:()=>''},
        '../services/cleanup':{startCleanupCron(){}},'../services/proactive':{initProactiveHeartbeat(){}},
        '../services/scheduler':{registerTask(){},runAllMaintenance:async()=>{}},
        '../services/db':{addXp:async()=>{calls.push('xp');}},
        '../services/happyHour':{initHappyHourRecovery:async()=>{},onIncomingGroupMessage:async()=>{calls.push('happy');},isAirdropActive:()=>false,isHappyHourActive:()=>false},
        '../services/school':{},'../core/queue':{stats:{}},'../commands/drive':{handleDrive(){}},
        './coalescer':{coalesceAndDispatch:(_,fn)=>fn({})},
        './message_normalizer':{normalizeIncomingMessage:()=>{calls.push('normalize');return{isGroup:true,shouldDispatch:true,actualMessageType:'text',text:'synthetic'};},getCachedMediaById(){},extractText:()=>''}};
    const filename=path.resolve(__dirname,'../../../src/core/server.js');
    vm.runInNewContext(fs.readFileSync(filename,'utf8'),{__dirname:path.dirname(filename),require:name=>{assert.ok(Object.hasOwn(mocks,name),name);return mocks[name];},process:{env:{},on:(name,fn)=>signals.set(name,fn),exit:code=>calls.push(`exit:${code}`),memoryUsage:()=>({}),uptime:()=>0},Buffer,console},{filename});
    return{calls,signals,webhook:routes.get('/webhook')};
}
test('selected canary event stops before normalization, history, XP and legacy dispatch',async()=>{
    const h=harness(true);
    await h.webhook({body:{event:'messages.upsert',data:{key:{id:'a',remoteJid:'19995550101@s.whatsapp.net'},message:{conversation:'Botsky QR'}}}},{sendStatus:code=>assert.equal(code,200)});
    assert.deepEqual(h.calls,['v2']);
});
test('unselected event retains legacy owner and shutdown drains only the new graph',async()=>{
    const h=harness(false);
    await h.webhook({body:{event:'messages.upsert',data:{key:{id:'a',remoteJid:'120000001@g.us'},message:{conversation:'synthetic'}}}},{sendStatus(){}});
    assert.deepEqual(h.calls,['v2','normalize','happy','xp','dispatch']);
    await Promise.resolve();await h.signals.get('SIGINT')();
    assert.deepEqual(h.calls.slice(-3),['close','dispose','exit:0']);
});
