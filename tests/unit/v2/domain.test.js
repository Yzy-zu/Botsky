'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {isInboundEvent}=require('../../../src/v2/domain/events');const {isReply}=require('../../../src/v2/domain/types');const {AppError,toUserFeedback}=require('../../../src/v2/domain/errors');
test('event and discriminated replies validate contract shape',()=>{
    const event={id:'event',chatId:'chat',isGroup:false,sender:{jid:'jid',number:'number',name:'name'},text:'hola',kind:'text',mentions:[],isFromMe:false,receivedAt:0,raw:{}};
    assert.equal(isInboundEvent(event),true);assert.equal(isInboundEvent({...event,mentions:[1]}),false);assert.equal(isInboundEvent({...event,media:{ref:'a',mime:'b',size:-1}}),false);
    for (const field of ['media','quoted','sender','raw']) {
        for (const value of [null,false,0,[]]) assert.equal(isInboundEvent({...event,[field]:value}),false);
    }
    assert.equal(isReply({parts:[{type:'text',text:'hola'},{type:'image',ref:'file',mime:'image/png'},{type:'reaction',emoji:'👀',messageId:'id'},{type:'poll',name:'poll',options:['a','b']}]}),true);
    assert.equal(isReply({parts:[{type:'text',text:1}]}),false);assert.equal(isReply({parts:[{type:'poll',name:'poll',options:['one']}]}),false);
});
test('every failure maps to actionable Spanish feedback without raw cause',()=>{
    for(const kind of ['quota','auth_key','timeout','safety_block','bad_output','unsupported_media','too_large','network','unknown']){const error=new AppError(kind,{cause:new Error('secret raw stack')});const feedback=toUserFeedback(error);assert.equal(feedback.kind,kind);assert.ok(feedback.message&&feedback.nextStep);assert.ok(!JSON.stringify(feedback).includes('secret'));}
    assert.equal(toUserFeedback(new Error('private input')).kind,'unknown');assert.equal(toUserFeedback(new AppError('invalid')).kind,'unknown');
});
