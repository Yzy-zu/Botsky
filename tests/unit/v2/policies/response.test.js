'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {responsePolicy,responseRepetition}=require('../../../../src/v2/policies/response.policy');
const reply=text=>({replyTo:'incoming',parts:[{type:'text',text}]});
test('Response budgets apply per chat and preserve Unicode, metadata and requested long detail',()=>{
 const source=reply('😀'.repeat(800));const before=JSON.stringify(source);
 assert.equal(Array.from(responsePolicy(source,{isGroup:false}).parts[0].text).length,600);
 assert.equal(Array.from(responsePolicy(source,{isGroup:true}).parts[0].text).length,350);
 assert.equal(responsePolicy(source,{isGroup:true,detailRequested:true}).parts[0].text,source.parts[0].text);
 assert.equal(responsePolicy(source,{isGroup:true,allowLong:true}).parts[0].text,source.parts[0].text);
 assert.equal(JSON.stringify(source),before);
 assert.equal(responsePolicy(reply('long'),{isGroup:true,groupMaxChars:1}).parts[0].text,'…');
 assert.throws(()=>responsePolicy(source,{isGroup:true,groupMaxChars:0}),RangeError);
});
test('Status lines, terminal prefixes and total multipart budget are limited without losing nontext parts',()=>{
 const state=reply('1\n2\n3\n4\n5\n6\n7');
 assert.equal(responsePolicy(state,{isGroup:true,status:true}).parts[0].text,'1\n2\n3\n4\n5\n6');
 assert.equal(responsePolicy(reply('[!] error falta cuota\n> ❌ reenvía el archivo'),{isGroup:false}).parts[0].text,'falta cuota\nreenvía el archivo');
 const source={parts:[{type:'text',text:'abcde'},{type:'image',ref:'x',mime:'image/jpeg',caption:'abcdef'},{type:'text',text:'left'},{type:'poll',name:'pick',options:['A','B']},{type:'reaction',emoji:'👀',messageId:'incoming'}]};
 const result=responsePolicy(source,{isGroup:true,groupMaxChars:8});assert.equal(result.parts.length,4);assert.equal(result.parts[1].caption,'ab…');result.parts[2].options.push('C');assert.equal(source.parts[3].options.length,2);
 const status=responsePolicy({parts:[{type:'text',text:'line'},{type:'text',text:'extra'}]},{isGroup:true,status:true,maxStatusLines:1});assert.equal(status.parts.length,1);
});
test('Repeated output requests a single variation and only then uses a short fallback',()=>{
 const source=reply('Repeated answer');const recent=['Repeated answer'];
 assert.equal(responseRepetition(source,recent),'vary-once');
 assert.equal(responseRepetition(source,recent,true),'fallback');
 assert.equal(responseRepetition(reply('new'),recent),'none');
 assert.equal(responseRepetition({parts:[]},recent),'none');
 assert.equal(responsePolicy(source,{isGroup:false,recentReplies:recent}).parts[0].text,'Repeated answer');
 assert.equal(responsePolicy(source,{isGroup:false,recentReplies:recent,variationAttempted:true}).parts[0].text,'¿Quieres que lo explique de otra forma?');
});
