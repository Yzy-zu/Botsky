'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalize}=require('../../../../src/v2/pipeline/normalize');
const {createContext,contextKey}=require('../../../../src/v2/pipeline/context');
const {FakeClock}=require('../../../../src/v2/platform/clock');
const {TtlStore}=require('../../../../src/v2/platform/ttlStore');
const CHAT='19995550101@s.whatsapp.net',BOT='19995550000@s.whatsapp.net';
function media(id,chat=CHAT,caption=''){
 return {key:{id,remoteJid:chat},message:{documentMessage:{caption,mimetype:'application/pdf',url:'https://media.invalid/file.pdf',
  mediaKey:'private-decryption-key',base64:'PRIVATE_FILE_BYTES',jpegThumbnail:'PRIVATE_THUMBNAIL',buffer:{data:[1,2,3]}}}};
}
function fixture(maxEntries=20){
 const clock=new FakeClock(1000000),store=new TtlStore({clock,maxEntries});
 const context=createContext({clock,store,conversation:{recent:async()=>{throw Error('normalization must not read history');}}});
 return{clock,store,context,normalize:input=>normalize(input,{clock,botJid:BOT})};
}
test('TR-0085: normalization preserves caption and context sessions without inventing an attachment intent',()=>{
 const f=fixture();const caption='No lo conviertas, explícame el 2';
 const event=f.normalize(media('document',CHAT,caption));
 assert.equal(event.text,caption);assert.equal(event.kind,'document');
 assert.equal(event.command,undefined);assert.equal(event.intent,undefined);
 const session={id:'pdf',ownerJid:CHAT,createdAt:f.clock.now(),expiresAt:f.clock.now()+10000};
 f.store.set('pipeline.session',contextKey(CHAT,CHAT),session,10000);
 assert.equal(f.context.observe(event),true);
 assert.deepEqual(f.context.addressingMetadata(event).session,session);
 const follow=f.normalize({key:{id:'follow',remoteJid:CHAT},message:{conversation:'haz los primeros tres'}});
 assert.equal(follow.text,'haz los primeros tres');assert.equal(follow.intent,undefined);
 assert.equal(f.context.addressingMetadata(follow).attachment.id,'document');
});
test('TR-0088: attachment cache retains no file bytes and respects the approved ten-minute TTL and hard capacity',async()=>{
 const f=fixture(4);const first=f.normalize(media('first'));
 assert.equal(f.context.observe(first),true);
 const cached=f.context.addressingMetadata(first).attachment;
 assert.ok(!JSON.stringify(cached).includes('PRIVATE_'));
 assert.ok(!JSON.stringify(cached).includes('private-decryption'));
 assert.equal(cached.providerKey.id,'first');
 const second=f.normalize(media('second','19995550102@s.whatsapp.net'));
 assert.equal(f.context.observe(second),true);assert.equal(f.store.size,4);
 const third=f.normalize(media('third','19995550103@s.whatsapp.net'));
 assert.equal(f.context.observe(third),false);assert.equal(f.store.size,4);
 assert.equal(f.context.addressingMetadata(third).attachment,undefined);
 await f.clock.advance(599999);assert.equal(f.context.addressingMetadata(first).attachment.id,'first');
 await f.clock.advance(1);assert.equal(f.context.addressingMetadata(first).attachment,undefined);
 assert.equal(f.context.addressingMetadata(second).attachment,undefined);assert.equal(f.store.size,0);
 assert.equal(f.clock.pendingTimers,0);
});
