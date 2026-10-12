'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createMetrics}=require('../../../src/v2/platform/metrics');
test('closed label values reject arbitrary user dimensions and cap series',()=>{
    const m=createMetrics({names:['command'],labels:{tier:['light','heavy'],outcome:['ok','error']},maxSeries:2});
    assert.equal(m.increment('command',{tier:'light',outcome:'ok'}),true);assert.equal(m.increment('command',{outcome:'ok',tier:'light'},2),true);
    assert.equal(m.increment('command',{tier:'heavy'}),true);assert.equal(m.increment('command',{outcome:'error'}),false);
    assert.equal(m.increment('command',{jid:'personal'}),false);assert.equal(m.increment('command',{tier:'private text'}),false);assert.equal(m.increment('unknown'),false);
    assert.equal(m.increment('command',{},NaN),false);assert.equal(m.increment('command',{},-1),false);assert.equal(m.size(),2);
    const snapshot=m.snapshot();assert.equal(Object.values(snapshot)[0],3);snapshot.fake=9;assert.equal(m.size(),2);
    assert.throws(()=>createMetrics({names:[],maxSeries:0}));
});
