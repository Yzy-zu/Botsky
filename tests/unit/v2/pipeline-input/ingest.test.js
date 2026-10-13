'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createIngest } = require('../../../../src/v2/pipeline/ingest');
const { FakeClock } = require('../../../../src/v2/platform/clock');
const { TtlStore } = require('../../../../src/v2/platform/ttlStore');
function raw(id='1',chat='100@s.whatsapp.net',fromMe=false) { return {key:{id,remoteJid:chat,fromMe},message:{conversation:'a'}}; }
test('ingest deduplicates per chat/id for precisely ten minutes', async () => {
    const clock = new FakeClock(); const store = new TtlStore({clock}); const ingest = createIngest({clock,store});
    assert.equal(ingest.accept(null).reason,'invalid-event'); assert.equal(ingest.accept(raw()).accepted,true);
    assert.equal(ingest.accept(raw()).reason,'duplicate'); assert.equal(ingest.accept(raw('1','200@s.whatsapp.net')).accepted,true);
    await clock.advance(599999); assert.equal(ingest.accept(raw()).accepted,false);
    await clock.advance(1); assert.equal(ingest.accept(raw()).accepted,true); assert.equal(clock.pendingTimers,0);
});
test('echoes are rejected before passive listeners and still deduplicated', () => {
    const clock = new FakeClock(); const store = new TtlStore({clock}); let calls=0;
    const ingest=createIngest({clock,store,isSentId:(_chat,id)=>id==='echo',echoGuard:{consume: event => {calls++; return event.messageId==='echo';}}});
    assert.equal(ingest.accept(raw('own','100@s.whatsapp.net',true)).reason,'outbound-echo'); assert.equal(calls,1);
    assert.equal(ingest.accept(raw('echo')).reason,'outbound-echo'); assert.equal(calls,2);
    assert.equal(ingest.accept(raw('echo')).reason,'duplicate'); assert.equal(calls,2);
    assert.equal(ingest.accept(raw('real')).accepted,true); assert.equal(calls,2);
});
test('capacity failure never accepts an unprotected event', () => {
    const clock=new FakeClock(); const store=new TtlStore({clock,maxEntries:1}); const ingest=createIngest({clock,store});
    ingest.accept(raw()); assert.throws(()=>ingest.accept(raw('2')),/capacity/);
});
test('human text equal to a pending outgoing message cannot be consumed as an echo',()=>{
    const clock=new FakeClock();const store=new TtlStore({clock});let consumes=0;
    const ingest=createIngest({clock,store,botJid:'900@s.whatsapp.net',echoGuard:{consume:()=>{consumes++;return true;}}});
    assert.equal(ingest.accept(raw('human')).accepted,true);assert.equal(consumes,0);
    assert.equal(ingest.accept(raw('bot','900:2@c.us')).reason,'outbound-echo');assert.equal(consumes,1);
});
