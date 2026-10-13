'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {accessPolicy,normalizeJid}=require('../../../../src/v2/policies/access.policy');
const roles={members:['19995550101'],admins:['5215512345678@s.whatsapp.net'],owners:['19995550100']};
const base={senderJid:'19995550101@s.whatsapp.net',chatId:'120363000000000001@g.us',isGroup:true,roles,requiredAccess:'member'};
test('Role hierarchy and scope compare canonical identities exactly',()=>{
 assert.equal(accessPolicy(base).allow,true);
 assert.equal(accessPolicy({...base,requiredAccess:'admin'}).allow,false);
 assert.equal(accessPolicy({...base,senderJid:'525512345678:2@s.whatsapp.net',requiredAccess:'admin'}).allow,true);
 assert.equal(accessPolicy({...base,senderJid:'19995550100@s.whatsapp.net',requiredAccess:'owner'}).allow,true);
 assert.equal(accessPolicy({...base,senderJid:'19995550199@s.whatsapp.net',requiredAccess:'public'}).allow,true);
 assert.equal(accessPolicy({...base,scope:['private']}).reason,'scope-denied');
 assert.equal(accessPolicy({...base,isGroup:false,scope:['private']}).allow,true);
 for(const senderJid of ['120363525512345678@g.us','525512345678@lid','', '19995550100@s.whatsapp.net@evil','nobody@example.org'])assert.equal(accessPolicy({...base,senderJid,requiredAccess:'owner'}).allow,false);
 assert.equal(accessPolicy({...base,chatId:''}).allow,false);
 assert.equal(accessPolicy({...base,requiredAccess:'invalid'}).reason,'invalid-access');
});
test('Normalization preserves namespaces and rejects malformed identities',()=>{
 assert.equal(normalizeJid('+525512345678'),'525512345678@s.whatsapp.net');
 assert.equal(normalizeJid('5512345678'),'525512345678@s.whatsapp.net');
 assert.equal(normalizeJid('991234:2@lid'),'991234@lid');
 for(const jid of ['human@s.whatsapp.net','x@lid','x@g.us','a@b@c',''])assert.equal(normalizeJid(jid),'');
 assert.equal(normalizeJid('123-456@g.us'),'123-456@g.us');
});
