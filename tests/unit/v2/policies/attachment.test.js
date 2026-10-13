'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {attachmentPolicy}=require('../../../../src/v2/policies/attachment.policy');
function event(kind='image',extra={}){return{id:'file',chatId:'19995550101@s.whatsapp.net',isGroup:false,sender:{jid:'19995550101@s.whatsapp.net',number:'19995550101',name:'Fake'},text:'',kind,mentions:[],media:{ref:'fixture',mime:'image/jpeg'},isFromMe:false,receivedAt:1000,raw:{},...extra}}
test('Private bare media offers exactly one short suggestion and a reaction, group caches silently',()=>{
 for(const kind of ['image','video','audio','document']){
  const result=attachmentPolicy(event(kind),{});assert.equal(result.cache,true);assert.equal(result.suggest.parts.length,2);assert.equal(result.suggest.parts[0].emoji,'👀');assert.ok(result.suggest.parts[1].text.length<120);
 }
 assert.equal(attachmentPolicy(event('image',{isGroup:true}),{}).suggest,undefined);
 assert.equal(attachmentPolicy(event('image',{text:'read this'}),{}).suggest,undefined);
 assert.equal(attachmentPolicy(event('sticker'),{}).suggest,undefined);
 assert.equal(attachmentPolicy(event('image',{isFromMe:true}),{}).cache,false);
 assert.equal(attachmentPolicy(event('unknown',{media:undefined}),{}).cache,false);
});
test('Short private followup and group quoted/mentioned own attachment are bounded by owner and expiry',()=>{
 const attachment={id:'file',ownerJid:'19995550101@s.whatsapp.net',expiresAt:10000,quotedMatch:true,ref:'fixture',mime:'image/jpeg'};
 const incoming=event('text',{text:'sticker',media:undefined});
 assert.equal(attachmentPolicy(incoming,{attachment}).followupAllowed,true);
 assert.equal(attachmentPolicy(incoming,{attachment,now:10000}).followupAllowed,false);
 assert.equal(attachmentPolicy(incoming,{attachment:{...attachment,ownerJid:'19995550100@s.whatsapp.net'}}).followupAllowed,false);
 assert.equal(attachmentPolicy({...incoming,text:'x'.repeat(81)},{attachment}).followupAllowed,false);
 const group={...incoming,isGroup:true};
 assert.equal(attachmentPolicy(group,{attachment}).followupAllowed,false);
 assert.equal(attachmentPolicy({...group,quoted:{messageId:'file',senderJid:attachment.ownerJid,isFromBot:false}},{attachment}).followupAllowed,true);
 assert.equal(attachmentPolicy({...group,mentions:['19995550100@s.whatsapp.net']},{attachment,botJid:'19995550100@s.whatsapp.net'}).followupAllowed,true);
});
