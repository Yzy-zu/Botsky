'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDocumentsFeature}=require('../../../../src/v2/features/documents/manifest');
const {FakeClock}=require('../../../../src/v2/platform/clock');
const {TtlStore}=require('../../../../src/v2/platform/ttlStore');

const signal=new AbortController().signal;
function fixture(){
 const clock=new FakeClock(1),store=new TtlStore({clock}),calls=[];
 const feature=createDocumentsFeature({clock,store,process:async request=>{calls.push(request);return{parts:[{type:'text',text:'unexpected process'}]};},readContent:async()=>''});
 const context={event:{id:'trace-event',chatId:'19995550000@s.whatsapp.net',isGroup:false,sender:{jid:'19995550000@s.whatsapp.net',name:'Test'},text:'',mentions:[],receivedAt:1},addressing:{respond:true,reason:'command'},history:[],correlationId:'trace-correlation',roles:{admins:[],owners:[]}};
 return{clock,store,calls,feature,context};
}

test('TR-0214: convertir rejects an unknown output format with user-facing guidance before processing',async()=>{
 const f=fixture();
 try{
  const command=f.feature.commands.find(item=>item.name==='convertir');
  const reply=await command.handler(f.context,{format:'formato_inventado_xyz'},signal);
  assert.match(reply.parts[0].text,/formato|inválido|invalido/i);
  assert.equal(f.calls.length,0,'invalid format never reaches the media operation port');
  assert.doesNotMatch(reply.parts[0].text,/Error:|\bat .*\.js:/);
 }finally{f.store.dispose();}
});

test('TR-0215: convertir without attachment or URL asks for a file/link and does not expose a stack',async()=>{
 const f=fixture();
 try{
  const command=f.feature.commands.find(item=>item.name==='convertir');
  const reply=await command.handler(f.context,{format:'pdf'},signal);
  assert.match(reply.parts[0].text,/archivo o su enlace/i);
  assert.doesNotMatch(reply.parts[0].text,/Error:|\bat .*\.js:/);
  assert.equal(f.calls.length,0,'missing input never reaches the media operation port');
 }finally{f.store.dispose();}
});
