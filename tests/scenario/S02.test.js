'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S02: observable pipeline contract',async()=>{
const f=fixture();await f.handle(raw('1','ese bot de música no sirve'));assert.equal(f.sent.length,0);assert.equal(f.requests.length,0);f.dispose();
});
