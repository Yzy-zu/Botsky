'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {FakeClock}=require('../../../src/v2/platform/clock');
const {TtlStore}=require('../../../src/v2/platform/ttlStore');
const {createRateLimiter}=require('../../../src/v2/platform/rateLimiter');
const event=(id,chatId='199955500000@g.us',jid='19995550001@s.whatsapp.net')=>({id,chatId,sender:{jid}});
function setup(options={}){const clock=new FakeClock();const store=new TtlStore({clock});return {clock,store,limiter:createRateLimiter({clock,store,...options})};}

test('limiter imports/factory/snapshot do not write or create timers; default accepts60 and rejects61',()=>{
    const {clock,store,limiter}=setup();let writes=0;const original=store.set.bind(store);store.set=(...args)=>{writes++;return original(...args);};
    assert.deepEqual(limiter.snapshot(event('one')),{limited:false,cooldownUntil:0});assert.equal(writes,0);assert.equal(store.size,0);assert.equal(clock.pendingTimers,0);
    for(let n=0;n<60;n++)assert.equal(limiter.observe(event(String(n))).limited,false);
    assert.deepEqual(limiter.snapshot(event('61')),{limited:true,blockedUntil:60000,cooldownUntil:0});assert.equal(writes,60);
    for(let n=60;n<1000;n++)assert.equal(limiter.observe(event(String(n))).limited,true);
    assert.equal(writes,60);assert.equal(store.size,1);
    assert.equal(limiter.snapshot(event('59')).limited,false);assert.equal(limiter.observe(event('59')).limited,false);assert.equal(writes,60);
    const entries=Object.values(store.entries);assert.equal(entries[0].value.events.length,60);
});

test('rolling window retains timestamps, expires at exact boundary and snapshot never extends TTL',async()=>{
    const {clock,store,limiter}=setup({windowMs:100,maxEvents:2,cooldownMs:10});
    limiter.observe(event('a'));await clock.advance(50);limiter.observe(event('b'));
    assert.deepEqual(limiter.snapshot(event('c')),{limited:true,blockedUntil:100,cooldownUntil:0});
    await clock.advance(49);assert.equal(limiter.observe(event('c')).limited,true);
    await clock.advance(1);assert.equal(limiter.snapshot(event('c')).limited,false);
    assert.equal(limiter.observe(event('c')).limited,false);
    assert.equal(limiter.snapshot(event('d')).blockedUntil,150);
    await clock.advance(100);assert.deepEqual(limiter.snapshot(event('d')),{limited:false,cooldownUntil:0});assert.equal(store.size,0);
    limiter.observe(event('reused'));limiter.dispose();assert.equal(store.size,0);
});

test('idempotent composite chat/sender/ID keys isolate owners and delimiters safely',()=>{
    const {limiter,store}=setup({maxEvents:1});
    limiter.observe(event('id','a:b','c'));limiter.observe(event('id','a','b:c'));
    assert.equal(store.size,2);assert.equal(limiter.snapshot(event('next','a:b','c')).limited,true);
    assert.equal(limiter.snapshot(event('next','a','c')).limited,false);
    assert.equal(limiter.snapshot(event('next','a:b','other')).limited,false);
    assert.equal(limiter.snapshot(event('id','a:b','c')).limited,false);
    limiter.observe(event('id','__proto__','constructor'));assert.equal(store.size,3);
});

test('three incoming messages remain eligible for one coalesced execution; cooldown begins only after reply',async()=>{
    const {clock,limiter}=setup();
    for(const id of ['a','b','c'])assert.deepEqual(limiter.observe(event(id)),{limited:false,cooldownUntil:0});
    assert.equal(limiter.snapshot(event('d')).cooldownUntil,0);
    assert.deepEqual(limiter.markReply(event('c')),{limited:false,cooldownUntil:3000});
    assert.equal(limiter.snapshot(event('new')).cooldownUntil,3000);
    assert.equal(limiter.snapshot(event('other','chat','other')).cooldownUntil,0);
    await clock.advance(2999);assert.equal(limiter.snapshot(event('new')).cooldownUntil,3000);
    await clock.advance(1);assert.equal(limiter.snapshot(event('new')).cooldownUntil,0);
});

test('cooldown can outlive rolling window; zero cooldown stores nothing when there are no admissions',async()=>{
    const {clock,store,limiter}=setup({windowMs:10,maxEvents:1,cooldownMs:100});
    limiter.observe(event('a'));limiter.markReply(event('a'));await clock.advance(10);
    assert.deepEqual(limiter.snapshot(event('b')),{limited:false,cooldownUntil:100});assert.equal(store.size,1);
    await clock.advance(90);assert.deepEqual(limiter.snapshot(event('b')),{limited:false,cooldownUntil:0});assert.equal(store.size,0);
    const zero=setup({cooldownMs:0});assert.deepEqual(zero.limiter.markReply(event('a')),{limited:false,cooldownUntil:0});assert.equal(zero.store.size,0);
    zero.limiter.observe(event('a'));zero.limiter.markReply(event('a'));assert.equal(zero.store.size,1);
});

test('dispose removes own writes only, preserves unrelated entries and is reusable',async()=>{
    const {clock,store,limiter}=setup({windowMs:10});
    store.set('session','owned-by-other',{a:1},100);limiter.observe(event('a'));assert.equal(store.size,2);
    await clock.advance(10);limiter.observe(event('b','other'));assert.equal(store.size,2);
    limiter.dispose();assert.equal(store.size,1);assert.deepEqual(store.get('session','owned-by-other'),{a:1});
    limiter.dispose();limiter.observe(event('new'));assert.equal(store.size,2);limiter.dispose();assert.equal(store.size,1);
    const shared=createRateLimiter({clock,store});limiter.observe(event('mine'));shared.markReply(event('mine'));
    limiter.dispose();assert.equal(store.size,2);shared.dispose();assert.equal(store.size,1);
});

test('validation and TTL capacity fail before returning an invented admission',()=>{
    const {clock,store,limiter}=setup();
    for(const options of [{windowMs:0},{windowMs:1.5},{maxEvents:0},{maxEvents:Infinity},{cooldownMs:-1},{cooldownMs:NaN}])assert.throws(()=>createRateLimiter({clock,store,...options}),/Invalid rate limiter options/);
    for(const invalid of [null,{},event(''),event('id',''),event('id','chat',''),event('x'.repeat(513)),event('id','x'.repeat(513)),event('id','chat','x'.repeat(513))])assert.throws(()=>limiter.snapshot(invalid),/Invalid rate event/);
    const bad=createRateLimiter({clock:{now:()=>NaN},store});assert.throws(()=>bad.observe(event('id')),/Invalid rate clock/);
    const overflow=createRateLimiter({clock:{now:()=>Number.MAX_SAFE_INTEGER},store});assert.throws(()=>overflow.markReply(event('id')),/Invalid rate clock/);
    const tiny=new TtlStore({clock,maxEntries:1});tiny.set('session','keep',1,1000);const full=createRateLimiter({clock,store:tiny});assert.throws(()=>full.observe(event('id')),/capacity/);assert.equal(tiny.size,1);assert.equal(full.snapshot(event('id')).limited,false);
});
