'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S15: observable pipeline contract',async()=>{
const {proactivePolicy}=require('../../src/v2/policies/proactive.policy');const base={groupOptIn:false,globalEnabled:true,now:Date.parse('2026-10-13T18:00:00Z'),timezone:'America/Mexico_City',lastSentAt:0,dailyCount:0};assert.equal(proactivePolicy(base).allow,false);assert.equal(proactivePolicy({...base,groupOptIn:true,dailyCount:3}).allow,false);assert.equal(proactivePolicy({...base,groupOptIn:true,now:Date.parse('2026-10-14T06:00:00Z')}).allow,false);
});
