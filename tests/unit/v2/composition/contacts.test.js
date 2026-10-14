'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createContactDirectory,CONTACT_CACHE_TTL_MS,CONTACT_FETCH_TIMEOUT_MS,MAX_CONTACT_RESULTS,MAX_GROUP_PARTICIPANTS}=require('../../../../src/v2/composition/contacts');
const {FakeClock}=require('../../../../src/v2/platform/clock');

const group='120363315296139888@g.us';
function directory({repoRows=[],participants=[],fetchGroup,clock=new FakeClock(1000)}={}){
 let repoCalls=0,fetchCalls=0,lastSignal;
 const value=createContactDirectory({repo:{resolve:async()=>{repoCalls++;return repoRows;}},mainGroupJid:group,clock,
  fetchGroup:async(jid,signal)=>{fetchCalls++;lastSignal=signal;assert.equal(jid,group);return fetchGroup?fetchGroup(jid,signal):{data:{participants}};}});
 return {value,clock,get repoCalls(){return repoCalls;},get fetchCalls(){return fetchCalls;},get lastSignal(){return lastSignal;}};
}

test('assembly is inert and exact sidecar hits take precedence over group roster lookup',async()=>{
 const f=directory({repoRows:[{jid:'15551234567@s.whatsapp.net',name:'Juan'}],participants:[{id:'15559999999@s.whatsapp.net',name:'Juan'}]});
 assert.equal(f.fetchCalls,0);
 assert.deepEqual(await f.value.resolve('Juan'),[{jid:'15551234567@s.whatsapp.net',name:'Juan',isGroup:false}]);
 assert.equal(f.repoCalls,1);assert.equal(f.fetchCalls,0);
});

test('group roster uses accent/case-insensitive names, exact match first, and returns every partial match',async()=>{
 const f=directory({participants:[
  {id:'15550000001@s.whatsapp.net',name:'Ána María'},
  {id:'15550000002@s.whatsapp.net',pushName:'ANA'},
  {id:'15550000003@s.whatsapp.net',notify:'Anabel'},
  {id:'15550000004@s.whatsapp.net',name:'Mariana'}
 ]});
 assert.deepEqual(await f.value.resolve('ana'),[{jid:'15550000002@s.whatsapp.net',name:'ANA',isGroup:false}], 'exact normalized name wins over partial matches');
 const partial=await f.value.resolve('an');
 assert.equal(partial.length,4);assert.deepEqual(partial.map(row=>row.jid),[
  '15550000001@s.whatsapp.net','15550000002@s.whatsapp.net','15550000003@s.whatsapp.net','15550000004@s.whatsapp.net']);
 assert.equal(f.fetchCalls,1,'roster data is reused within its TTL');
});

test('LID identities are accepted only with an explicit valid phoneNumber mapping; raw id digits are never guessed',async()=>{
 const f=directory({participants:[
  {id:'99999@lid',name:'LID only'},
  {id:'99998@lid',phoneNumber:'15550000001@s.whatsapp.net',name:'Mapped LID'},
  {id:'15550000002',name:'Raw numeric id'},
  {id:'15550000003@s.whatsapp.net',name:'PN id'},
  {id:'99997@lid',phoneNumber:'15550000004',name:'Explicit raw PN'},
  {id:'15550000005@s.whatsapp.net',phoneNumber:'99996@lid',name:'PN id with invalid phone'}
 ]});
 const matches=await f.value.resolve('');
 assert.deepEqual(matches,[],'empty query never triggers a fetch');
 const mapped=await f.value.resolve('Mapped');
 assert.deepEqual(mapped,[{jid:'15550000001@s.whatsapp.net',name:'Mapped LID',isGroup:false}]);
 const direct=await f.value.resolve('PN');
 assert.deepEqual(direct.map(row=>row.jid),['15550000003@s.whatsapp.net','15550000004@s.whatsapp.net','15550000005@s.whatsapp.net']);
 const rawPhone=await f.value.resolve('Explicit raw');
 assert.deepEqual(rawPhone,[{jid:'15550000004@s.whatsapp.net',name:'Explicit raw PN',isGroup:false}]);
});

test('participant and result counts are capped without choosing the first partial result',async()=>{
 const participants=Array.from({length:MAX_GROUP_PARTICIPANTS+1},(_,i)=>({id:`1555${String(i).padStart(7,'0')}@s.whatsapp.net`,name:i===0||i===MAX_GROUP_PARTICIPANTS?'Jordan':`Other ${i}`}));
 const f=directory({participants});
 assert.deepEqual(await f.value.resolve('Jordan'),[],'an oversized roster is rejected so a duplicate beyond the cap cannot be hidden');
 const many=directory({participants:Array.from({length:12},(_,i)=>({id:`1556${String(i).padStart(7,'0')}@s.whatsapp.net`,name:`Alex ${i}`}))});
 const result=await many.value.resolve('Alex');
 assert.equal(result.length,MAX_CONTACT_RESULTS);assert.ok(result.length>1,'caller receives ambiguity rather than a first-match choice');
});

test('roster cache expires after five minutes and refreshes on the next lookup',async()=>{
 const clock=new FakeClock(2000);let fetches=0;
 const cached=createContactDirectory({repo:{resolve:async()=>[]},mainGroupJid:group,clock,
  fetchGroup:async()=>{fetches++;return{participants:[{id:'15551234567@s.whatsapp.net',name:'Alicia'}]};}});
 await cached.resolve('Alicia');await cached.resolve('Alicia');assert.equal(fetches,1);
 await clock.advance(CONTACT_CACHE_TTL_MS+1);await cached.resolve('Alicia');assert.equal(fetches,2);
 assert.equal(CONTACT_FETCH_TIMEOUT_MS,15000);
});

test('group lookup times out with no provider error/body leakage and aborts its fetch signal',async()=>{
 const clock=new FakeClock(0);let fetchSignal;const f=directory({clock,fetchGroup:(_jid,signal)=>{fetchSignal=signal;return new Promise(()=>{});}});
 const pending=f.value.resolve('Alicia');await Promise.resolve();await clock.advance(CONTACT_FETCH_TIMEOUT_MS);
 assert.deepEqual(await pending,[]);assert.equal(fetchSignal.aborted,true);assert.equal(clock.pendingTimers,0);
});

test('caller cancellation aborts lookup and propagates only a cancellation error',async()=>{
 const clock=new FakeClock(0);let fetchSignal;const f=directory({clock,fetchGroup:(_jid,signal)=>{fetchSignal=signal;return new Promise(()=>{});}});
 const controller=new AbortController();const pending=f.value.resolve('Alicia',controller.signal);await Promise.resolve();controller.abort(Error('private provider body'));
 await assert.rejects(pending,{name:'AbortError'});assert.equal(fetchSignal.aborted,true);assert.equal(clock.pendingTimers,0);
});
