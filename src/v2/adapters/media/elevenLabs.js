// @ts-check
'use strict';

const { AppError } = require('../../domain/errors');

const API_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const VOICES_CACHE_TTL_MS = 10 * 60 * 1000;
const VOICES_TIMEOUT_MS = 6_000;
const AUDIO_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_USER_VOICES = 200;
const PRESET_VOICES = Object.freeze({
    daniel:'onwK4e9ZLuTAKqWW03F9', narrador:'onwK4e9ZLuTAKqWW03F9',
    adam:'pNInz6obpgDQGcFmaJgB', charlie:'IKne3meq5aSn9XLyUdCD', george:'JBFqnCBsd6RMkjVDRZzb',
    harry:'SOYHLrjzK2X1ezoPC6cr', liam:'TX3LPaxmHKxFdv7VOQHJ', alice:'Xb7hH8MSUJpSbSDYk0k2',
    lily:'pFZP5JQG7iQjIQuC4Bku', jessica:'cgSgspJ2msm6clMCkdW9', bill:'pqHfZKP75CvOlQylNhV4'
});

/** @typedef {{data?:unknown,status?:number}} HttpResponse */
/** @typedef {{get:(url:string,options:{headers:Record<string,string>,timeout:number,signal:AbortSignal,maxContentLength:number})=>Promise<HttpResponse>,post:(url:string,data:unknown,options:{headers:Record<string,string>,timeout:number,signal:AbortSignal,maxContentLength:number,responseType:'arraybuffer'})=>Promise<HttpResponse>}} HttpPort */
/** @typedef {{now:()=>number,setTimeout:(callback:()=>void,delayMs:number)=>number,clearTimeout:(handle:number)=>void}} Clock */

/** @param {{http:HttpPort,config:{elevenLabsApiKey:string},clock:Clock,voicesCacheTtlMs?:number,voicesTimeoutMs?:number,audioTimeoutMs?:number,maxAudioBytes?:number,maxVoices?:number}} options */
function createElevenLabsMedia({ http, config, clock, voicesCacheTtlMs=VOICES_CACHE_TTL_MS, voicesTimeoutMs=VOICES_TIMEOUT_MS, audioTimeoutMs=AUDIO_TIMEOUT_MS, maxAudioBytes=DEFAULT_MAX_AUDIO_BYTES, maxVoices=MAX_USER_VOICES }) {
    if (!http || typeof http.get !== 'function' || typeof http.post !== 'function') throw new TypeError('ElevenLabs HTTP port is required');
    if (!config || typeof config.elevenLabsApiKey !== 'string') throw new TypeError('ElevenLabs config is required');
    if (!clock || typeof clock.now !== 'function' || typeof clock.setTimeout !== 'function' || typeof clock.clearTimeout !== 'function') throw new TypeError('ElevenLabs clock port is required');
    if (![voicesCacheTtlMs,voicesTimeoutMs,audioTimeoutMs,maxAudioBytes,maxVoices].every(Number.isSafeInteger) || voicesCacheTtlMs<0 || voicesTimeoutMs<1 || audioTimeoutMs<1 || maxAudioBytes<1 || maxVoices<1 || maxVoices>MAX_USER_VOICES) throw new RangeError('Invalid ElevenLabs resource limits');
    /** @type {Array<{name:string,voice_id:string}>|null} */ let cachedVoices=null;
    let cachedAt=0;

    /** @param {string} name */
    function resolvePreset(name) {
        const clean=name.toLowerCase().trim().replace(/[-_]/g,'');
        return clean;
    }

    /** @param {AbortSignal} signal */
    async function fetchUserVoices(signal) {
        if (!config.elevenLabsApiKey) return cachedVoices || [];
        const now=clock.now();
        if (cachedVoices && now-cachedAt<voicesCacheTtlMs) return cachedVoices;
        try {
            const response=await bounded(inner=>http.get(`${API_BASE}/voices`,{
                headers:{'xi-api-key':config.elevenLabsApiKey,'Content-Type':'application/json'},
                timeout:voicesTimeoutMs,signal:inner,maxContentLength:1024*1024
            }),signal,voicesTimeoutMs,clock);
            if (response?.status && (response.status<200||response.status>=300)) throw typedFailure({status:response.status});
            const body=response?.data;
            const raw=body&&typeof body==='object'&&Array.isArray(/** @type {{voices?:unknown}} */(body).voices)
                ? /** @type {{voices:Array<unknown>}} */(body).voices : [];
            cachedVoices=raw.slice(0,maxVoices).flatMap(item=>{
                if (!item||typeof item!=='object') return [];
                const voice=/** @type {{name?:unknown,voice_id?:unknown}} */(item);
                return typeof voice.name==='string'&&voice.name.trim()&&typeof voice.voice_id==='string'&&/^[a-zA-Z0-9]{1,64}$/.test(voice.voice_id)
                    ? [{name:voice.name,voice_id:voice.voice_id}] : [];
            });
            cachedAt=now;
        } catch (error) {
            signal.throwIfAborted();
            // Legacy behavior: VoiceLab lookup is optional and named presets remain usable offline.
        }
        return cachedVoices || [];
    }

    /** @param {string|undefined} voiceName @param {AbortSignal} signal */
    async function resolveVoiceId(voiceName,signal) {
        if (!voiceName) return PRESET_VOICES.daniel;
        if (/^[a-zA-Z0-9]{20}$/.test(voiceName.trim())) return voiceName.trim();
        const clean=resolvePreset(voiceName);
        const voices=await fetchUserVoices(signal);
        const matched=voices.find(voice=>{
            const name=voice.name.toLowerCase().replace(/[-_\s]/g,'');
            return name&&(name.includes(clean)||clean.includes(name));
        });
        if (matched) return matched.voice_id;
        return /** @type {Record<string,string>} */(PRESET_VOICES)[clean] || PRESET_VOICES.daniel;
    }

    /** @param {string} text @param {string|undefined} voiceName @param {AbortSignal} signal */
    async function generateAudio(text,voiceName='daniel',signal) {
        if (!signal) throw new TypeError('AbortSignal is required');
        if (typeof text!=='string'||!text.trim()||text.length>20000) throw new AppError('bad_output');
        if (!config.elevenLabsApiKey) throw new AppError('auth_key');
        const voiceId=await resolveVoiceId(voiceName,signal);
        signal.throwIfAborted();
        const url=`${API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`;
        const payload={text,model_id:DEFAULT_MODEL,voice_settings:{stability:0.5,similarity_boost:0.75}};
        let response;
        try {
            response=await bounded(inner=>http.post(url,payload,{
                headers:{'xi-api-key':config.elevenLabsApiKey,'Content-Type':'application/json'},
                timeout:audioTimeoutMs,signal:inner,maxContentLength:maxAudioBytes,responseType:'arraybuffer'
            }),signal,audioTimeoutMs,clock);
        } catch (error) {
            signal.throwIfAborted();
            throw typedFailure(error);
        }
        if (response?.status && (response.status<200||response.status>=300)) throw typedFailure({status:response.status});
        const bytes=toBuffer(response?.data);
        if (!bytes||!bytes.length) throw new AppError('bad_output');
        if (bytes.length>maxAudioBytes) throw new AppError('too_large');
        return {buffer:bytes,extension:'mp3',mime:'audio/mpeg',provider:'elevenlabs'};
    }

    return {fetchUserVoices,resolveVoiceId,generateAudio};
}

/** @template T @param {(signal:AbortSignal)=>Promise<T>} operation @param {AbortSignal} parent @param {number} timeoutMs @param {Clock} clock */
function bounded(operation,parent,timeoutMs,clock) {
    parent.throwIfAborted();
    const controller=new AbortController();
    /** @type {(reason?:unknown)=>void} */ let rejectAbort=()=>{};
    const aborted=new Promise((resolve,reject)=>{rejectAbort=reject;});
    const stop=/** @param {unknown} reason */(reason)=>{if(!controller.signal.aborted)controller.abort(reason);rejectAbort(reason||new AppError('unknown'));};
    const onAbort=()=>stop(parent.reason||new Error('Operation aborted'));
    parent.addEventListener('abort',onAbort,{once:true});
    const timer=clock.setTimeout(()=>stop(new AppError('timeout')),timeoutMs);
    return Promise.race([operation(controller.signal).then(value=>{
        parent.throwIfAborted();
        if(controller.signal.aborted)throw controller.signal.reason;
        return value;
    }),aborted]).finally(()=>{clock.clearTimeout(timer);parent.removeEventListener('abort',onAbort);});
}

/** @param {unknown} error @returns {AppError} */
function typedFailure(error) {
    if (error instanceof AppError) return error;
    const value=/** @type {{name?:string,code?:string,response?:{status?:number},status?:number}} */(error||{});
    if (value.name==='TimeoutError'||value.code==='ETIMEDOUT') return new AppError('timeout',{cause:error});
    const status=value.response?.status||value.status;
    if (status===401||status===403) return new AppError('auth_key',{cause:error});
    if (status===429) return new AppError('quota',{cause:error});
    if (status===413) return new AppError('too_large',{cause:error});
    if (typeof status==='number'&&status>=400&&status<500) return new AppError('bad_output',{cause:error});
    return new AppError('network',{cause:error});
}

/** @param {unknown} data */
function toBuffer(data) {
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer,data.byteOffset,data.byteLength);
    return null;
}

module.exports={createElevenLabsMedia,PRESET_VOICES,DEFAULT_MODEL,VOICES_CACHE_TTL_MS,DEFAULT_MAX_AUDIO_BYTES};
