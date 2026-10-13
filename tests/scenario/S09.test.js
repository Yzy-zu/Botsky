'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S09: observable pipeline contract',async()=>{
const f=fixture();await f.handle(raw('image','',{media:true}));assert.equal(f.sent.length,0);assert.ok(f.store.get('pipeline.attachment.owner',JSON.stringify([GROUP,USER])));await f.clock.advance(600000);assert.equal(f.store.get('pipeline.attachment.owner',JSON.stringify([GROUP,USER])),undefined);f.dispose();
});
