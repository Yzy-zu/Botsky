'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S03: observable pipeline contract',async()=>{
const f=fixture();await f.handle(raw('1','dime la hora',{mentions:[BOT]}));assert.equal(f.sent.length,1);assert.equal(f.executions.length,1);f.dispose();
});
