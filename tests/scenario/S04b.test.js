'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S04b: observable pipeline contract',async()=>{
const f=fixture();await f.handle(raw('1','ayúdame',{quote:{id:'HUMAN',sender:USER,text:'Completed'}}));assert.equal(f.sent.length,0);f.dispose();
});
