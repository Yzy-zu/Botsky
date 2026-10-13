'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createCoalescer}=require('../../../../src/v2/pipeline/coalescer');
const {FakeClock}=require('../../../../src/v2/platform/clock');
function event(id,options={}) {return {id,chatId:'g@g.us',sender:{jid:'100@s.whatsapp.net'},receivedAt:Number(id)||0,text:`text${id}`,kind:'text',mentions:[],...options};}
test('three messages within two seconds yield one chronological batch and one dispatch',async()=>{
    const clock=new FakeClock();const calls=[];const coalescer=createCoalescer({clock,dispatch:(e,ids)=>{calls.push({e,ids});return 'done';}});
    const first=coalescer.push(event('1'));await clock.advance(500);const second=coalescer.push(event('2',{mentions:['bot']}));
    await clock.advance(500);const third=coalescer.push(event('3',{mentions:['bot','other']}));assert.equal(first,second);assert.equal(second,third);
    await clock.advance(1199);assert.equal(calls.length,0);await clock.advance(1);
    assert.equal(await first,'done');assert.equal(calls.length,1);assert.deepEqual(calls[0].ids,['1','2','3']);assert.equal(calls[0].e.text,'text1\ntext2\ntext3');assert.deepEqual(calls[0].e.mentions,['bot','other']);assert.equal(calls[0].e.id,'3');assert.equal(clock.pendingTimers,0);
});
test('maximum wait prevents starvation and chat/sender streams remain isolated',async()=>{
    const clock=new FakeClock();const calls=[];const c=createCoalescer({clock,dispatch:(_e,ids)=>calls.push(ids)});
    const pending=[];for(let i=0;i<4;i++){pending.push(c.push(event(String(i))));await clock.advance(1000);}
    assert.deepEqual(calls,[['0','1','2','3']]);await Promise.all(pending);
    const a=c.push(event('a'));const b=c.push(event('b',{sender:{jid:'other'}}));const d=c.push(event('d',{chatId:'other@g.us'}));assert.equal(c.pendingCount,3);
    await c.drain();await Promise.all([a,b,d]);assert.equal(calls.length,4);assert.equal(clock.pendingTimers,0);
});
test('distinct uploads retain identity and media survives following text',async()=>{
    const clock=new FakeClock();const calls=[];const c=createCoalescer({clock,dispatch:(e,ids)=>calls.push({e,ids})});
    const a=c.push(event('1',{kind:'image',text:'',media:{ref:'first',mime:'image/jpeg'},quoted:{messageId:'q'}}));
    const b=c.push(event('2',{kind:'image',text:'',media:{ref:'second',mime:'image/jpeg'}}));
    const d=c.push(event('3',{text:'convert'}));await c.drain();await Promise.all([a,b,d]);
    assert.equal(calls.length,2);assert.deepEqual(calls[0].ids,['1']);assert.deepEqual(calls[1].ids,['2','3']);assert.equal(calls[1].e.media.ref,'second');assert.equal(calls[0].e.quoted.messageId,'q');
});
test('explicit commands, polls, reactions and zero window are immediate',async()=>{
    for(const options of [{text:'/help'},{kind:'poll'},{kind:'reaction'}]){
        const clock=new FakeClock();let calls=0;const c=createCoalescer({clock,dispatch:()=>++calls});
        assert.equal(await c.push(event('1',options)),1);assert.equal(clock.pendingTimers,0);
    }
    const clock=new FakeClock();const c=createCoalescer({clock,windowMs:0,dispatch:()=>4});assert.equal(await c.push(event('1')),4);
});
test('dispatches serialize per sender even when a preceding dispatch fails',async()=>{
    const clock=new FakeClock();let release;const blocker=new Promise(resolve=>{release=resolve;});const calls=[];
    const c=createCoalescer({clock,windowMs:0,dispatch:async(e)=>{calls.push(e.id);if(e.id==='1'){await blocker;throw Error('first failed');}return 'ok';}});
    const first=c.push(event('1'));const rejected=assert.rejects(first,/first failed/);const next=c.push(event('2'));await clock.flush();assert.deepEqual(calls,['1']);release();await rejected;assert.equal(await next,'ok');assert.deepEqual(calls,['1','2']);
});
test('timer-triggered errors are reported to caller and drain, never silently successful',async()=>{
    const clock=new FakeClock();const c=createCoalescer({clock,dispatch:()=>{throw Error('dispatch failed');}});
    const promise=c.push(event('1'));const failure=assert.rejects(promise,/dispatch failed/);await clock.advance(1200);await failure;
    const second=c.push(event('2'));const failure2=assert.rejects(second,/dispatch failed/);await assert.rejects(c.drain(),/dispatch failed/);await failure2;
});
test('dispose cancels timers and rejects queued promises, capacity is explicit',async()=>{
    const clock=new FakeClock();const c=createCoalescer({clock,maxPending:1,dispatch:()=>{throw Error('must not dispatch');}});
    const first=c.push(event('1'));await assert.rejects(c.push(event('2',{sender:{jid:'other'}})),/capacity/);
    const failure=assert.rejects(first,/disposed/);c.dispose();await failure;assert.equal(clock.pendingTimers,0);assert.equal(c.pendingCount,0);await assert.rejects(c.push(event('3')),/disposed/);await c.drain();
    for(const options of [{windowMs:-1},{maxWaitMs:1},{maxPending:0}])assert.throws(()=>createCoalescer({clock,dispatch:()=>{},...options}),/bounds/);
});
test('total queued/in-flight events are bounded independently of sender cardinality',async()=>{
    const clock=new FakeClock();let release;const blocker=new Promise(resolve=>{release=resolve;});
    const c=createCoalescer({clock,windowMs:0,maxBufferedEvents:2,dispatch:()=>blocker});
    const first=c.push(event('1'));const second=c.push(event('2'));
    await assert.rejects(c.push(event('3')),/event capacity/);release('done');assert.deepEqual(await Promise.all([first,second]),['done','done']);
    assert.equal(await c.push(event('4')),'done');
    assert.throws(()=>createCoalescer({clock,maxBufferedEvents:0,dispatch:()=>{}}),/bounds/);
});
