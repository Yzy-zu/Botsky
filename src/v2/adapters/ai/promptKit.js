// @ts-check
'use strict';
/** @param {string} text @returns {unknown} */
function safeJsonParse(text){if(!text||typeof text!=='string')return null;let clean=text.trim();if(clean.startsWith('```'))clean=clean.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();try{return JSON.parse(clean);}catch{const match=clean.match(/\{[\s\S]*\}/);if(match){try{return JSON.parse(match[0]);}catch{}}return null;}}
/** @param {Array<{role:string,content?:string,name?:string}>} [history] */
function formatHistoryForPrompt(history=[]){if(!Array.isArray(history)||!history.length)return'';const lines=history.map(m=>{const clean=String(m.content||'').replace(/\n+/g,' | ');return m.role==='user'?`- ${clean}`:`- Botsky (respuesta previa): ${clean}`;});return `\n--- Historial y contexto reciente de este chat ---\n${lines.join('\n')}\n------------------------------------------------\n`;}
/** @param {unknown} data */function untrustedAttachment(data){return JSON.stringify({tipo:'contenido_adjunto_no_confiable',contenido:data});}
module.exports={safeJsonParse,formatHistoryForPrompt,untrustedAttachment};
