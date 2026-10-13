'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S05: observable pipeline contract',async()=>{
const f=fixture();await f.handle(raw('1','oye Juan ¿me pasas un pack de exámenes?'));assert.equal(f.executions.length,0);assert.equal(f.sent.length,0);assert.equal(f.passives.length,1);f.dispose();
});
