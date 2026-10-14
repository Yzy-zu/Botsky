'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createComposer } = require('../../../../src/v2/pipeline/composer');

function context() {
    return { event:{id:'event-1',chatId:'19995559999@g.us',isGroup:true}, history:[] };
}
function makeComposer(options = {}) {
    return createComposer({
        messenger:{sendMedia:options.sendMedia || (async()=>({messageId:'media-1'})),sendText:async()=>({}),sendVoice:async()=>({}),sendSticker:async()=>({}),react:async()=>({})},
        llm:{}, recentReplies:async()=>[], ...options
    });
}

test('voice metadata reaches delivery and history only after a provider acknowledgement',async()=>{
    for(const receipt of [{data:{key:{id:'voice-ack'}}},null]){
        const records=[],calls=[];
        const composer=makeComposer({messenger:{sendVoice:async(...args)=>{calls.push(args);return receipt;}},record:async(_ctx,text)=>records.push(text)});
        await composer.compose(context(),{parts:[{type:'audio',ref:'/synthetic/voice.mp3',mime:'audio/mpeg',transcript:'Buenos días',durationSeconds:3.2}]});
        assert.deepEqual(calls[0],['19995559999@g.us','/synthetic/voice.mp3',{transcript:'Buenos días',durationSeconds:3.2}]);
        assert.deepEqual(records,receipt?['[Nota de voz: Buenos días]']:[]);
    }
});

test('passes delivered media and reply context to rememberMedia before releasing its ref', async () => {
    const order = [], ctx = context();
    const part = {type:'image',ref:'/synthetic/image.png',mime:'image/png',caption:'photo'};
    const delivery = {messageId:'sent-image'};
    const composer = makeComposer({
        sendMedia:async()=>{order.push('send');return delivery;},
        rememberMedia:async(gotCtx,gotPart,gotDelivery)=>{order.push('remember');assert.equal(gotCtx,ctx);assert.equal(gotPart,part);assert.equal(gotDelivery,delivery);},
        releaseMedia:async ref=>{order.push('release');assert.equal(ref,part.ref);}
    });
    await composer.compose(ctx,{parts:[part]});
    assert.deepEqual(order,['send','remember','release']);
});

test('does not remember media after a failed send, while still releasing its owned ref', async () => {
    let remembers=0, releases=0;
    const composer=makeComposer({sendMedia:async()=>{throw Error('send failed');},rememberMedia:async()=>{remembers++;},releaseMedia:async()=>{releases++;}});
    await assert.rejects(composer.compose(context(),{parts:[{type:'image',ref:'/synthetic/image.png',mime:'image/png'}]}),/send failed/);
    assert.equal(remembers,0);
    assert.equal(releases,1);
});

test('a rememberMedia failure is best-effort and never resends already delivered media', async () => {
    let sends=0, remembers=0, releases=0;
    const composer=makeComposer({
        sendMedia:async()=>{sends++;return {messageId:'sent-once'};},
        rememberMedia:async()=>{remembers++;throw Error('cache unavailable');},
        releaseMedia:async()=>{releases++;}
    });
    const result=await composer.compose(context(),{parts:[{type:'image',ref:'/synthetic/image.png',mime:'image/png'}]});
    assert.equal(result.parts.length,1);
    assert.equal(sends,1);
    assert.equal(remembers,1);
    assert.equal(releases,1);
    assert.equal(composer.observationFailures,1);
});

test('text and reaction deliveries do not invoke media memory', async () => {
    let remembers=0;
    const composer=makeComposer({rememberMedia:async()=>{remembers++;}});
    await composer.compose(context(),{parts:[{type:'text',text:'hello'},{type:'reaction',emoji:'👍',messageId:'quoted'}]});
    assert.equal(remembers,0);
});
