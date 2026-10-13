'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S06: observable pipeline contract',async()=>{
const f=fixture();await f.handle(raw('1','¿a qué hora es la hora feliz?'));assert.equal(f.sent.length,0);f.dispose();
});
