'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S14: observable pipeline contract',async()=>{
const f=fixture();f.executions.length=0;const restricted={id:'admin',commands:[{name:'secure',scope:['private','group'],access:'admin',tier:'none',help:{short:'Restricted',examples:[]},handler:async()=>{throw new Error('Must never execute');}}],intents:[{id:'admin.secure',description:'Restricted',schema:{type:'object'},command:'secure'}]};const a=fixture({features:[restricted],plan:{kind:'intent',intent:'admin.secure',args:{}}});await a.handle(raw('1','Botsky secure'));await a.handle(raw('2','!secure'));assert.equal(a.sent.length,2);for(const item of a.sent)assert.match(item.args[1],/permisos/);a.dispose();f.dispose();
});
