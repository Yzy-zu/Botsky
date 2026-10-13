'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S08: observable pipeline contract',async()=>{
const f=fixture();await f.handle(raw('image','',{private:true,media:true}));assert.equal(f.sent[0].name,'react');assert.equal(f.sent[0].args[1],'👀');assert.equal(f.sent.length,2);await f.handle(raw('next','sticker',{private:true}));assert.equal(f.executions[0].ctx.attachment.id,'image');f.dispose();
});
