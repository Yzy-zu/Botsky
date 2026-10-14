'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createCanaryOwner}=require('../../../../src/v2/composition/canary');
const {FakeClock}=require('../../../../src/v2/platform/clock');

function message(chat='525512345678@s.whatsapp.net',id='event',fromMe=false){return{key:{id,remoteJid:chat,fromMe},message:{conversation:'hello'}};}
function owner(options={}){
 const calls=[];const clock=new FakeClock(400);
 const value=createCanaryOwner({mode:'canary',canaryChatIds:['+525512345678'],clock,
  pipeline:async raw=>{calls.push(['pipeline',raw]);return'v2';},
  legacy:async raw=>{calls.push(['legacy',raw]);return'v1';},
  isEligibleWaveA:raw=>Boolean(raw?.eligible),...options});
 return{value,calls,clock};
}

test('canary selects only explicit normalized chats and eligible non-outbound Wave A events',async()=>{
 const {value,calls}=owner();
 for(const alias of ['525512345678@s.whatsapp.net','525512345678@c.us','525512345678:4@s.whatsapp.net','+525512345678']){
  const raw=message(alias);raw.eligible=true;
  assert.equal(value.shouldHandle(raw).owner,'pipeline',alias);
  assert.equal((await value.dispatch(raw)).owner,'pipeline');
 }
 const passive=message();assert.equal((await value.dispatch(passive)).owner,'legacy');
 const privateOther=message('525500000000@s.whatsapp.net');privateOther.eligible=true;assert.equal((await value.dispatch(privateOther)).owner,'legacy');
 const group=message('120363000000000001@g.us');group.eligible=true;assert.equal((await value.dispatch(group)).owner,'legacy');
 const outbound=message('525512345678@c.us','outbound',true);outbound.eligible=true;assert.equal((await value.dispatch(outbound)).owner,'legacy');
 assert.equal(calls.filter(([owner])=>owner==='pipeline').length,4);
 assert.equal(calls.filter(([owner])=>owner==='legacy').length,4);
});

test('legacy and v2 modes have one owner and shadow or empty canary configuration is rejected',async()=>{
 const legacy=owner({mode:'legacy',canaryChatIds:[]});
 const sample=message();sample.eligible=true;
 assert.equal((await legacy.value.dispatch(sample)).owner,'legacy');assert.equal(legacy.calls.length,1);
 const v2=owner({mode:'v2',canaryChatIds:[]});
 assert.equal((await v2.value.dispatch(sample)).owner,'pipeline');assert.equal(v2.calls[0][0],'pipeline');
 assert.throws(()=>owner({mode:'shadow'}),/Unsupported/);
 assert.throws(()=>owner({canaryChatIds:[]}),/requires explicit/);
 assert.throws(()=>owner({canaryChatIds:['not a jid']}),/Invalid canary/);
});

test('private LID maps to an explicit alternate PN; group participant aliases never select',async()=>{
 const {value,calls}=owner();
 const mapped=message('999999999@lid');mapped.key.remoteJidAlt='525512345678:4@c.us';mapped.eligible=true;
 assert.equal(value.shouldHandle(mapped).owner,'pipeline');
 const guessed=message('999999999@lid');guessed.eligible=true;
 assert.equal(value.shouldHandle(guessed).owner,'legacy');
 const group=message('120363000000000001@g.us');group.key.remoteJidAlt='525512345678@c.us';group.key.participantAlt='525512345678:4@c.us';group.eligible=true;
 assert.equal(value.shouldHandle(group).owner,'legacy');
 assert.equal(calls.length,0);
});

test('invalid events route once to legacy; callback failure never falls back',async()=>{
 const {value,calls}=owner({pipeline:async()=>{calls.push(['pipeline']);throw Error('pipeline failed');}});
 const invalid={key:{id:'bad',remoteJid:'bad@unknown'},message:{conversation:'hello'}};
 assert.equal((await value.dispatch(invalid)).owner,'legacy');
 const selected=message();selected.eligible=true;
 await assert.rejects(value.dispatch(selected),/pipeline failed/);
 assert.deepEqual(calls.map(([name])=>name),['legacy','pipeline']);
});

test('close stops new dispatches and drains callbacks accepted before close',async()=>{
 let finish;const work=new Promise(resolve=>{finish=resolve;});let runs=0;
 const {value}=owner({pipeline:async()=>{runs++;await work;return'done';}});
 const selected=message();selected.eligible=true;
 const dispatch=value.dispatch(selected);
 await Promise.resolve();await Promise.resolve();
 const drain=value.close();
 assert.equal(value.readiness.ready,false);
 assert.equal((await value.dispatch(selected)).owner,'closed');assert.equal(runs,1);
 let settled=false;drain.then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);
 finish();assert.equal((await dispatch).result,'done');await drain;assert.equal(settled,true);
});
