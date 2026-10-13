'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S07b: observable pipeline contract',async()=>{
const f=fixture();f.store.set('pipeline.session',JSON.stringify([GROUP,USER]),{id:'search',ownerJid:USER,createdAt:f.clock.now(),expiresAt:f.clock.now()+900000,resultMessageId:'RESULTS',selectionValid:true,feature:'test',name:'do',args:{selection:2}},900000);await f.handle(raw('1','2',{quote:{id:'RESULTS',sender:BOT}}));assert.equal(f.executions.length,1);assert.equal(f.executions[0].args.selection,2);assert.equal(f.requests.length,0);f.dispose();
});
