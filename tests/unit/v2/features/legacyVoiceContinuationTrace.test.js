'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createVoiceFeature, parseExplicit } = require('../../../../src/v2/features/voice/manifest');
const { createVoiceMedia } = require('../../../../src/v2/adapters/media/voice');

const signal = () => new AbortController().signal;
const context = (extra = {}) => ({
    event: { id:'voice-request', chatId:'15555550123@s.whatsapp.net', isGroup:false,
        sender:{jid:'15555550123@s.whatsapp.net',name:'Ana'}, text:'voz', kind:'text',
        ...Object.fromEntries(Object.entries(extra).filter(([key])=>key!=='attachment')) },
    history:[{role:'assistant',content:'El martes no hay clase.'}],
    ...(extra.attachment?{attachment:extra.attachment}:{}),
});
const script = (text, extra = {}) => ({success:true,mode:'compose',text,voice:'hombre',durationSeconds:null,...extra});

function feature(ports = {}) {
    return createVoiceFeature({
        prepareScript:async input => script(input.revision ? 'Borrador revisado con contexto.' : 'Borrador contextual.'),
        synthesize:async (_text, {voice}) => ({ref:'audio-'+voice,mime:'audio/ogg',durationSeconds:10}),
        fitDuration:async media => media,
        ...ports,
    }).commands[0];
}

test('TR-0753: duration revision keeps original request, quote, history and computed word target', async () => {
    const inputs=[]; let count=0;
    const command=feature({prepareScript:async input=>{inputs.push(input);return script(++count===1?'Primer guion.':'Guion revisado con los datos.')},
        synthesize:async ()=>({ref:'first',mime:'audio/ogg',durationSeconds:12}),fitDuration:async media=>media,release:async()=>{}});
    await command.handler(context({quoted:{text:'No hay clase el martes.'}}),{instruction:'Explica el aviso',durationSeconds:30},signal());
    assert.equal(inputs.length,2);
    assert.equal(inputs[1].request,'Explica el aviso');
    assert.equal(inputs[1].quotedText,'No hay clase el martes.');
    assert.equal(inputs[1].history[0].content,'El martes no hay clase.');
    assert.equal(inputs[1].revision.measuredSeconds,12);
    assert.equal(inputs[1].revision.wordTarget,5);
});

test('TR-0754: reply audio contains only the composed draft and preserves quote/history for composition', async () => {
    let input;
    const command=feature({prepareScript:async value=>{input=value;return script('La clase será el miércoles.')},
        synthesize:async text=>({ref:'audio:'+text,mime:'audio/ogg'})});
    const reply=await command.handler(context({quoted:{text:'Cambió al miércoles.'}}),{instruction:'Explícalo brevemente'},signal());
    assert.equal(input.quotedText,'Cambió al miércoles.');
    assert.equal(input.history[0].content,'El martes no hay clase.');
    assert.deepEqual(reply.parts,[{type:'audio',ref:'audio:La clase será el miércoles.',mime:'audio/ogg',transcript:'La clase será el miércoles.'}]);
});

test('TR-0755: duration mismatch composes and synthesizes at most one revision', async () => {
    const inputs=[],texts=[],released=[];
    const command=feature({prepareScript:async input=>{inputs.push(input);return script(inputs.length===1?'Corto.':'Versión ampliada para aproximar la duración indicada.')},
        synthesize:async text=>{texts.push(text);return{ref:'audio-'+texts.length,mime:'audio/ogg',durationSeconds:texts.length===1?12:30};},
        fitDuration:async media=>media,release:async ref=>released.push(ref)});
    const reply=await command.handler(context(),{instruction:'Resume el anuncio',durationSeconds:30},signal());
    assert.equal(inputs.length,2);assert.deepEqual(texts,['Corto.','Versión ampliada para aproximar la duración indicada.']);
    assert.deepEqual(released,['audio-1']);
    assert.equal(reply.parts[0].transcript,'Versión ampliada para aproximar la duración indicada.');
});

test('TR-0756: verbatim audio is never lengthened or rewritten to fit the requested duration', async () => {
    let prepared=0;const texts=[];
    const command=feature({prepareScript:async input=>{prepared++;return{success:true,mode:'verbatim',text:input.literalText,voice:'goku',durationSeconds:30};},
        synthesize:async text=>{texts.push(text);return{ref:'literal',mime:'audio/ogg',durationSeconds:3};},fitDuration:async media=>media});
    const reply=await command.handler(context(),{mode:'verbatim',literalText:'Exactamente estas palabras.',durationSeconds:30},signal());
    assert.equal(prepared,1);assert.deepEqual(texts,['Exactamente estas palabras.']);
    assert.equal(reply.parts[0].transcript,'Exactamente estas palabras.');
    assert.deepEqual(reply.parts[1],{type:'text',text:'La nota quedó en 3.0 s; buscábamos 30 s.'});
});

test('TR-0757: if a duration revision is worse, the closer original recording is retained and revision released', async () => {
    let generated=0,prepared=0;const released=[];
    const command=feature({prepareScript:async()=>script(++prepared===1?'Original':'Revisado'),
        synthesize:async()=>({ref:'audio-'+(++generated),mime:'audio/ogg',durationSeconds:generated===1?20:60}),
        fitDuration:async media=>media,release:async ref=>released.push(ref)});
    const reply=await command.handler(context(),{instruction:'Resume',durationSeconds:30},signal());
    assert.equal(prepared,2);assert.equal(generated,2);
    assert.equal(reply.parts[0].ref,'audio-1');assert.equal(reply.parts[0].transcript,'Original');
    assert.deepEqual(released,['audio-2']);assert.match(reply.parts[1].text,/20\.0 s/);
});

test('TR-0758: clarification and script errors produce no synthesis or success-shaped reply', async () => {
    let syntheses=0;
    const clarifies=feature({prepareScript:async()=>({success:false,needsClarification:true,question:'¿Qué aviso debo explicar?'})});
    const clarification=await clarifies.handler(context(),{instruction:'haz un audio'},signal());
    assert.equal(clarification.parts[0].text,'¿Qué aviso debo explicar?');
    const broken=feature({prepareScript:async()=>({success:false,error:'provider rejected'}),synthesize:async()=>{syntheses++;return{ref:'x',mime:'audio/ogg'};}});
    const failure=await broken.handler(context(),{instruction:'resume'},signal());
    assert.equal(failure.parts[0].type,'text');assert.equal(syntheses,0);
    assert.equal(clarification.parts.some(part=>part.type==='audio'),false);
});

test('TR-0759: synthesis or duration-fit failure releases generated audio and returns failure text', async () => {
    for(const phase of ['synthesize','fit']){
        const released=[];
        const command=feature({synthesize:async()=>{if(phase==='synthesize')throw Error('provider detail');return{ref:'owned-audio',mime:'audio/ogg'};},
            fitDuration:async()=>{throw Error('ffmpeg detail');},release:async ref=>released.push(ref)});
        const reply=await command.handler(context(),{instruction:'Resume',durationSeconds:20},signal());
        assert.equal(reply.parts[0].type,'text');assert.match(reply.parts[0].text,/No pude preparar o enviar el audio/);
        assert.deepEqual(released,phase==='fit'?['owned-audio']:[]);
        assert.doesNotMatch(reply.parts[0].text,/provider detail|ffmpeg detail/);
    }
});

test('TR-0760: direct voice command reads literal words with the chosen voice', async () => {
    assert.deepEqual(parseExplicit(['goku','Qué','onda,','cabrón']),{mode:'verbatim',voice:'goku',literalText:'Qué onda, cabrón'});
    const seen=[];const command=feature({prepareScript:async input=>{seen.push(input);return{success:true,mode:'verbatim',text:input.literalText,voice:input.voice};}});
    await command.handler(context(),parseExplicit(['goku','Qué','onda,','cabrón']),signal());
    assert.equal(seen[0].mode,'verbatim');assert.equal(seen[0].literalText,'Qué onda, cabrón');assert.equal(seen[0].voice,'goku');
});

test('TR-0761: quoted exact phrase excludes voice and duration controls from spoken text', async () => {
    let prepared;
    const command=feature({prepareScript:async input=>{prepared=input;return{success:true,mode:'verbatim',text:input.literalText,voice:input.voice,durationSeconds:30};}});
    const reply=await command.handler(context({quoted:{text:'Qué pinche pedo, cabrón.'}}),{mode:'verbatim',voice:'goku',durationSeconds:30},signal());
    assert.equal(prepared.literalText,'Qué pinche pedo, cabrón.');
    assert.equal(prepared.voice,'goku');assert.equal(prepared.durationSeconds,30);
    assert.equal(reply.parts[0].transcript,'Qué pinche pedo, cabrón.');
});

test('TR-0762: image attachment is read as voice context and never routed to video conversion', async () => {
    const calls=[];
    const command=feature({readScriptContext:async attachment=>{calls.push(['read',attachment.mime]);return{extractedText:'El aviso dice que no hay clase.'};},
        prepareScript:async input=>{calls.push(['script',input.mediaContext]);return script('No habrá clase.');},
        synthesize:async text=>{calls.push(['synthesize',text]);return{ref:'voice',mime:'audio/ogg'};}});
    const reply=await command.handler(context({attachment:{id:'img',mime:'image/png',kind:'image',ref:'opaque'}}),{instruction:'explica la imagen'},signal());
    assert.deepEqual(calls,[['read','image/png'],['script',{extractedText:'El aviso dice que no hay clase.'}],['synthesize','No habrá clase.']]);
    assert.equal(reply.parts[0].type,'audio');
});

test('TR-0763: voice feature contract carries real request and conversation context into the script port', async () => {
    let observed;
    const command=feature({prepareScript:async input=>{observed=input;return script('Resultado contextual.');}});
    await command.handler(context({quoted:{text:'Cita real'}}),{instruction:'manda audio sobre eso'},signal());
    assert.equal(observed.request,'manda audio sobre eso');
    assert.equal(observed.quotedText,'Cita real');
    assert.deepEqual(observed.history,[{role:'assistant',content:'El martes no hay clase.'}]);
    // v2 has a voice feature/LLM port but no separately callable legacy voice tool.
    const {createWaveAFeatures}=require('../../../../src/v2/features/index');
    assert.equal(createWaveAFeatures({voice:{prepareScript:async()=>script('tool'),synthesize:async()=>({ref:'x',mime:'audio/ogg'}),fitDuration:async media=>media}})
        .some(item=>item.id==='voice'),true);
});

test('TR-0764: duration fitting uses bounded tempo adjustment and preserves the full recording', async t => {
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'voice-0764-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const calls=[];let probes=0;
    const media=createVoiceMedia({tempDirectory:path.join(root,'botsky-v2-media'),run:async(command,args)=>{
        calls.push({command,args});
        if(command==='ffprobe')return{stdout:String(++probes<=2?33:30.02)};
        await fs.writeFile(args.at(-1),Buffer.from('synthetic full audio'));return{stdout:''};
    }});
    const source=await media.synthesize('Aviso completo',{voice:'hombre',signal:signal()});
    const fitted=await media.fitDuration(source,30,signal());
    const filter=calls.find(call=>call.command==='ffmpeg').args.find(value=>typeof value==='string'&&value.startsWith('atempo='));
    assert.equal(filter,'atempo=1.100000');assert.equal(fitted.durationSeconds,30.02);
    assert.equal(calls.some(call=>call.args.includes('-t')||call.args.includes('apad')),false);
    await media.release(fitted.ref);
});

test('TR-0765: duration fitting refuses excessive speed changes and returns the measured original', async t => {
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'voice-0765-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const calls=[];
    const media=createVoiceMedia({tempDirectory:path.join(root,'botsky-v2-media'),run:async(command,args)=>{
        calls.push(command);if(command==='ffprobe')return{stdout:'60'};await fs.writeFile(args.at(-1),Buffer.from('synthetic'));return{};
    }});
    const source=await media.synthesize('Aviso',{voice:'hombre',signal:signal()});
    const result=await media.fitDuration(source,30,signal());
    assert.equal(result.ref,source.ref);assert.equal(result.durationSeconds,60);
    assert.deepEqual(calls,['edge-tts','ffprobe','ffprobe']);
    await media.release(source.ref);
});

test('TR-0766: installed ffmpeg and ffprobe adjust a synthetic tone and release all owned files', async t => {
    const ffmpeg=spawnSync('ffmpeg',['-version'],{stdio:'ignore'}),ffprobe=spawnSync('ffprobe',['-version'],{stdio:'ignore'});
    if(ffmpeg.status!==0||ffprobe.status!==0){t.skip('ffmpeg/ffprobe are not installed in this test environment');return;}
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'voice-0766-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const tempDirectory=path.join(root,'botsky-v2-media');
    const media=createVoiceMedia({tempDirectory,edgeTtsCommand:'ffmpeg',run:async(command,args,options)=>{
        if(command==='ffmpeg'&&args.includes('--text=Tone test')){
            const output=args.at(-1);const result=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=6','-y',output],{signal:options.signal,encoding:'utf8'});
            if(result.status!==0)throw Object.assign(new Error('synthetic ffmpeg failed'),{code:'EIO'});return{stdout:''};
        }
        const result=spawnSync(command,args,{signal:options.signal,encoding:'utf8'});
        if(result.status!==0)throw Object.assign(new Error(result.stderr||'tool failed'),{code:'EIO'});
        return{stdout:result.stdout,stderr:result.stderr};
    }});
    const original=await media.synthesize('Tone test',{voice:'hombre',signal:signal()});
    const fitted=await media.fitDuration(original,5.3,signal());
    assert.ok(Math.abs(fitted.durationSeconds-5.3)<0.25);
    await media.release(fitted.ref);
    assert.deepEqual(await fs.readdir(tempDirectory),[]);
});
