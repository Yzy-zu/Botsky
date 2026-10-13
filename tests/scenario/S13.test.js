'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S13: observable pipeline contract',async()=>{
const f=fixture();await f.handle(raw('echo','Completed',{fromMe:true}));assert.equal(f.passives.length,0);assert.equal(f.historyReads.length,0);assert.equal(f.sent.length,0);f.dispose();
});
