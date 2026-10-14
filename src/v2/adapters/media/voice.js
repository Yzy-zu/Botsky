// @ts-check
'use strict';

const fsPromises = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { AppError } = require('../../domain/errors');

const execFileAsync = promisify(execFile);
const PREFIX = 'botsky-voice-';
const MAX_TEXT_CHARS = 20_000;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const DEFAULT_TTL_MS = 60 * 60 * 1000;
/** @type {Readonly<Record<string,{voice:string,rate:string,pitch:string,filter?:string|null}>>} */
const EDGE_PROFILES = Object.freeze({
    hombre:{voice:'es-MX-JorgeNeural',rate:'+3%',pitch:'-2Hz'}, mujer:{voice:'es-MX-DaliaNeural',rate:'+3%',pitch:'+0Hz'},
    colombiano:{voice:'es-CO-GonzaloNeural',rate:'+2%',pitch:'+0Hz'}, colombiana:{voice:'es-CO-SalomeNeural',rate:'+2%',pitch:'+0Hz'},
    argentino:{voice:'es-AR-TomasNeural',rate:'+0%',pitch:'-2Hz'}, argentina:{voice:'es-AR-ElenaNeural',rate:'+0%',pitch:'+0Hz'},
    loquendo:{voice:'es-ES-AlvaroNeural',rate:'+0%',pitch:'+0Hz'}, chileno:{voice:'es-CL-LorenzoNeural',rate:'+2%',pitch:'+0Hz'},
    venezolano:{voice:'es-VE-SebastianNeural',rate:'+2%',pitch:'+0Hz'}, peruano:{voice:'es-PE-AlexNeural',rate:'+0%',pitch:'+0Hz'},
    anime:{voice:'es-ES-ElviraNeural',rate:'+10%',pitch:'+16Hz',filter:null},
    ardilla:{voice:'es-MX-DaliaNeural',rate:'+10%',pitch:'+20Hz',filter:'asetrate=24000*1.45,aresample=24000,atempo=1/1.2'},
    demonio:{voice:'es-MX-JorgeNeural',rate:'-5%',pitch:'-20Hz',filter:'asetrate=24000*0.75,aresample=24000,atempo=1/0.85,bass=g=8'},
    robot:{voice:'es-MX-JorgeNeural',rate:'+0%',pitch:'+0Hz',filter:'flanger=delay=3:depth=2:regen=50:width=80:speed=2'},
    radio:{voice:'es-MX-JorgeNeural',rate:'+0%',pitch:'+0Hz',filter:'highpass=f=400,lowpass=f=3000,volume=1.5'},
    dross:{voice:'es-AR-TomasNeural',rate:'-8%',pitch:'-6Hz',filter:'bass=g=6,aecho=0.8:0.88:35:0.25'},
    goku:{voice:'es-MX-JorgeNeural',rate:'+8%',pitch:'+10Hz',filter:'asetrate=24000*1.12,aresample=24000,atempo=1/1.1'},
    donramon:{voice:'es-MX-JorgeNeural',rate:'-4%',pitch:'-4Hz',filter:'equalizer=f=1200:width_type=o:width=1.5:g=4'},
    babidi:{voice:'es-MX-JorgeNeural',rate:'+15%',pitch:'+22Hz',filter:'asetrate=24000*1.2,aresample=24000,atempo=1/1.2,equalizer=f=2500:width_type=o:width=1:g=8'}
});
/** @type {Readonly<Record<string,string>>} */
const VOICE_ALIASES = Object.freeze({
    colombia:'colombiano',paisa:'colombiano',parcero:'colombiano',che:'argentino',boludo:'argentino',chile:'chileno',weon:'chileno',
    venezuela:'venezolano',chamo:'venezolano',peru:'peruano',causa:'peruano',espanol:'loquendo',espana:'loquendo',castellano:'loquendo',
    alvin:'ardilla',monstruo:'demonio',diablo:'demonio',cyborg:'robot',ciborg:'robot',policia:'radio',walkietalkie:'radio',
    drossrotzank:'dross',ramon:'donramon',monchito:'donramon',waifu:'anime',loli:'anime',monachina:'anime',cute:'anime',
    chica:'mujer',morra:'mujer',reels:'mujer',female:'mujer',f:'mujer',m:'mujer'
});
const ELEVEN_TRIGGERS = Object.freeze(['elevenlabs','realista','humana','daniel','narrador','adam','charlie','george','harry','liam','alice','lily','jessica','bill','goku','donramon','dross','luisito']);
const PROFESSIONAL_VOICES = Object.freeze(['daniel','narrador','adam','charlie','george','harry','liam','alice','lily','jessica','bill','elevenlabs','realista','humana','luisito']);

/** @typedef {{text:string,voice:string,mode?:string,durationSeconds?:number|null,success?:boolean,needsClarification?:boolean,question?:string,error?:string}} ScriptResult */
/** @typedef {{request?:string,literalText?:string,mode?:string,voice?:string,durationSeconds?:number|null,history?:ReadonlyArray<{role:string,content:string}>,quotedText?:string,userName?:string,isGroup?:boolean,revision?:{previousText:string,measuredSeconds:number,wordTarget:number}|null}} ScriptInput */
/** @typedef {{run?:(command:string,args:string[],options:{timeoutMs:number,signal:AbortSignal,maxBuffer:number})=>Promise<{stdout?:string|Buffer,stderr?:string|Buffer}>,callLLM?:(input:{system:string,user:string,maxOutputTokens:number,signal:AbortSignal})=>Promise<string|{text?:string,finishReason?:string}>,elevenLabs?:(text:string,voice:string,signal:AbortSignal)=>Promise<Buffer>,tempDirectory:string,files?:typeof fsPromises,clock?:{now:()=>number},randomId?:()=>string,maxTextChars?:number,maxMediaBytes?:number,outputTtlMs?:number,edgeTtsCommand?:string,gttsCommand?:string,ffmpegCommand?:string,ffprobeCommand?:string}} VoiceMediaOptions */

/** @param {typeof execFileAsync} [execute] */
function createExecFileRunner(execute = execFileAsync) {
    /** @param {string} command @param {string[]} args @param {{timeoutMs:number,signal:AbortSignal,maxBuffer:number}} options */
    return (command, args, options) => execute(command, args, { timeout:options.timeoutMs, signal:options.signal, maxBuffer:options.maxBuffer, windowsHide:true });
}

/** @param {string} text */
function cleanTextForSpeech(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/https?:\/\/\S+/gi, '').replace(/[*_~`]/g, '')
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
        .replace(/\s+/g, ' ').trim();
}

/** @param {string} voice */
function resolveVoice(voice) {
    let key = String(voice || '').toLowerCase().trim().replace(/^[-_]+/, '').replace(/[-_\s]/g, '');
    key = VOICE_ALIASES[key] || key;
    if (key === 'argentina') key = 'argentina';
    if (key === 'colombiana') key = 'colombiana';
    if (EDGE_PROFILES[key]) return { key, profile:EDGE_PROFILES[key] };
    if (PROFESSIONAL_VOICES.includes(key)) return { key, profile:EDGE_PROFILES.hombre };
    return { key:'hombre', profile:EDGE_PROFILES.hombre };
}

/** @param {unknown} error @returns {never} */
function throwMapped(error) {
    if (error && typeof error === 'object' && /** @type {{name?:string}} */(error).name === 'AbortError') throw error;
    const name = error && typeof error === 'object' ? /** @type {{name?:string,code?:string}} */(error).name : '';
    const code = error && typeof error === 'object' ? /** @type {{code?:string}} */(error).code : '';
    throw new AppError(name === 'TimeoutError' || code === 'ETIMEDOUT' ? 'timeout' : code === 'ENOENT' ? 'unsupported_media' : 'network', { cause:error });
}

/** @param {VoiceMediaOptions} options */
function createVoiceMedia({ run=createExecFileRunner(), callLLM, elevenLabs, tempDirectory, files=fsPromises,
    clock={now:Date.now}, randomId=()=>randomBytes(12).toString('hex'), maxTextChars=MAX_TEXT_CHARS,
    maxMediaBytes=MAX_MEDIA_BYTES, outputTtlMs=DEFAULT_TTL_MS, edgeTtsCommand='edge-tts', gttsCommand='gtts-cli',
    ffmpegCommand='ffmpeg', ffprobeCommand='ffprobe' }) {
    if (!path.isAbsolute(tempDirectory) || path.resolve(tempDirectory)!==tempDirectory || path.basename(tempDirectory)!=='botsky-v2-media') throw new TypeError('Dedicated botsky-v2-media directory required');
    if (![maxTextChars,maxMediaBytes,outputTtlMs].every(Number.isSafeInteger) || maxTextChars<1 || maxTextChars>MAX_TEXT_CHARS || maxMediaBytes<1 || outputTtlMs<1000) throw new RangeError('Invalid voice resource limits');
    /** @type {Promise<void>|undefined} */ let ready;
    /** @returns {Promise<void>} */
    async function ensureDirectory() {
        if (ready) return ready;
        ready=(async()=>{await files.mkdir(tempDirectory,{recursive:true,mode:0o700}); const s=await files.lstat(tempDirectory);
            if(!s.isDirectory()||s.isSymbolicLink()||await files.realpath(tempDirectory)!==tempDirectory) throw new Error('Unsafe media temp directory'); await files.chmod(tempDirectory,0o700);})();
        return ready;
    }
    /** @param {AbortSignal} signal */ const check=signal=>signal.throwIfAborted();
    /** @param {AbortSignal} signal */
    async function workspace(signal) { check(signal); await ensureDirectory(); check(signal); const id=randomId();
        if(!/^[a-f0-9]{8,64}$/i.test(id)) throw new Error('Invalid media workspace id'); return files.mkdtemp(path.join(tempDirectory,`${PREFIX}${id}-`)); }
    /** @param {string} filename @param {Buffer} data */
    async function writePrivate(filename,data) { if(!data.length||data.length>maxMediaBytes) throw new AppError('too_large'); await files.writeFile(filename,data,{flag:'wx',mode:0o600}); await files.chmod(filename,0o600); }
    /** @param {string} directory */
    async function removeWorkspace(directory) { const resolved=path.resolve(directory); if(path.dirname(resolved)===tempDirectory&&path.basename(resolved).startsWith(PREFIX)) await files.rm(resolved,{recursive:true,force:true}); }
    /** @param {string} command @param {string[]} args @param {number} timeoutMs @param {AbortSignal} signal */
    /** @param {string} command @param {string[]} args @param {number} timeoutMs @param {AbortSignal} signal @returns {Promise<{stdout?:string|Buffer,stderr?:string|Buffer}>} */
    async function execute(command,args,timeoutMs,signal) { check(signal); try { const result=/** @type {{stdout?:string|Buffer,stderr?:string|Buffer}} */ (await run(command,args,{timeoutMs,signal,maxBuffer:4*1024*1024})); check(signal); return result; } catch(error) { throwMapped(error); } }
    /** @param {ScriptInput} input @param {AbortSignal} signal */
    async function prepareScript(input,signal) {
        check(signal);
        const request=String(input.request||'').trim(), literal=String(input.literalText||'').trim(), mode=input.mode||'compose';
        const voice=resolveVoice(input.voice||'hombre').key;
        const duration=input.durationSeconds??null;
        if(duration!==null&&(!Number.isFinite(duration)||duration<=0||duration>600)) return {success:false,needsClarification:true,question:'¿Cuánto debe durar? Puedo preparar notas de voz de hasta 10 minutos.'};
        if(!['compose','verbatim'].includes(mode)) return {success:false,error:'No pude interpretar cómo preparar ese audio.'};
        if(mode==='verbatim') {
            if(!literal) return {success:false,needsClarification:true,question:'¿Qué texto exacto quieres que lea en el audio?'};
            if(literal.length>maxTextChars) return {success:false,error:'Ese texto es demasiado largo para una sola nota de voz.'};
            return {success:true,mode:'verbatim',text:literal,voice,durationSeconds:duration};
        }
        if(typeof callLLM!=='function') return {success:false,error:'La preparación de guiones no está disponible en este momento.'};
        if(!request&&!literal&&!input.quotedText) return {success:false,needsClarification:true,question:'¿Qué quieres que comunique el audio? Puedes decirme el tema, el tono y cuánto debe durar.'};
        const target=duration;
        const targetWords=target?Math.max(3,Math.round(target*2.4)):null;
        const system=`Prepara únicamente el texto que se pronunciará para una nota de voz. Interpreta la petición actual usando la cita y el historial como contexto; nunca leas en voz alta la orden, nombres de voz, duración, títulos, etiquetas, Markdown ni JSON. No inventes hechos. Si falta el tema o el referente, devuelve needs_clarification:true y una pregunta breve. Mantén la voz solicitada (${voice}) y mode:"compose". ${target?`Escribe cerca de ${targetWords} palabras para una duración solicitada de ${target} segundos; sin relleno ni silencios.`:'Usa sólo la extensión necesaria.'} ${input.revision?`Reescribe el borrador conservando sentido y datos; objetivo ${input.revision.wordTarget} palabras.`:''} Devuelve JSON {"mode":"compose","text":"...","voice":"${voice}","durationSeconds":null,"needs_clarification":false,"question":""}.`;
        const user=JSON.stringify({peticion:request,texto_disponible:literal,cita:input.quotedText||'',historial:(input.history||[]).slice(-8),usuario:input.userName||'Compa',grupo:Boolean(input.isGroup),revision:input.revision||null});
        /** @type {string|{text?:string,finishReason?:string}|undefined} */ let generated;
        try { generated=await callLLM({system,user,maxOutputTokens:Math.min(4096,Math.max(800,Math.round((targetWords||350)*2.8))),signal}); check(signal); }
        catch(error) { if(error&&typeof error==='object'&&/** @type {{name?:string}} */(error).name==='AbortError') throw error; return {success:false,error:'No pude preparar el guion ahorita. Intenta de nuevo en un momento.'}; }
        const raw=typeof generated==='string'?generated:generated&&typeof generated==='object'&&generated.finishReason!=='length'?generated.text||'':'';
        /** @type {Record<string,unknown>} */ let result;
        try { result=/** @type {Record<string,unknown>} */ (JSON.parse(String(raw).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))); }
        catch { return {success:false,error:'No pude preparar un guion válido. Intenta de nuevo.'}; }
        if(!result||typeof result!=='object'||Array.isArray(result)) return {success:false,error:'No pude preparar un guion válido. Intenta de nuevo.'};
        if(result.needs_clarification===true) return {success:false,needsClarification:true,question:typeof result.question==='string'&&result.question.trim()?result.question.trim().slice(0,400):'¿Qué quieres que diga el audio?'};
        const text=typeof result.text==='string'?result.text.trim():'';
        if(result.mode!=='compose'&&result.mode!=='verbatim'||!text||text.length>maxTextChars||text===request) return {success:false,error:'No pude separar el mensaje de las instrucciones para el audio. Intenta explicarme qué quieres comunicar.'};
        const inferred=result.durationSeconds==null?null:Number(result.durationSeconds);
        if(target===null&&inferred!==null&&(!Number.isFinite(inferred)||inferred<=0||inferred>600)) return {success:false,needsClarification:true,question:'¿Cuánto debe durar el audio? Indícalo en segundos o minutos, hasta 10 minutos.'};
        return {success:true,mode:'compose',text,voice:resolveVoice(typeof result.voice==='string'?result.voice:voice).key,durationSeconds:target??inferred};
    }
    /** @param {string} ref */
    async function managedPath(ref) {
        if(typeof ref!=='string'||!path.isAbsolute(ref)) throw new TypeError('Voice media reference is invalid');
        const resolved=path.resolve(ref),dir=path.dirname(resolved);
        if(path.dirname(dir)!==tempDirectory||!path.basename(dir).startsWith(PREFIX)) throw new TypeError('Voice media reference is outside its workspace');
        const stat=await files.lstat(resolved);
        if(!stat.isFile()||stat.isSymbolicLink()||await files.realpath(resolved)!==resolved||stat.size<1||stat.size>maxMediaBytes) throw new AppError('unsupported_media');
        return {path:resolved,directory:dir};
    }
    /** @param {string} text @param {{voice:string,signal:AbortSignal}} options */
    async function synthesize(text,{voice,signal}) {
        check(signal); const cleaned=cleanTextForSpeech(text);
        if(!cleaned) throw new AppError('bad_output');
        if(cleaned.length>maxTextChars) throw new AppError('too_large');
        const {key,profile}=resolveVoice(voice); const dir=await workspace(signal); const raw=path.join(dir,'raw.mp3'), filtered=path.join(dir,'voice.mp3');
        let finalPath=raw;
        try {
            let generated=false;
            if(elevenLabs&&(ELEVEN_TRIGGERS.includes(key)||PROFESSIONAL_VOICES.includes(key))) {
                try { const audio=await elevenLabs(cleaned,key,signal); check(signal); await writePrivate(raw,audio); generated=true; }
                catch(error) { if(error&&typeof error==='object'&&/** @type {{name?:string}} */(error).name==='AbortError') throw error; }
            }
            if(!generated) {
                try {
                    await execute(edgeTtsCommand,['--voice',profile.voice,`--rate=${profile.rate}`,`--pitch=${profile.pitch}`,'--text',cleaned,'--write-media',raw],60_000,signal);
                    const stat=await files.stat(raw); if(!stat.isFile()||stat.size<1||stat.size>maxMediaBytes) throw new Error('edge-tts output invalid'); generated=true;
                } catch(error) { if(error&&typeof error==='object'&&/** @type {{name?:string}} */(error).name==='AbortError') throw error; }
            }
            if(!generated&&elevenLabs) {
                try { const audio=await elevenLabs(cleaned,key,signal); check(signal); await writePrivate(raw,audio); generated=true; }
                catch(error) { if(error&&typeof error==='object'&&/** @type {{name?:string}} */(error).name==='AbortError') throw error; }
            }
            if(!generated) {
                try { await execute(gttsCommand,[cleaned,'--lang','es','--output',raw],60_000,signal); const stat=await files.stat(raw); if(!stat.isFile()||stat.size<1||stat.size>maxMediaBytes) throw new Error('gTTS output invalid'); generated=true; }
                catch(error) { if(error&&typeof error==='object'&&/** @type {{name?:string}} */(error).name==='AbortError') throw error; throw new AppError('network',{cause:error}); }
            }
            check(signal);
            if(profile.filter) {
                await execute(ffmpegCommand,['-y','-i',raw,'-af',profile.filter,filtered],60_000,signal);
                const stat=await files.stat(filtered); if(!stat.isFile()||stat.size<1||stat.size>maxMediaBytes) throw new AppError('bad_output');
                await files.rm(raw,{force:true}); finalPath=filtered;
            }
            return {ref:finalPath,mime:'audio/mpeg'};
        } catch(error) { await removeWorkspace(dir); throw error; }
    }
    /** @param {string} ref @param {AbortSignal} signal */
    async function measure(ref,signal) {
        const owned=await managedPath(ref); const result=await execute(ffprobeCommand,['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',owned.path],15_000,signal);
        const raw=typeof result.stdout==='string'?result.stdout:Buffer.isBuffer(result.stdout)?result.stdout.toString('utf8'):'';
        const duration=Number(raw.trim()); if(!Number.isFinite(duration)||duration<=0||duration>600) throw new AppError('bad_output'); return {duration,...owned};
    }
    /** @param {{ref:string,mime:string,durationSeconds?:number}} media @param {number} target @param {AbortSignal} signal */
    async function fitDuration(media,target,signal) {
        check(signal); if(!Number.isFinite(target)||target<=0||target>600) throw new TypeError('Invalid target duration');
        const measured=await measure(media.ref,signal); const factor=measured.duration/target;
        if(Math.abs(measured.duration-target)<=0.5||factor<0.85||factor>1.15) return {...media,durationSeconds:measured.duration};
        const output=path.join(measured.directory,'voice-timed.mp3');
        try {
            await execute(ffmpegCommand,['-y','-i',measured.path,'-af',`atempo=${factor.toFixed(6)}`,'-c:a','libmp3lame',output],60_000,signal);
            const stat=await files.stat(output); if(!stat.isFile()||stat.size<1||stat.size>maxMediaBytes) throw new AppError('bad_output');
            const after=await measure(output,signal); return {...media,ref:output,mime:'audio/mpeg',durationSeconds:after.duration};
        } catch(error) { await files.rm(output,{force:true}).catch(()=>{}); throw error; }
    }
    /** @param {string} ref */
    async function release(ref) {
        try { const owned=await managedPath(ref); await files.rm(owned.directory,{recursive:true,force:true}); return true; }
        catch(error) { if(error&&typeof error==='object'&&/** @type {{code?:string}} */(error).code==='ENOENT') return false; throw error; }
    }
    async function cleanupExpired() {
        await ensureDirectory(); const now=clock.now(); let count=0;
        for(const name of await files.readdir(tempDirectory)) { if(!name.startsWith(PREFIX)) continue; const dir=path.join(tempDirectory,name); const stat=await files.lstat(dir);
            if(stat.isDirectory()&&!stat.isSymbolicLink()&&now-stat.mtimeMs>=outputTtlMs) { await files.rm(dir,{recursive:true,force:true}); count++; } }
        return count;
    }
    return {prepareScript,synthesize,fitDuration,measureDuration:measure,cleanTextForSpeech,resolveVoice,release,cleanupExpired};
}

module.exports={createVoiceMedia,createExecFileRunner,cleanTextForSpeech,resolveVoice,EDGE_PROFILES,VOICE_ALIASES,ELEVEN_TRIGGERS};
