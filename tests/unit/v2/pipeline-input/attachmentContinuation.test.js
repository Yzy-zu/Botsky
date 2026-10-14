'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,raw,BOT}=require('../../../helpers/pipeline');
const {createContext,contextKey}=require('../../../../src/v2/pipeline/context');
const {normalize}=require('../../../../src/v2/pipeline/normalize');
const {TtlStore}=require('../../../../src/v2/platform/ttlStore');
const {FakeClock}=require('../../../../src/v2/platform/clock');

test('invalid arguments or unauthorized continuation cannot wake unaddressed group media',async()=>{
    for(const extra of [{access:'owner',argsSchema:{}},{access:'public',argsSchema:{type:'object',properties:{},additionalProperties:false}}]){
        let attempts=0;
        const f=fixture({features:[{id:'unsafe',attachmentContinuation:()=>({name:'append',args:{unexpected:true}}),commands:[{name:'append',scope:['group'],tier:'none',help:{short:'Append',examples:[]},handler:async()=>{attempts++;return{parts:[]};},...extra}]}]});
        try{const result=await f.handle(raw('invalid-media','',{media:true}));assert.equal(result.kind,'ignore');assert.equal(attempts,0);assert.equal(f.sent.length,0);assert.equal(f.requests.length,0);}
        finally{await f.dispose();}
    }
});

test('private active bare-media continuation executes its validated command before attachment suggestion or LLM routing',async()=>{
    let attempts=0,selectors=0;
    const feature={id:'documents',attachmentContinuation:ctx=>{
        selectors++;
        return ctx.attachment?.kind==='image'&&ctx.event.text.trim()===''?{name:'append',args:{format:'pdf'}}:undefined;
    },commands:[{name:'append',aliases:[],scope:['private','group'],access:'public',tier:'none',argsSchema:{type:'object',properties:{format:{type:'string',enum:['pdf']}},required:['format'],additionalProperties:false},help:{short:'Append',examples:[]},handler:async(_ctx,args)=>{attempts++;assert.deepEqual(args,{format:'pdf'});return{parts:[{type:'text',text:'Image added'}]};}}]};
    const f=fixture({features:[feature]});
    try {
        const result=await f.handle(raw('bare-image-1','',{media:true,private:true}));
        assert.equal(result.kind,'reply');
        assert.equal(result.decision.name,'append');
        assert.equal(result.decision.via,'session');
        assert.equal(attempts,1);
        assert.equal(selectors,1);
        assert.equal(f.requests.length,0,'continuation must not invoke the router LLM');
        assert.equal(f.sent.length,1);
        assert.match(f.sent[0].args[1],/Image added/);
    } finally { f.dispose(); }
});

test('unaddressed group media stays silent even during an active collection, while a bot-mentioned upload continues it',async()=>{
    let attempts=0,selectors=0;
    const feature={id:'documents',attachmentContinuation:ctx=>{
        selectors++;
        return ctx.attachment?.kind==='image'&&ctx.event.text.trim()===''?{name:'append',args:{}}:undefined;
    },commands:[{name:'append',scope:['private','group'],access:'public',tier:'none',argsSchema:{type:'object',properties:{},additionalProperties:false},help:{short:'Append',examples:[]},handler:async()=>{attempts++;return{parts:[{type:'text',text:'Image added'}]};}}]};
    const f=fixture({features:[feature]});
    try {
        const passive=await f.handle(raw('group-bare-image','',{media:true}));
        assert.equal(passive.kind,'ignore');
        assert.equal(passive.reason,'group-not-addressed');
        assert.equal(selectors,0,'selectors cannot turn passive group uploads into addressed work');
        assert.equal(attempts,0);assert.equal(f.requests.length,0);assert.equal(f.sent.length,0);

        const directed=await f.handle(raw('group-mentioned-image','',{media:true,mentions:[BOT]}));
        assert.equal(directed.kind,'reply');
        assert.equal(directed.decision.name,'append');
        assert.equal(directed.decision.via,'session');
        assert.equal(selectors,1);assert.equal(attempts,1);
        assert.equal(f.requests.length,0);assert.equal(f.sent.length,1);
    } finally { await f.dispose(); }
});

test('a verified bot quote addresses a natural group continuation without a mention',async()=>{
    const f=fixture();
    try {
        const result=await f.handle(raw('group-quoted-followup','continúa con eso',{quote:{id:'RESULTS',sender:BOT,text:'Resultado previo'}}));
        assert.equal(result.kind,'reply');
        assert.equal(result.addressing.addressedBy,'quote-bot');
        assert.equal(f.requests.length,1);
        assert.equal(f.sent.length,1);
    } finally { await f.dispose(); }
});

test('full attachment cache keeps both indexes atomic and explicit current-media commands still work',async()=>{
    let handledRef;
    const feature={id:'media',rules:[{match:ctx=>ctx.event.text==='analyze',name:'analyze',args:{}}],commands:[{name:'analyze',scope:['private'],access:'public',tier:'none',help:{short:'Analyze',examples:[]},handler:async ctx=>{handledRef=ctx.attachment?.ref;return{parts:[{type:'text',text:'Analyzed'}]};}}]};
    const f=fixture({features:[feature]});
    try {
        f.store.maxEntries=2;
        f.store.set('unrelated','keep',{safe:true},600000);
        const result=await f.handle(raw('capacity-image','analyze',{media:true,private:true}));
        assert.equal(result.kind,'reply');
        assert.equal(handledRef,'https://fixture.invalid/image','the addressed command receives an ephemeral reference to its current upload');
        assert.equal(f.store.get('pipeline.attachment.owner',JSON.stringify(['19995550101@s.whatsapp.net','19995550101@s.whatsapp.net'])),undefined);
        assert.deepEqual(f.store.get('unrelated','keep'),{safe:true});
        assert.equal(f.store.get('pipeline.attachment.id',JSON.stringify(['19995550101@s.whatsapp.net','capacity-image'])),undefined);
        assert.equal(f.store.size,2,'no half-written reference was left behind; only the unrelated value and ingest dedupe entry remain');
    } finally { await f.dispose(); }
});

test('unexpected second-index failure restores only this attachment attempt and preserves existing TTL state',()=>{
    const clock=new FakeClock(1000),store=new TtlStore({clock,maxEntries:10});
    const event=normalize(raw('atomic-image','',{media:true}),{clock,botJid:BOT});
    const ownerKey=contextKey(event.chatId,event.sender.jid),idKey=contextKey(event.chatId,event.id);
    const previousOwner={id:'older',ownerJid:event.sender.jid,chatId:event.chatId,expiresAt:5000,ref:'old-owner-ref',mime:'image/png'};
    const previousId={...previousOwner,id:event.id,ref:'old-message-ref'};
    store.set('pipeline.attachment.owner',ownerKey,previousOwner,4000);
    store.set('pipeline.attachment.id',idKey,previousId,4000);
    store.set('unrelated','keep',{value:'untouched'},4000);
    const set=store.set.bind(store);let fail=true;
    store.set=(namespace,key,value,ttl)=>{
        if(fail&&namespace==='pipeline.attachment.id'&&key===idKey){fail=false;throw new Error('simulated write failure');}
        return set(namespace,key,value,ttl);
    };
    const context=createContext({clock,store,conversation:{recent:async()=>[],recentThread:async()=>[]}});
    assert.throws(()=>context.observe(event),/simulated write failure/);
    assert.deepEqual(store.get('pipeline.attachment.owner',ownerKey),previousOwner);
    assert.deepEqual(store.get('pipeline.attachment.id',idKey),previousId);
    assert.deepEqual(store.get('unrelated','keep'),{value:'untouched'});
    assert.equal(store.size,3);
});

test('capacity fallback preserves a known quoted source and never substitutes an unknown quote with current media',async()=>{
    const clock=new FakeClock(1000);
    const knownStore=new TtlStore({clock,maxEntries:1});
    const knownEvent=normalize(raw('quoted-current','analyze',{media:true,private:true,quote:{id:'quoted-source',sender:BOT}}),{clock,botJid:BOT});
    const quoted={id:'quoted-source',ownerJid:BOT,chatId:knownEvent.chatId,expiresAt:2000,ref:'quoted-ref',mime:'image/png',kind:'image'};
    knownStore.set('pipeline.attachment.id',contextKey(knownEvent.chatId,'quoted-source'),quoted,1000);
    const knownContext=createContext({clock,store:knownStore,conversation:{recent:async()=>[],recentThread:async()=>[]}});
    assert.equal(knownContext.observe(knownEvent),false,'one free cache slot cannot hold both current references');
    const knownCtx=await knownContext.build(knownEvent,{respond:true,reason:'private-chat'},{allowCurrentMediaFallback:true});
    assert.equal(knownCtx.attachment.ref,'quoted-ref','a valid quote keeps its original source precedence');

    const unknownStore=new TtlStore({clock,maxEntries:1});unknownStore.set('unrelated','full',{safe:true},1000);
    const unknownEvent=normalize(raw('quoted-unknown','analyze',{media:true,private:true,quote:{id:'missing-source',sender:BOT}}),{clock,botJid:BOT});
    const unknownContext=createContext({clock,store:unknownStore,conversation:{recent:async()=>[],recentThread:async()=>[]}});
    assert.equal(unknownContext.observe(unknownEvent),false);
    const unknownCtx=await unknownContext.build(unknownEvent,{respond:true,reason:'private-chat'},{allowCurrentMediaFallback:true});
    assert.equal(unknownCtx.attachment,undefined,'an unknown quote never falls back to current or recent media');
});

test('bare media with no matching continuation follows existing non-command behavior',async()=>{
    let attempts=0;
    const feature={id:'documents',attachmentContinuation:()=>undefined,commands:[{name:'append',scope:['private','group'],access:'public',tier:'none',help:{short:'Append',examples:[]},handler:async()=>{attempts++;return{parts:[]};}}]};
    const f=fixture({features:[feature]});
    try {
        const result=await f.handle(raw('bare-image-2','',{media:true}));
        assert.equal(result.kind,'ignore');
        assert.equal(attempts,0);
        assert.equal(f.requests.length,0);
        assert.equal(f.sent.length,0);
    } finally { f.dispose(); }
});

test('cache saturation never substitutes an older owner attachment for an explicit current upload',async()=>{
    const clock=new FakeClock(1000),store=new TtlStore({clock,maxEntries:1});
    const event=normalize(raw('new-upload','analyze',{media:true,private:true}).data,{clock,botJid:BOT});
    const previous={id:'older-upload',ownerJid:event.sender.jid,chatId:event.chatId,expiresAt:2000,ref:'older-ref',mime:'image/png',kind:'image'};
    store.set('pipeline.attachment.owner',contextKey(event.chatId,event.sender.jid),previous,1000);
    const context=createContext({clock,store,conversation:{recent:async()=>[]}});
    assert.equal(context.observe(event),false);
    const ctx=await context.build(event,{respond:true,reason:'private-chat'},{allowCurrentMediaFallback:true});
    assert.equal(ctx.attachment.id,event.id);assert.equal(ctx.attachment.ref,event.media.ref);
    assert.equal(ctx.attachment.providerKey.id,event.id);
    assert.equal(store.get('pipeline.attachment.owner',contextKey(event.chatId,event.sender.jid)),previous);
    assert.equal(store.get('pipeline.attachment.id',contextKey(event.chatId,event.id)),undefined);
});
