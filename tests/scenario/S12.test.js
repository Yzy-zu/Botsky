'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S12: observable pipeline contract',async()=>{
const f=fixture();const promises=[f.pipeline.handle(raw('1','Botsky')),f.pipeline.handle(raw('2','haz')),f.pipeline.handle(raw('3','esto'))];await Promise.resolve();await f.clock.advance(1200);await Promise.all(promises);assert.equal(f.executions.length,1);assert.equal(f.executions[0].ctx.event.text,'Botsky\nhaz\nesto');assert.equal(f.passives.length,3);f.dispose();
});
