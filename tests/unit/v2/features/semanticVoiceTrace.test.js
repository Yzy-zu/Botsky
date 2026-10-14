'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {fixture,raw,USER}=require('../../../helpers/pipeline');
const {createWaveAFeatures}=require('../../../../src/v2/features');
const {createVoiceFeature,parseExplicit}=require('../../../../src/v2/features/voice/manifest');
const {createVoiceMedia}=require('../../../../src/v2/adapters/media/voice');

const reply=text=>({ok:true,data:{text,parts:[],toolCalls:[],provider:'gemini'}});
const result=(args)=>JSON.stringify({kind:'intent',intent:'voice.create',args});
const draft=(text,extra={})=>JSON.stringify({mode:'compose',text,voice:'hombre',durationSeconds:null,...extra});
async function media(t,callLLM){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'semantic-voice-'));
    t.after(()=>fs.rm(root,{recursive:true,force:true}));
    return createVoiceMedia({tempDirectory:path.join(root,'botsky-v2-media'),callLLM});
}
function voiceFeature(ports){return createWaveAFeatures({voice:ports});}

test('TR-0684: structured natural voice args win over contradictory duration, voice, and destination words',async()=>{
    const observed=[];const args={mode:'verbatim',literalText:'Di exactamente: ya voy.',voice:'goku',durationSeconds:25,destinationScope:'current_chat'};
    const h=fixture({features:voiceFeature({prepareScript:async input=>{observed.push(input);return{success:true,mode:'verbatim',text:input.literalText,voice:input.voice,durationSeconds:input.durationSeconds};},
        synthesize:async()=>({ref:'audio',mime:'audio/ogg',durationSeconds:25}),fitDuration:async value=>value}),
        generate:async request=>{assert.equal(request.task,'route');return reply(result(args));}});
    const pipelineResult=await h.handle(raw('voice-684','Quiero una voz mujer, mándalo al grupo y que dure 2 minutos; di exactamente: ya voy.',{private:true}));
    assert.equal(pipelineResult.kind,'reply');assert.equal(observed.length,1);
    assert.equal(observed[0].voice,'goku');assert.equal(observed[0].durationSeconds,25);
    assert.equal(observed[0].literalText,'Di exactamente: ya voy.');
    h.dispose();
});

test('TR-0685: natural literal plan preserves profanity and does not mine voice or recipient from raw words',async()=>{
    const observed=[];const literal='Qué pinche pedo, cabrón.';
    const h=fixture({features:voiceFeature({prepareScript:async input=>{observed.push(input);return{success:true,mode:'verbatim',text:input.literalText,voice:input.voice};},
        synthesize:async()=>({ref:'audio',mime:'audio/ogg'}),fitDuration:async value=>value}),
        generate:async()=>reply(result({mode:'verbatim',literalText:literal,voice:'hombre'}))});
    const out=await h.handle(raw('voice-685','haz una nota de voz realista para Juan, voz goku, diciendo exactamente '+literal,{private:true}));
    assert.equal(out.kind,'reply');assert.equal(observed[0].literalText,literal);
    assert.equal(observed[0].voice,'hombre');assert.equal(observed[0].request,'');
    h.dispose();
});

test('TR-0686: unstructured natural request beginning with “voz,” uses semantic routing',async()=>{
    let routeCalls=0;const observed=[];
    const h=fixture({features:voiceFeature({prepareScript:async input=>{observed.push(input);return{success:true,text:'La fecha es mañana.'};},
        synthesize:async()=>({ref:'audio',mime:'audio/ogg'}),fitDuration:async value=>value}),
        generate:async request=>{routeCalls++;assert.equal(request.task,'route');return reply(result({mode:'compose',instruction:'explica lo de mañana'}));}});
    const out=await h.handle(raw('voice-686','voz, por favor explica lo de mañana en una nota de audio',{private:true}));
    assert.equal(out.kind,'reply');assert.equal(routeCalls,1);assert.equal(observed[0].request,'explica lo de mañana');
    h.dispose();
});

test('TR-0687: explicit terminal grammar bypasses natural classification and reads literal text',async()=>{
    const observed=[];let llmCalls=0;
    const h=fixture({features:voiceFeature({prepareScript:async input=>{observed.push(input);return{success:true,mode:'verbatim',text:input.literalText,voice:input.voice};},
        synthesize:async()=>({ref:'audio',mime:'audio/ogg'}),fitDuration:async value=>value}),
        generate:async()=>{llmCalls++;return reply('{}');}});
    const out=await h.handle(raw('voice-687','!voz --voice goku hola, ya voy',{private:true}));
    assert.equal(out.kind,'reply');assert.equal(llmCalls,0);assert.equal(observed[0].literalText,'hola, ya voy');
    assert.equal(observed[0].voice,'goku');
    h.dispose();
});

test('TR-0687 ambiguity: bare “voz goku explica” is currently parsed as terminal literal grammar',async()=>{
    const command=createVoiceFeature({prepareScript:async()=>({success:true,text:'x'}),synthesize:async()=>({ref:'x',mime:'audio/ogg'}),fitDuration:async m=>m}).commands[0];
    assert.deepEqual(command.parseExplicit(['goku','explica','la','cita']),{mode:'verbatim',voice:'goku',literalText:'explica la cita'});
    // Natural classification for this exact bare form remains unresolved; do not
    // count this assertion as proof of legacy semantic routing parity.
});

test('TR-0688: unsupported forward mode or unreadable source media cannot create new audio',async t=>{
    let syntheses=0;const adapter=await media(t,async()=>draft('Forwarded message',{mode:'forward'}));
    const command=createVoiceFeature({prepareScript:(input,signal)=>adapter.prepareScript(input,signal),
        synthesize:async()=>{syntheses++;return{ref:'audio',mime:'audio/ogg'};},fitDuration:async value=>value}).commands[0];
    const out=await command.handler({event:{id:'e',chatId:USER,isGroup:false,sender:{jid:USER},quoted:{text:'quoted'},text:'voz',kind:'text'},history:[]},
        {mode:'compose',instruction:'forward this'},new AbortController().signal);
    assert.equal(out.parts[0].type,'text');assert.equal(syntheses,0);
    const mediaForward=await command.handler({event:{id:'m',chatId:USER,isGroup:false,sender:{jid:USER},text:'reenviar audio',kind:'audio'},history:[],
        attachment:{id:'audio',chatId:USER,ownerJid:USER,kind:'audio',mime:'audio/ogg',ref:'opaque'}},
        {mode:'compose',instruction:'reenvía este audio'},new AbortController().signal);
    assert.equal(mediaForward.parts[0].type,'text');assert.equal(syntheses,0);
    // The legacy forwarding operation itself is not implemented in v2; this
    // asserts fail-closed/no accidental regeneration, not completed forwarding parity.
});

test('TR-0689: literal script is preserved verbatim without an LLM or duration regex inference',async t=>{
    let calls=0;const adapter=await media(t,async()=>{calls++;return draft('unused');});
    const out=await adapter.prepareScript({mode:'verbatim',literalText:'En 20 segundos digo: qué pinche día.',request:'voz goku'},new AbortController().signal);
    assert.equal(out.success,true);assert.equal(out.text,'En 20 segundos digo: qué pinche día.');
    assert.equal(out.durationSeconds,null);assert.equal(calls,0);
});

test('TR-0690: semantic writer may infer duration without duration-keyword regexes',async t=>{
    let sent;const adapter=await media(t,async input=>{sent=input;return draft('Te explico el cambio.',{durationSeconds:47});});
    const out=await adapter.prepareScript({mode:'compose',request:'hazlo más dinámico'},new AbortController().signal);
    assert.equal(out.success,true);assert.equal(out.durationSeconds,47);
    assert.doesNotMatch(sent.user,/duration|segundos|minutos/i);
});

test('TR-0691: explicit requested duration wins over duration inferred from the writer response',async t=>{
    const adapter=await media(t,async()=>draft('Resumen breve.',{durationSeconds:47}));
    const out=await adapter.prepareScript({mode:'compose',request:'Resume el cambio',durationSeconds:20},new AbortController().signal);
    assert.equal(out.success,true);assert.equal(out.durationSeconds,20);
});

test('TR-0692: missing literal words clarify and malformed writer mode produces no audio',async t=>{
    const adapter=await media(t,async()=>draft('Texto inválido',{mode:'forward'}));
    const empty=await adapter.prepareScript({mode:'verbatim'},new AbortController().signal);
    assert.equal(empty.needsClarification,true);assert.equal(empty.text,undefined);
    let syntheses=0;
    const command=createVoiceFeature({prepareScript:(input,signal)=>adapter.prepareScript(input,signal),
        synthesize:async()=>{syntheses++;return{ref:'audio',mime:'audio/ogg'};},fitDuration:async value=>value}).commands[0];
    const malformed=await command.handler({event:{id:'e',chatId:USER,isGroup:false,sender:{jid:USER},text:'voz',kind:'text'},history:[]},
        {mode:'compose',instruction:'Resume'},new AbortController().signal);
    assert.equal(malformed.parts[0].type,'text');assert.equal(syntheses,0);
});
