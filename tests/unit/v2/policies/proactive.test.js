'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {proactivePolicy}=require('../../../../src/v2/policies/proactive.policy');
const day=Date.UTC(2026,9,13,18);const base={groupOptIn:true,globalEnabled:true,now:day,dailyCount:0};
test('Opt-in, kill switches, private flag, quota and separation deny or allow exactly at limits',()=>{
 assert.equal(proactivePolicy(base).allow,true);
 for(const input of [{globalEnabled:false},{chatKilled:true},{groupOptIn:false},{dailyCount:3},{lastSentAt:day-2700000+1}])assert.equal(proactivePolicy({...base,...input}).allow,false);
 assert.equal(proactivePolicy({...base,lastSentAt:day-2700000}).allow,true);
 assert.equal(proactivePolicy({...base,privateRequested:true,groupOptIn:false}).reason,'private-disabled');
 assert.equal(proactivePolicy({...base,privateRequested:true,privateEnabled:true,groupOptIn:false,lastSentAt:null}).allow,true);
 for(const input of [{dailyCount:-1},{now:NaN},{quota:-1},{lastSentAt:day+1},{lastSentAt:NaN},{minIntervalMs:-1}])assert.equal(proactivePolicy({...base,...input}).allow,false);
});
test('Timezone quiet interval crosses midnight and fails closed on invalid inputs',()=>{
 const at=(hour,minute=0)=>({...base,timezone:'UTC',now:Date.UTC(2026,9,13,hour,minute)});
 for(const hour of [23,0,7])assert.equal(proactivePolicy(at(hour)).reason,'quiet-hours');
 assert.equal(proactivePolicy(at(8)).allow,true);
 assert.equal(proactivePolicy(at(22,59)).allow,true);
 assert.equal(proactivePolicy({...at(12),quietStart:'11:00',quietEnd:'13:00'}).allow,false);
 assert.equal(proactivePolicy({...at(10),quietStart:'11:00',quietEnd:'13:00'}).allow,true);
 assert.equal(proactivePolicy({...base,quietStart:'08:00',quietEnd:'08:00'}).allow,false);
 for(const input of [{quietStart:'24:00'},{quietEnd:'08:60'},{quietStart:'bad'},{timezone:'Unknown/Timezone'}])assert.equal(proactivePolicy({...base,...input}).allow,false);
});
