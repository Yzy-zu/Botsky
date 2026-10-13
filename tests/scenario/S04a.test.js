'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S04a: observable pipeline contract',async()=>{
const f=fixture();await f.handle(raw('1','ayúdame',{quote:{id:'RESULTS',sender:BOT}}));assert.equal(f.sent.length,1);f.dispose();
});
