'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPhase4Service}=require('../../src/services/phase4CanaryRuntime');
const {createApplication}=require('../../src/v2/main');
const {createQrFeature}=require('../../src/v2/features/qr/manifest');
const {FakeClock}=require('../../src/v2/platform/clock');

const CHAT='19995550101@s.whatsapp.net';
const OTHER='19995550102@s.whatsapp.net';
const GROUP='120363000000000001@g.us';
const BOT='19995550000@s.whatsapp.net';
function envelope(id,text,chat=CHAT,fromMe=false) {
    return {key:{id,remoteJid:chat,fromMe},message:{conversation:text}};
}

async function flushCanary(clock,promise) {
    // Non-prefixed private text uses the normal coalescing window.
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    await clock.advance(1200);
    return promise;
}

test('private canary carries unprefixed QR text literally to the current chat and leaves all other owners alone',async()=>{
    const clock=new FakeClock(10_000);
    const encoded=[];const sent=[];const legacy=[];let llmCalls=0,pipelineCalls=0,application;
    const qr=createQrFeature({create:async text=>{encoded.push(text);return{ref:`synthetic://qr/${encoded.length}`};},read:async()=>null});
    const messenger={
        sendText:async(to,text)=>{sent.push({kind:'text',to,text});return{messageId:`text-${sent.length}`};},
        sendMedia:async(to,ref,caption,forceDocument)=>{sent.push({kind:'media',to,ref,caption,forceDocument});return{messageId:`media-${sent.length}`};},
        sendVoice:async()=>assert.fail('QR must not send voice'),sendSticker:async()=>assert.fail('QR must not send sticker'),
        react:async()=>assert.fail('QR must not react'),typing:async()=>{},delete:async()=>{},edit:async()=>{},groupInfo:async()=>{}
    };
    const llm={generate:async()=>{llmCalls++;return{ok:false,failure:{kind:'unknown',retryable:false}};}};
    const service=createPhase4Service({root:'/synthetic/canary-qr',clock,buildGraph:async()=>{
        application=createApplication({clock,botJid:BOT,messenger,llm,
            conversation:{recent:async()=>[],append:async()=>{},clear:async()=>{}},
            getStatus:()=>({version:'synthetic'}),extraFeatures:[qr]});
        const pipeline={handle:async raw=>{pipelineCalls++;return application.pipeline.handle(raw);}};
        return{app:{pipeline},dispose:()=>application.dispose()};
    }});

    try {
        await assert.rejects(service.initialize({PIPELINE_MODE:'canary',V2_CANARY_CHAT_IDS:[GROUP],V2_CANARY_FEATURES:['qr']}),/private chat IDs/);
        await service.initialize({PIPELINE_MODE:'canary',V2_CANARY_CHAT_IDS:[CHAT],V2_CANARY_FEATURES:['qr']});

        const first=service.tryHandle(envelope('qr-plain','qr hola'));
        assert.equal(await flushCanary(clock,first),true);
        await clock.advance(3000);
        const second=service.tryHandle(envelope('qr-literal','Botsky qr minecraft --to otro-chat'));
        assert.equal(await flushCanary(clock,second),true);

        assert.deepEqual(encoded,['hola','minecraft --to otro-chat']);
        assert.deepEqual(sent.map(item=>item.to),[CHAT,CHAT]);
        assert.ok(sent.every(item=>item.kind==='media'&&item.ref.startsWith('synthetic://qr/')));
        assert.equal(llmCalls,0,'literal QR commands must not use the LLM');
        assert.equal(pipelineCalls,2,'each selected QR event enters the V2 pipeline exactly once');

        const rejected=[envelope('other-private','qr fuera',OTHER),envelope('other-group','Botsky qr grupo',GROUP),envelope('own','qr propio',CHAT,true)];
        for(const raw of rejected) {
            const claimed=await service.tryHandle(raw);
            if(claimed)throw new Error('unexpected canary ownership');
            legacy.push(raw);
        }
        assert.equal(legacy.length,3,'unselected, group and fromMe events stay with the legacy webhook owner');
        assert.equal(pipelineCalls,2,'legacy-owned events never enter V2');
        assert.equal(llmCalls,0);
        assert.equal(sent.length,2,'legacy-owned events are not delivered by this V2 harness');
    } finally {
        await service.dispose();
        clock.dispose();
    }
});
