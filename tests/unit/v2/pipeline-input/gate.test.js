'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {gate}=require('../../../../src/v2/pipeline/gate');
const event={isFromMe:false,isGroup:true,chatId:'19995559999@g.us',sender:{jid:'123:4@c.us'}};
test('exact normalized allowlists and blocked identities, no substring privileges',()=>{
    assert.deepEqual(gate(event,{now:0}),{allow:true,reason:'allowed'});
    assert.equal(gate(event,{now:0,accessSnapshot:{groups:['19995558888@g.us']}}).reason,'group-not-allowed');
    assert.equal(gate(event,{now:0,accessSnapshot:{numbers:['12']}}).reason,'sender-not-allowed');
    assert.equal(gate(event,{now:0,accessSnapshot:{groups:['19995559999@g.us'],numbers:['123']}}).allow,true);
    assert.equal(gate(event,{now:0,accessSnapshot:{blocked:['123@s.whatsapp.net']}}).reason,'blocked');
    assert.equal(gate(event,{now:0,accessSnapshot:{blocked:['19995559999@g.us']}}).reason,'blocked');
    assert.equal(gate({...event,isGroup:false},{now:0,accessSnapshot:{groups:['19995558888@g.us']}}).allow,true);
});
test('time, echoes, rate and cooldown snapshots are pure and fail closed',()=>{
    assert.equal(gate(event,{now:NaN}).reason,'invalid-time');
    assert.equal(gate({...event,isFromMe:true},{now:0}).reason,'outbound-echo');
    assert.equal(gate(event,{now:5,rateState:{limited:true}}).reason,'rate-limit');
    assert.equal(gate(event,{now:5,rateState:{blockedUntil:6}}).reason,'rate-limit');
    assert.equal(gate(event,{now:5,rateState:{cooldownUntil:6}}).reason,'cooldown');
    const snapshot=Object.freeze({blockedUntil:5,cooldownUntil:5});
    assert.equal(gate(event,{now:5,rateState:snapshot}).allow,true);
});
