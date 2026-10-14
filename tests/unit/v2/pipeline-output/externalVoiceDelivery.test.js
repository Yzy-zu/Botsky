'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createComposer}=require('../../../../src/v2/pipeline/composer');
const {isReply,isDeliveryRequest}=require('../../../../src/v2/domain/types');
const SOURCE='19995550101@s.whatsapp.net',TARGET='19995550102@s.whatsapp.net';
const ctx=()=>({event:{id:'request',chatId:SOURCE,isGroup:false,sender:{jid:SOURCE}},roles:{admins:[SOURCE],owners:[]},history:[]});
const part=()=>({type:'audio',ref:'/synthetic/voice.mp3',mime:'audio/mpeg',transcript:'Hola',durationSeconds:1,delivery:{scope:'contact',contactQuery:'Juan',expectedJid:TARGET}});
function setup(extra={}){
 const sends=[],records=[],ids=[],media=[],released=[];
 const messenger={sendVoice:async(...args)=>{sends.push(['voice',...args]);return{messageId:'voice-ack'};},sendText:async(...args)=>{sends.push(['text',...args]);return{messageId:'text-ack'};},...extra.messenger};
 const composer=createComposer({llm:{},record:async(c,text)=>records.push([c.event.chatId,c.event.id,text]),rememberSent:(chat,id)=>ids.push([chat,id]),rememberMedia:async(c,p,d)=>media.push([c.event.chatId,p,d]),releaseMedia:async ref=>released.push(ref),resolveDelivery:async()=>({status:'ready',target:{jid:TARGET,name:'Juan',isGroup:false,scope:'contact'}}),...extra,messenger});
 return{composer,sends,records,ids,media,released};
}
test('external voice is authorized, acknowledged and cached in its destination, then confirmed locally',async()=>{
 const f=setup();await f.composer.compose(ctx(),{parts:[part()]});
 assert.equal(f.sends[0][1],TARGET);assert.deepEqual(f.sends[0][3],{transcript:'Hola',durationSeconds:1});
 assert.deepEqual(f.ids,[[TARGET,'voice-ack'],[SOURCE,'text-ack']]);
 assert.deepEqual(f.records[0],[TARGET,'voice-ack','[Nota de voz: Hola]']);assert.equal(f.media[0][0],TARGET);
 assert.match(f.sends[1][2],/Mandé el audio a Juan/);assert.deepEqual(f.released,['/synthetic/voice.mp3']);
});
test('denied, ambiguous, invalid and changed destinations never receive audio',async()=>{
 const cases=[undefined,async()=>({status:'denied',reason:'admin_required'}),async()=>({status:'needs_clarification',question:'¿Cuál Juan?',missingFields:['contact']}),async()=>({status:'ready',target:{jid:'garbage',name:'x',scope:'contact'}}),async()=>({status:'ready',target:{jid:TARGET,name:'x',scope:'main_group'}}),async()=>({status:'ready',target:{jid:'19995550103@s.whatsapp.net',name:'x',scope:'contact'}})];
 for(const resolver of cases){const f=setup({resolveDelivery:resolver});await f.composer.compose(ctx(),{parts:[part()]});assert.equal(f.sends.filter(x=>x[0]==='voice').length,0);assert.equal(f.sends[0][1],SOURCE);assert.equal(f.released.length,1);}
 const c=ctx();c.roles.admins=[];const f=setup({resolveDelivery:async()=>assert.fail('Denied sender cannot resolve contacts')});await f.composer.compose(c,{parts:[part()]});assert.match(f.sends[0][2],/administradores/);
});
test('malformed delivery metadata is rejected and unsupported metadata cannot change a non-audio destination',async()=>{
 for(const delivery of [null,[],{scope:'elsewhere'},{scope:'contact',contactQuery:''},{scope:'contact',contactQuery:'Juan'},{scope:'contact',expectedJid:''}])assert.equal(isDeliveryRequest(delivery),false);
 assert.equal(isReply({parts:[{...part(),type:'image'}]}),false);
 const f=setup();await f.composer.compose(ctx(),{parts:[{...part(),delivery:{scope:'contact',contactQuery:''}}]});assert.equal(f.sends[0][0],'text');
});

test('thrown or partially acknowledged external sends produce uncertainty guidance without replay or invented receipt',async()=>{
 for(const error of [Error('timeout'),Object.assign(Error('response parsing failed'),{deliveryAcknowledged:true})]){
  let attempts=0;const f=setup({messenger:{sendVoice:async()=>{attempts++;throw error;}}});
  await f.composer.compose(ctx(),{parts:[part()]});assert.equal(attempts,1);assert.match(f.sends[0][2],/Revisa el chat destinatario antes/);assert.equal(f.media.length,0);assert.equal(f.ids.some(x=>x[0]===TARGET),false);assert.equal(f.records.some(x=>x[0]===TARGET),false);assert.equal(f.released.length,1);
 }
});
test('failed confirmation and uncertain delivery never replay the external payload',async()=>{
 let attempts=0;const f=setup({messenger:{sendVoice:async()=>{attempts++;return{messageId:'voice-ack'};},sendText:async()=>{throw Error('confirmation failed');}}});await f.composer.compose(ctx(),{parts:[part()]});assert.equal(attempts,1);assert.equal(f.composer.observationFailures,1);assert.equal(f.media.length,1);
 const uncertain=setup({messenger:{sendVoice:async()=>null}});await uncertain.composer.compose(ctx(),{parts:[part()]});assert.match(uncertain.sends[0][2],/No tengo confirmación/);assert.equal(uncertain.records.some(x=>x[2].includes('Nota de voz')),false);
});
test('closing during destination lookup prevents a late external send and still releases the file',async()=>{
 let closed=false;const f=setup({isClosed:()=>closed,resolveDelivery:async()=>{closed=true;return{status:'ready',target:{jid:TARGET,name:'Juan',scope:'contact'}};}});await f.composer.compose(ctx(),{parts:[part()]});assert.equal(f.sends.length,0);assert.equal(f.released.length,1);
});
