// @ts-check
'use strict';
/** @typedef {import('../domain/types').Reply} Reply */
/** @param {Reply} reply */
function textOf(reply) { return reply.parts.filter(part=>part.type==='text').map(part=>/** @type {{type:'text',text:string}} */(part).text).join('\n').trim(); }
/** @param {Reply} reply @param {readonly string[]} [recentReplies] @param {boolean} [variationAttempted]
 * @returns {'none'|'vary-once'|'fallback'} */
function responseRepetition(reply,recentReplies=[],variationAttempted=false) {
    const text=textOf(reply);
    return text&&recentReplies.some(previous=>previous.trim()===text)?variationAttempted?'fallback':'vary-once':'none';
}
/** @param {string} text @param {number} limit */
function clip(text,limit) {
    const characters=Array.from(text);
    if (characters.length<=limit) return text;
    return limit<1?'':characters.slice(0,Math.max(0,limit-1)).join('')+'…';
}
/** @param {Reply} reply @param {{isGroup:boolean,detailRequested?:boolean,allowLong?:boolean,privateMaxChars?:number,groupMaxChars?:number,maxStatusLines?:number,status?:boolean,recentReplies?:readonly string[],variationAttempted?:boolean}} options
 * @returns {Reply} */
function responsePolicy(reply,{isGroup,detailRequested=false,allowLong=false,privateMaxChars=600,groupMaxChars=350,
    maxStatusLines=6,status=false,recentReplies=[],variationAttempted=false}) {
    if (![privateMaxChars,groupMaxChars,maxStatusLines].every(value=>Number.isSafeInteger(value)&&value>0)) throw new RangeError('Invalid response limits');
    let budget=detailRequested||allowLong?Infinity:isGroup?groupMaxChars:privateMaxChars;
    let lines=detailRequested||allowLong||!status?Infinity:maxStatusLines;
    const repetition=responseRepetition(reply,recentReplies,variationAttempted);
    const source=repetition==='fallback'?{...reply,parts:[{type:/** @type {'text'} */('text'),text:'¿Quieres que lo explique de otra forma?'}]}:reply;
    const parts=source.parts.map(part=> {
        if (part.type==='poll') return {...part,options:[...part.options]};
        if (part.type==='text') {
            // Only legacy terminal error markers are removed; ordinary quotations survive.
            let text=part.text.replace(/^\s*(?:\[!\]\s*(?:error\s*)?|>\s*❌\s*)/gimu,'');
            const rows=text.split('\n');text=rows.slice(0,lines).join('\n');lines=Math.max(0,lines-rows.length);
            text=clip(text,budget);budget=Math.max(0,budget-Array.from(text).length);
            return {...part,text};
        }
        if ('caption' in part&&part.caption!==undefined) {
            const caption=clip(part.caption,budget);budget=Math.max(0,budget-Array.from(caption).length);return {...part,caption};
        }
        return {...part};
    }).filter(part=>part.type!=='text'||part.text.length>0);
    return {...reply,parts};
}
module.exports={responsePolicy,responseRepetition};
