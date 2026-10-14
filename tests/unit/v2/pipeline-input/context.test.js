'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {createContext,contextKey}=require('../../../../src/v2/pipeline/context');
const {FakeClock}=require('../../../../src/v2/platform/clock');
const {TtlStore}=require('../../../../src/v2/platform/ttlStore');
function event(options={}) { return {id:'m',chatId:'g@g.us',isGroup:true,sender:{jid:'100@s.whatsapp.net'},text:'',kind:'image',media:{ref:'ref',mime:'image/jpeg'},isFromMe:false,...options}; }
function setup(options={}) { const clock=new FakeClock(100); const store=new TtlStore({clock}); let reads=0; const conversation={recent:async()=>{reads++;return[{role:'user',content:'private'}];}}; const context=createContext({clock,store,conversation,...options});return {clock,store,context,get reads(){return reads;}}; }
test('observe preserves lightweight attachment identity and exact ten minute TTL',async()=>{
    const setupState=setup();const {context,clock,store}=setupState;
    context.observe(event({media:undefined}));context.observe(event({isFromMe:true}));assert.equal(store.size,0);
    context.observe(event()); const attachment=context.addressingMetadata(event()).attachment;
    assert.deepEqual(attachment,{id:'m',ownerJid:'100@s.whatsapp.net',chatId:'g@g.us',expiresAt:600100,ref:'ref',mime:'image/jpeg',kind:'image',quotedMatch:false});
    assert.equal(context.addressingMetadata(event({sender:{jid:'other'}})).attachment,undefined);
    assert.equal(context.addressingMetadata(event({quoted:{messageId:'unseen'}})).attachment,undefined,'Unknown quote cannot resolve to a different recent attachment');
    const quoted=context.addressingMetadata(event({id:'new',sender:{jid:'other'},quoted:{messageId:'m'}})).attachment;
    assert.equal(quoted.quotedMatch,true); assert.equal(quoted.ownerJid,'100@s.whatsapp.net');
    assert.equal(context.addressingMetadata(event({chatId:'other',quoted:{messageId:'m'}})).attachment,undefined);
    await clock.advance(599999);assert.ok(context.addressingMetadata(event()).attachment);
    await clock.advance(1);assert.equal(context.addressingMetadata(event()).attachment,undefined);assert.equal(clock.pendingTimers,0);
});
test('expired cache objects, mismatched owner, and unmatched quote never widen access',()=>{
    const {context,clock,store}=setup(); const key=contextKey('g@g.us','100@s.whatsapp.net');
    store.set('pipeline.attachment.owner',key,{id:'m',ownerJid:'other',expiresAt:1000},1000);
    assert.equal(context.addressingMetadata(event()).attachment,undefined);
    store.set('pipeline.attachment.owner',key,{id:'m',ownerJid:'100@s.whatsapp.net',expiresAt:clock.now()},1000);
    store.set('pipeline.attachment.id',contextKey('g@g.us','q'),{id:'q',expiresAt:clock.now()},1000);
    assert.equal(context.addressingMetadata(event({quoted:{messageId:'q'}})).attachment,undefined);
});
test('sessions retain immutable producer bounds status with owner/time isolation',()=>{
    const {context,store}=setup(); const key=contextKey('g@g.us','100@s.whatsapp.net');
    const session={id:'search',ownerJid:'100@s.whatsapp.net',createdAt:0,expiresAt:1000,resultMessageId:'result',selectionValid:false};
    store.set('pipeline.session',key,session,1000);store.set('pipeline.airdrop','g@g.us',true,1000);
    const metadata=context.addressingMetadata(event({text:'2'}));assert.deepEqual(metadata.session,session);assert.notEqual(metadata.session,session);assert.equal(metadata.airdropActive,true);
    assert.equal(context.addressingMetadata(event({sender:{jid:'other'}})).session,undefined);
    store.set('pipeline.session',key,{...session,ownerJid:'other'},1000);assert.equal(context.addressingMetadata(event()).session,undefined);
    store.set('pipeline.session',key,{...session,expiresAt:100},1000);assert.equal(context.addressingMetadata(event()).session,undefined);
});
test('passive requests never read history; addressed groups fail closed without thread port',async()=>{
    const state=setup();const {context}=state;
    assert.deepEqual((await context.build(event(),{respond:false,reason:'passive'})).history,[]);assert.equal(state.reads,0);
    assert.deepEqual((await context.build(event(),{respond:true,reason:'mention'})).history,[]);assert.equal(state.reads,0);
    const result=await context.build(event({isGroup:false}),{respond:true,reason:'private'});
    assert.deepEqual(result.history,[{role:'user',content:'private'}]);assert.equal(state.reads,1);
    assert.deepEqual(result.roles,{admins:[],owners:[]});assert.equal(result.correlationId,'m');
});
test('group thread port receives sender/quote/limit and roles/history are copied',async()=>{
    const calls=[]; const roles={admins:['a'],owners:['o'],members:['m'],groups:['g']};
    const {context}=setup({historyLimit:2,roles,conversation:{recent:async()=>{throw Error('flat history prohibited');},recentThread:async(...args)=>{calls.push(args);return [{role:'user',content:'old',name:'secret'},{role:'user',content:'one'},{role:'assistant',content:'two'}];}}});
    const result=await context.build(event({quoted:{messageId:'result'}}),{respond:true,reason:'quote'});
    assert.deepEqual(calls,[['g@g.us','100@s.whatsapp.net','result',2]]);assert.deepEqual(result.history,[{role:'user',content:'one'},{role:'assistant',content:'two'}]);
    result.roles.admins.push('changed');assert.deepEqual(roles.admins,['a']);
});
test('invalid history bounds fail without reading a port',()=>{
    for(const historyLimit of [0,101,1.5]) assert.throws(()=>setup({historyLimit}),/history limit/);
});

test('provider lookup preserves original device/LID identities for direct and wrapped Evolution media',async()=>{
    for(const wrapped of [false,true]) {
        const {context,clock}=setup();
        const provider={id:'lid-media',remoteJid:'123456:4@lid',participant:'987654:2@lid',fromMe:false};
        const data={key:provider,message:{imageMessage:{mediaKey:'private-key',base64:'private-bytes',jpegThumbnail:'private-thumb'}}};
        const media=event({id:provider.id,chatId:'123456@lid',isGroup:false,raw:wrapped?{event:'messages.upsert',data}:data});
        assert.equal(context.observe(media),true);
        const recent=context.addressingMetadata(media).attachment;
        const quoted=context.addressingMetadata({...media,id:'followup',media:undefined,quoted:{messageId:media.id}}).attachment;
        assert.deepEqual(recent.providerKey,provider);assert.deepEqual(quoted.providerKey,provider);
        assert.ok(!JSON.stringify(recent).includes('private-'));
        const ctx=await context.build(media,{respond:true,reason:'private-chat'});
        assert.deepEqual(ctx.attachment.providerKey,provider);
        await clock.advance(600000);assert.equal(context.addressingMetadata(media).attachment,undefined);
    }
});
test('uncached current attachment uses the same original key and mismatched raw identities are never reused',async()=>{
    const {context,store}=setup();store.maxEntries=1;store.set('unrelated','full',true,10000);
    const key={id:'full-current',remoteJid:'19995559999@g.us',participant:'100:2@s.whatsapp.net'};
    const media=event({id:key.id,chatId:key.remoteJid,raw:{event:'messages.upsert',data:{key}}});
    assert.equal(context.observe(media),false);
    assert.deepEqual((await context.build(media,{respond:true,reason:'wake-word'},{allowCurrentMediaFallback:true})).attachment.providerKey,{...key,fromMe:false});
    for(const wrong of [{...key,id:'other-message'},{...key,remoteJid:'other@g.us'},null]){
        const bad={...media,raw:{data:{key:wrong}}};
        const ctx=await context.build(bad,{respond:true,reason:'wake-word'},{allowCurrentMediaFallback:true});
        assert.equal(ctx.attachment.providerKey,undefined);
    }
});
