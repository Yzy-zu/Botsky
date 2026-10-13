'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S01: observable pipeline contract',async()=>{
const f=fixture();await f.handle(raw('1','Hola Juan'));assert.equal(f.sent.length,0);assert.equal(f.requests.length,0);assert.deepEqual(f.passives,['1']);assert.equal(f.historyReads.length,0);f.dispose();
});
