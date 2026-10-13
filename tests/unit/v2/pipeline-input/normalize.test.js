'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalize, normalizeJid } = require('../../../../src/v2/pipeline/normalize');
const { isInboundEvent } = require('../../../../src/v2/domain/events');
const clock = { now: () => 12345 };
const options = { clock, botJid: '900@s.whatsapp.net', isSentId: (chat,id) => chat === '19995559999@g.us' && id === 'sent' };
function raw(message,key = {}) { return {key:{id:'id',remoteJid:'19995559999@g.us',participant:'100:2@c.us',...key},message,pushName:'A'}; }
test('rejects malformed payloads and notifications without inbound IDs', () => {
    for (const input of [null,undefined,[],{}, {key:{}},raw({}, {participant:''}),{event:'send.message',data:raw({conversation:'a'})}]) assert.equal(normalize(input,options),null);
    assert.equal(normalizeJid(' 100:4@c.us '),'100@s.whatsapp.net');
});
test('normalizes nested provider wrappers, caption, explicit LID alt and mention metadata', () => {
    const input = raw({ephemeralMessage:{message:{viewOnceMessage:{message:{viewOnceMessageV2:{message:{viewOnceMessageV2Extension:{message:{documentWithCaptionMessage:{message:{documentMessage:{url:'ref',mimetype:'application/pdf',caption:' hola ',fileLength:12,contextInfo:{mentionedJid:['900:2@c.us',null],stanzaId:'q',participant:'900:3@s.whatsapp.net',quotedMessage:{conversation:'bot'}}}}}}}}}}}}}}, {participant:'98765@lid',participantAlt:'100@s.whatsapp.net'});
    const event = normalize(input,options);
    assert.ok(event); assert.equal(event.sender.jid,'100@s.whatsapp.net'); assert.equal(event.text,'hola');
    assert.deepEqual(event.mentions,['900@s.whatsapp.net']); assert.equal(event.quoted.isFromBot,true); assert.equal(event.quoted.text,'bot');
    assert.deepEqual(event.media,{ref:'ref',mime:'application/pdf',size:12}); assert.equal(event.receivedAt,12345);
});
test('bot quotes trust exact chat scoped ID or normalized sender, never text prefixes', () => {
    for (const [id,jid,expected] of [['q','1900@s.whatsapp.net',false],['sent','human@s.whatsapp.net',true],['q','900:2@c.us',true]]) {
        const event = normalize(raw({extendedTextMessage:{text:'2',contextInfo:{stanzaId:id,participant:jid,quotedMessage:{conversation:'bot identical text'}}}}),options);
        assert.equal(event.quoted.isFromBot,expected);
    }
    const event = normalize(raw({extendedTextMessage:{contextInfo:{stanzaId:'sent',participant:'human',quotedMessage:{}}}},{remoteJid:'19995558888@g.us'}),options);
    assert.equal(event.quoted.isFromBot,false);
});
test('all media, text, reaction and poll envelopes preserve kind without semantic routing', () => {
    const mapping = {imageMessage:'image',videoMessage:'video',audioMessage:'audio',documentMessage:'document',stickerMessage:'sticker',reactionMessage:'reaction',pollCreationMessage:'poll',pollCreationMessageV2:'poll',pollCreationMessageV3:'poll',pollUpdateMessage:'poll'};
    for (const [type,kind] of Object.entries(mapping)) {
        const event = normalize(raw({[type]:{directPath:'/ref',fileLength:-1}}),options);
        assert.equal(event.kind,kind); assert.ok(isInboundEvent(event));
        if (event.media) assert.deepEqual(event.media,{ref:'/ref',mime:'application/octet-stream'});
    }
    assert.equal(normalize(raw({imageMessage:{}}),options).media.ref,'id');
    assert.equal(normalize(raw({}),options).kind,'unknown');
    assert.equal(normalize(raw({extendedTextMessage:{text:'abc'}}),options).text,'abc');
    assert.equal(normalize(raw({conversation:'hello'}),options).kind,'text');
    const privateEvent = normalize(raw({conversation:'hello'},{remoteJid:'98765@lid',remoteJidAlt:'100@c.us',fromMe:true}),options);
    assert.equal(privateEvent.sender.jid,'100@s.whatsapp.net'); assert.equal(privateEvent.isFromMe,true);
});
test('already normalized events are copied and quote trust is recomputed', () => {
    const event = normalize(raw({conversation:'hello'}),options);
    event.quoted = {messageId:'q',senderJid:'human',isFromBot:true};
    const second = normalize(event,options); assert.equal(second.quoted.isFromBot,false); assert.notEqual(second,event);
    const withoutQuote = normalize({...event,quoted:undefined}, {clock}); assert.ok(withoutQuote);
});
test('synthetic and sanitized real fixtures normalize only messages.upsert', () => {
    const directory = path.resolve(__dirname,'../../../fixtures/webhooks');
    let valid = 0;
    for (const base of [directory,path.join(directory,'real')]) for (const name of fs.readdirSync(base).filter(name => /\.json$/.test(name) && name !== 'manifest.json')) {
        const fixture = JSON.parse(fs.readFileSync(path.join(base,name),'utf8'));
        const event = normalize(fixture,options);
        if (event) { valid++; assert.ok(isInboundEvent(event),name); }
    }
    assert.ok(valid >= 20);
});
test('pre-normalized events fail closed after canonical identity validation',()=>{
    const valid=normalize(raw({conversation:'hello'}),options);
    for(const changes of [{chatId:'unsupported@example.invalid'},{sender:{...valid.sender,jid:'bogus@s.whatsapp.net'}},{sender:{...valid.sender,jid:'19995559999@g.us'}},{isGroup:false}])assert.equal(normalize({...valid,...changes},options),null);
    const canonical=normalize({...valid,chatId:'19995559999:2@g.us',sender:{...valid.sender,jid:'5215551234567:2@c.us',number:'spoofed'},mentions:['invalid@domain.invalid','900:3@c.us']},options);
    assert.ok(isInboundEvent(canonical));assert.equal(canonical.sender.jid,'525551234567@s.whatsapp.net');assert.equal(canonical.sender.number,'525551234567');assert.deepEqual(canonical.mentions,['900@s.whatsapp.net']);
});
test('invalid bot identity cannot authenticate invalid quoted participant by empty equality',()=>{
    const input=raw({extendedTextMessage:{text:'hello',contextInfo:{stanzaId:'q',participant:'invalid@unknown',quotedMessage:{conversation:'bot'}}}});
    const event=normalize(input,{clock,botJid:'invalid@unknown'});assert.equal(event.quoted.isFromBot,false);
    const second=normalize({...event,quoted:{...event.quoted,isFromBot:true}},{clock,botJid:'invalid@unknown'});assert.equal(second.quoted.isFromBot,false);
    assert.equal(normalize(input,{clock:{now:()=>NaN}}),null);
});
