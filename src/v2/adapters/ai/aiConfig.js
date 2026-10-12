// @ts-check
'use strict';
/** @typedef {Record<string,unknown>} AiConfig */
/** Lazy dynamic reader port. No file I/O owned by adapter; preserve cached value
 * through unavailable/invalid updates and two-second read TTL.
 * @param {{clock:{now:()=>number},read:()=>{mtimeMs:number,config:AiConfig}|null,ttlMs?:number}} options */
function createAiConfig({clock,read,ttlMs=2000}) {
    /** @type {AiConfig} */let cached={}; let lastCheck=-Infinity,lastMtime=-Infinity;
    function getAiConfig(){if(clock.now()-lastCheck<ttlMs)return structuredClone(cached);lastCheck=clock.now();try{const next=read();if(next&&typeof next.config==='object'&&!Array.isArray(next.config)&&next.config!==null&&Number.isFinite(next.mtimeMs)&&next.mtimeMs!==lastMtime){cached=structuredClone(next.config);lastMtime=next.mtimeMs;}}catch{/* Preserve last valid config. */}return structuredClone(cached);}
    return{getAiConfig};
}
module.exports={createAiConfig};
