'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {FakeClock}=require('../../../../src/v2/platform/clock');
const {addressingPolicy}=require('../../../../src/v2/policies/addressing.policy');
const bot='19995550100@s.whatsapp.net';const user='19995550101@s.whatsapp.net';
function event(text='',extra={}){return{id:'incoming',chatId:'120363000000000001@g.us',isGroup:true,sender:{jid:user,number:'19995550101',name:'Fake'},text,kind:'text',mentions:[],isFromMe:false,receivedAt:1000,raw:{},...extra}}
const options={botJid:bot};
test('Private, mentions, true bot quotes, prefixes and Unicode exact wake words',()=>{
 assert.equal(addressingPolicy(event('hi',{isGroup:false}),{},options).addressedBy,'private');
 assert.equal(addressingPolicy(event('',{isFromMe:true}),{},options).respond,false);
 assert.equal(addressingPolicy(event('time',{mentions:[bot]}),{},options).addressedBy,'mention');
 const quote={messageId:'sent',senderJid:bot,isFromBot:true};
 assert.equal(addressingPolicy(event('explain',{quoted:quote}),{},options).addressedBy,'quote-bot');
 assert.equal(addressingPolicy(event('explain',{quoted:{...quote,isFromBot:false}}),{},options).respond,false);
 for(const text of ['/ayuda','!sticker','/@ ayuda','/!tarea','#estado','.info','Oye, BOTSKY: ¿qué hora es?','¿Botsito?'])assert.equal(addressingPolicy(event(text),{},options).respond,true,text);
 for(const text of ['ese bot de música no sirve','hora feliz','oye Juan pasa pack','botskyñ','prebotsky','botsky_','botsky123','2','#3'])assert.equal(addressingPolicy(event(text),{},options).respond,false,text);
 assert.equal(addressingPolicy(event('bot'),{},{botJid:bot,wakeWords:['bot']}).respond,false);
 assert.equal(addressingPolicy(event('ping'),{},{botJid:bot,wakeWords:['ping'],prefixes:['$']}).respond,true);
});
test('Session continuation requires owner, expiry and result quote/mention or relaxed age under90sec',async()=>{
 const clock=new FakeClock(1000);const session={id:'search',ownerJid:user,createdAt:1000,expiresAt:100000,resultMessageId:'results',selectionValid:true};
 const meta={now:clock.now(),session};const quote={messageId:'results',senderJid:bot,isFromBot:true};
 assert.equal(addressingPolicy(event('el 2',{quoted:quote}),meta,options).addressedBy,'session');
 assert.equal(addressingPolicy(event('2',{mentions:[bot]}),meta,options).addressedBy,'session');
 assert.equal(addressingPolicy(event('2'),meta,options).respond,false);
 assert.equal(addressingPolicy(event('2'),meta,{...options,sessionGroupRelaxed:true}).respond,true);
 await clock.advance(90000);
 assert.equal(addressingPolicy(event('2'),{...meta,now:clock.now()},{...options,sessionGroupRelaxed:true}).respond,false);
 assert.equal(addressingPolicy(event('2'),{...meta,session:{...session,ownerJid:bot}},{...options,sessionGroupRelaxed:true}).respond,false);
 assert.equal(addressingPolicy(event('2'),{...meta,session:{...session,expiresAt:1000}},{...options,sessionGroupRelaxed:true}).respond,false);
 assert.equal(addressingPolicy(event('2'),{...meta,session:{...session,selectionValid:false}},{...options,sessionGroupRelaxed:true}).respond,false);
});
test('Own recent quoted attachment activates only with instruction, and airdrop is bounded',()=>{
 const attachment={id:'image',ownerJid:user,expiresAt:10000,quotedMatch:true,ref:'fixture',mime:'image/jpeg'};
 const quote={messageId:'image',senderJid:user,isFromBot:false};
 assert.equal(addressingPolicy(event('sticker',{quoted:quote}),{now:1000,attachment},options).addressedBy,'attachment-followup');
 assert.equal(addressingPolicy(event('',{quoted:quote}),{now:1000,attachment},options).respond,false);
 assert.equal(addressingPolicy(event('sticker',{quoted:quote}),{now:10000,attachment},options).respond,false);
 assert.equal(addressingPolicy(event('sticker',{quoted:quote}),{attachment:{...attachment,ownerJid:bot}},options).respond,false);
 assert.equal(addressingPolicy(event('yoo'),{airdropActive:true},options).reason,'active-airdrop-claim');
 assert.equal(addressingPolicy(event('yoo'),{airdropActive:false},options).respond,false);
});
