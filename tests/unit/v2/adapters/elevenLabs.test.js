'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeClock } = require('../../../../src/v2/platform/clock');
const { AppError } = require('../../../../src/v2/domain/errors');
const { createElevenLabsMedia, PRESET_VOICES, DEFAULT_MODEL } = require('../../../../src/v2/adapters/media/elevenLabs');

function fixture(options={}) {
    const clock=new FakeClock(1000), calls={get:[],post:[]};
    const http={
        get:async(url,request)=>{calls.get.push({url,request});return options.get?options.get(url,request):{status:200,data:{voices:[]}};},
        post:async(url,data,request)=>{calls.post.push({url,data,request});return options.post?options.post(url,data,request):{status:200,data:Buffer.from('synthetic mp3')};}
    };
    const media=createElevenLabsMedia({http,config:{elevenLabsApiKey:options.apiKey??'synthetic-key'},clock,
        audioTimeoutMs:options.audioTimeoutMs??100,voicesTimeoutMs:options.voicesTimeoutMs??50,
        maxAudioBytes:options.maxAudioBytes??64,voicesCacheTtlMs:options.voicesCacheTtlMs??100});
    return {media,calls,clock};
}
const signal=()=>new AbortController().signal;

test('resolves user VoiceLab names before preserved presets and caches bounded voice lists', async()=>{
    const f=fixture({get:async()=>({status:200,data:{voices:[{name:'Ada Lovelace',voice_id:'UserVoice01'},null,{name:'bad',voice_id:'unsafe/id'}]}})});
    assert.equal(await f.media.resolveVoiceId('ada',signal()),'UserVoice01');
    assert.equal(await f.media.resolveVoiceId('alice',signal()),PRESET_VOICES.alice);
    assert.equal(await f.media.resolveVoiceId('daniel',signal()),PRESET_VOICES.daniel);
    assert.equal(await f.media.resolveVoiceId('unknown',signal()),PRESET_VOICES.daniel);
    assert.equal(await f.media.resolveVoiceId(undefined,signal()),PRESET_VOICES.daniel);
    assert.equal(f.calls.get.length,1);
    assert.equal(f.calls.get[0].url,'https://api.elevenlabs.io/v1/voices');
    assert.equal(f.calls.get[0].request.headers['xi-api-key'],'synthetic-key');
    f.clock.time+=101;
    await f.media.resolveVoiceId('ada',signal());
    assert.equal(f.calls.get.length,2);
});

test('posts legacy synthesis payload and returns a bounded in-memory MP3 result', async()=>{
    const f=fixture({get:async()=>({status:200,data:{voices:[]}})});
    const result=await f.media.generateAudio('Hola, mundo','alice',signal());
    assert.deepEqual(result,{buffer:Buffer.from('synthetic mp3'),extension:'mp3',mime:'audio/mpeg',provider:'elevenlabs'});
    assert.equal(f.calls.post.length,1);
    const call=f.calls.post[0];
    assert.equal(call.url,`https://api.elevenlabs.io/v1/text-to-speech/${PRESET_VOICES.alice}`);
    assert.deepEqual(call.data,{text:'Hola, mundo',model_id:DEFAULT_MODEL,voice_settings:{stability:0.5,similarity_boost:0.75}});
    assert.equal(call.request.headers['xi-api-key'],'synthetic-key');
    assert.equal(call.request.timeout,100);
    assert.equal(call.request.maxContentLength,64);
    assert.equal(call.request.responseType,'arraybuffer');
    assert.equal(call.request.signal.aborted,false);
});

test('direct voice IDs skip VoiceLab listing and malformed or oversized audio is rejected', async()=>{
    const f=fixture({maxAudioBytes:4,post:async()=>({status:200,data:Buffer.from('12345')})});
    await assert.rejects(f.media.generateAudio('text','abcdefghijklmnopqrst',signal()),e=>e instanceof AppError&&e.kind==='too_large');
    assert.equal(f.calls.get.length,0);
    const bad=fixture({post:async()=>({status:200,data:{unexpected:true}})});
    await assert.rejects(bad.media.generateAudio('text','alice',signal()),e=>e instanceof AppError&&e.kind==='bad_output');
});

test('maps provider statuses to safe typed errors without exposing response bodies', async()=>{
    for (const [status,kind] of [[401,'auth_key'],[403,'auth_key'],[429,'quota'],[413,'too_large'],[422,'bad_output'],[503,'network']]) {
        const f=fixture({post:async()=>({status,data:'PRIVATE provider response'})});
        await assert.rejects(f.media.generateAudio('text','daniel',signal()),e=>e instanceof AppError&&e.kind===kind&&!e.message.includes('PRIVATE'));
    }
    const missing=fixture({apiKey:''});
    await assert.rejects(missing.media.generateAudio('text','daniel',signal()),e=>e instanceof AppError&&e.kind==='auth_key');
});

test('preserves caller cancellation and enforces provider timeout through the injected clock', async()=>{
    let requestSignal, started;const start=new Promise(resolve=>{started=resolve;});
    const f=fixture({post:(_url,_data,request)=>{requestSignal=request.signal;started();return new Promise((resolve,reject)=>request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true}));}});
    const controller=new AbortController();
    const pending=f.media.generateAudio('text','daniel',controller.signal);
    await start;
    controller.abort(new Error('caller cancelled'));
    await assert.rejects(pending,/caller cancelled/);
    assert.equal(requestSignal.aborted,true);

    let timeoutStarted;const timeoutStart=new Promise(resolve=>{timeoutStarted=resolve;});
    const timeout=fixture({post:(_url,_data,request)=>{timeoutStarted();return new Promise((resolve,reject)=>request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true}));}});
    const pendingTimeout=timeout.media.generateAudio('text','daniel',signal());
    await timeoutStart;
    await timeout.clock.advance(101);
    await assert.rejects(pendingTimeout,e=>e instanceof AppError&&e.kind==='timeout');
});

test('optional VoiceLab failure falls back to a preset and never logs or leaks credentials', async()=>{
    const f=fixture({get:async()=>{throw Error('secret response body');}});
    assert.equal(await f.media.resolveVoiceId('george',signal()),PRESET_VOICES.george);
    assert.equal(f.calls.get[0].request.headers['xi-api-key'],'synthetic-key');
});
