'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT,USER,GROUP}=require('../helpers/pipeline');
test('S16: observable pipeline contract',async()=>{
const {accessPolicy}=require('../../src/v2/policies/access.policy');assert.equal(accessPolicy({senderJid:USER,chatId:'19995550000123@g.us',isGroup:true,roles:{admins:[BOT]},requiredAccess:'admin'}).allow,false);
});
