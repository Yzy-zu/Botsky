// @ts-check
'use strict';
/** @typedef {Record<string,unknown>} AiConfig */
const DEFAULTS = Object.freeze({router:{temperature:0.2,maxOutputTokens:1800},conversation:{temperature:0.85,maxOutputTokens:1200},tools:{temperature:0.35,maxOutputTokens:1200},content:{temperature:0.35,maxOutputTokens:8192},voice:{temperature:0.7,maxOutputTokens:4096}});
/** @param {unknown} v @returns {v is number} */function validTemperature(v){return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=2;}
/** @param {unknown} v @returns {v is number} */function validTokens(v){return typeof v==='number'&&Number.isInteger(v)&&v>0;}
/** @param {AiConfig} [config] @param {string} [profile] @param {number} [temperature] @param {number} [maxOutputTokens] */
function getGenerationSettings(config={},profile='default',temperature=0.7,maxOutputTokens=300){
    if(!Object.hasOwn(DEFAULTS,profile))return{temperature:validTemperature(config.temperature)?config.temperature:temperature,maxOutputTokens:validTokens(config.maxOutputTokens)?Math.min(config.maxOutputTokens,maxOutputTokens):maxOutputTokens};
    const defaults=DEFAULTS[/** @type {keyof typeof DEFAULTS} */(profile)];
    const profiles=/** @type {Record<string,{temperature?:unknown,maxOutputTokens?:unknown}>|undefined} */(config.generationProfiles);const override=profiles?.[profile]||{};
    return{temperature:validTemperature(override.temperature)?override.temperature:defaults.temperature,maxOutputTokens:Math.min(validTokens(maxOutputTokens)?maxOutputTokens:defaults.maxOutputTokens,validTokens(override.maxOutputTokens)?override.maxOutputTokens:defaults.maxOutputTokens)};
}
module.exports={getGenerationSettings};
