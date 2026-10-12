'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {FakeClock}=require('../../src/v2/platform/clock');const {TtlStore}=require('../../src/v2/platform/ttlStore');
const {EchoGuard}=require('../../src/v2/adapters/evolution/echoGuard');
function setup(options={}){const clock=new FakeClock();const store=new TtlStore({clock});const records=[];const guard=new EchoGuard({clock,store,record:(jid,text)=>records.push([jid,text]),...options});return{clock,store,records,guard};}
test('Pre-ACK echo correlates once, finish preserves actual IDs and history has one owner',()=>{
 const {guard,records}=setup();const entry=guard.begin('19995550101:2@s.whatsapp.net','same');
 assert.equal(guard.consume({chatId:'19995550102',messageId:'wrongchat',text:'same'}),false);
 assert.equal(guard.consume({chatId:'19995550101',messageId:'early',text:'different'}),false);
 assert.equal(guard.consume({chatId:'19995550101',messageId:'early',text:'same'}),true);
 assert.equal(guard.consume({chatId:'19995550101',messageId:'manual',text:'same'}),false);
 guard.finish(entry,{data:{key:{id:'ack'}}});guard.record(entry);guard.record(entry);
 assert.equal(guard.consume({chatId:'19995550101',messageId:'ack'}),true);
 assert.equal(guard.consume({chatId:'19995550101',messageId:'early'}),true);assert.equal(records.length,1);
 guard.dispose();assert.equal(guard.consume({chatId:'19995550101',messageId:'ack'}),false);
});
test('Echo delivery evidence survives HTTP failure; definitive rejection and TTL remove correlation',async()=>{
 const {guard,clock,records}=setup({ttlMs:10,maxEntries:2});
 const uncertain=guard.begin('19995550101','one');guard.consume({chatId:'19995550101',messageId:'early',text:'one'});
 guard.fail(uncertain,{response:{status:500}});assert.equal(records.length,1);
 const rejected=guard.begin('19995550101','two');guard.fail(rejected,{response:{status:403}});assert.equal(guard.entries.includes(rejected),false);
 await clock.advance(10);assert.equal(guard.consume({chatId:'19995550101',messageId:'early'}),false);
 guard.begin('u','a');guard.begin('u','b');guard.begin('u','c');assert.equal(guard.entries.length,2);
 assert.equal(guard.consume(),false);assert.equal(guard.consume({chatId:'u',messageId:'id'}),false);
 guard.dispose();assert.equal(guard.store.size,0);
});

test('A full shared TTL cache cannot convert accepted delivery into failure or duplicate history',()=>{
 const clock=new FakeClock();const store=new TtlStore({clock,maxEntries:1});store.set('business','session',1,100);
 const recorded=[];const guard=new EchoGuard({clock,store,record:(jid,text)=>recorded.push(text)});
 const entry=guard.begin('19995550101','ok');guard.finish(entry,{data:{key:{id:'realACK'}}});guard.record(entry);
 assert.equal(guard.consume({chatId:'19995550101',messageId:'realACK'}),true);assert.equal(recorded.length,1);
 assert.equal(store.get('business','session'),1);guard.dispose();assert.equal(store.get('business','session'),1);
});
