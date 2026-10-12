// @ts-check
'use strict';
/** @typedef {Readonly<Record<string,unknown>>} Config */
/** @param {unknown} value @returns {string[]} */
function list(value) { return (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []).filter(v=>typeof v==='string').map(v=>v.trim()).filter(Boolean); }
/** Pure boundary normalization: config reader, never process.env.
 * @param {Config} config @param {Config} [persona] */
function getConfiguredApiKeys(config, persona = {}) {
    const dynamic = list(persona.geminiKeys);
    const raw = dynamic.length ? dynamic : [
        ...list(config.GEMINI_API_KEY),...list(config.GEMINI_API_KEY_2),...list(config.GEMINI_API_KEY_3),
        ...Object.keys(config).filter(k=>/^GEMINI_API_KEY_\d+$/.test(k)&& !['GEMINI_API_KEY_2','GEMINI_API_KEY_3'].includes(k))
            .sort((a,b)=>Number(a.slice(15))-Number(b.slice(15))).flatMap(k=>list(config[k])), ...list(config.GEMINI_API_KEYS)
    ];
    return [...new Set(raw)];
}
/** @param {Config} config @param {Config} [persona] */
function getActiveGroqKey(config,persona={}) { return list(persona.groqKey)[0] || list(config.GROQ_API_KEY)[0] || ''; }
/** @param {unknown} key */
function maskKey(key) { if(!key||typeof key!=='string')return'none';const value=key.trim(); return value.length>10 ? `${value.slice(0,6)}...${value.slice(-4)}` : '***'; }
/** @param {{clock:{now:()=>number},keys:()=>string[]}} options */
function createKeyPool({clock,keys}) {
    /** @type {Record<string,{until:number,failures:number,disabled:boolean}>} */const states=Object.create(null); let cursor=0;
    function synchronize() { const current=[...new Set(keys())]; for(const key of Object.keys(states)) if(!current.includes(key)) delete states[key];return current; }
    /** Each key at most once per request; live cooldown never bypassed.
     * @param {Set<string>} [excluded] */
    function next(excluded=new Set()) { const current=synchronize();for(let n=0;n<current.length;n++){const i=(cursor+n)%current.length;const key=current[i];const state=states[key];if(!excluded.has(key)&&(!state||(!state.disabled&&clock.now()>=state.until))){cursor=(i+1)%current.length;return key;}} return null; }
    /** @param {string} key @param {number} [durationMs] @param {boolean} [backoff] */
    function cooldown(key,durationMs=60000,backoff=false) { if(!synchronize().includes(key))return; const previous=states[key]||{until:0,failures:0,disabled:false};states[key]={until:clock.now()+(backoff?Math.min(durationMs*2**Math.min(previous.failures,3),120000):durationMs),failures:previous.failures+1,disabled:previous.disabled}; }
    /** @param {string} key */function disable(key){if(synchronize().includes(key))states[key]={until:Infinity,failures:(states[key]?.failures||0)+1,disabled:true};}
    /** @param {string} key */function success(key){if(states[key])states[key]={until:0,failures:0,disabled:false};}
    /** Snapshot exposes indexes and timings, never credentials. */
    function snapshot(){return synchronize().map((key,index)=>({index,...(states[key]||{until:0,failures:0,disabled:false})}));}
    function reset(){for(const key of Object.keys(states))delete states[key];cursor=0;}
    return {next,cooldown,disable,success,snapshot,reset,count:()=>synchronize().length};
}
module.exports={getConfiguredApiKeys,getActiveGroqKey,maskKey,createKeyPool};
