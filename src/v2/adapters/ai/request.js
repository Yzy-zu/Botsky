// @ts-check
'use strict';
const {record}=require('./failures');
/** @param {unknown} value @returns {value is import('../../domain/ports').LLMRequest} */
function isLlmRequest(value){const r=record(value),budget=record(r.budget);if(!['route','chat','agent','vision'].includes(String(r.task))||!Array.isArray(r.messages)||r.messages.length<1||r.messages.length>200||!Number.isInteger(budget.maxOutputTokens)||Number(budget.maxOutputTokens)<1||typeof budget.timeoutMs!=='number'||!Number.isFinite(budget.timeoutMs)||budget.timeoutMs<=0)return false;
    if(budget.temperature!==undefined&&(typeof budget.temperature!=='number'||!Number.isFinite(budget.temperature)||budget.temperature<0||budget.temperature>2))return false;
    if(r.schema!==undefined&&(!r.schema||typeof r.schema!=='object'||Array.isArray(r.schema)))return false;
    if(!r.messages.every(message=>{const m=record(message);return ['system','user','assistant','tool'].includes(String(m.role))&&Array.isArray(m.parts)&&m.parts.length>0&&m.parts.length<=100&&m.parts.every(part=>{const p=record(part);if(Object.keys(p).length!==1)return false;if('text'in p)return typeof p.text==='string';if('inlineData'in p){const data=record(p.inlineData);return ['image/jpeg','image/png','image/webp','application/pdf','audio/ogg','audio/mpeg','video/mp4'].includes(String(data.mimeType))&&typeof data.data==='string'&&data.data.length>0;}
        if('functionCall'in p){const f=record(p.functionCall);return typeof f.name==='string'&&/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(f.name)&&!!f.args&&typeof f.args==='object'&&!Array.isArray(f.args);}
        if('functionResponse'in p){const f=record(p.functionResponse);return typeof f.name==='string'&&/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(f.name)&&Object.hasOwn(f,'response');}return false;});}))return false;
    if(r.tools!==undefined&&(!Array.isArray(r.tools)||r.tools.length>100||!r.tools.every(tool=>{const t=record(tool);return typeof t.name==='string'&&/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(t.name)&&(t.description===undefined||typeof t.description==='string')&&(t.parameters===undefined||(t.parameters&&typeof t.parameters==='object'&&!Array.isArray(t.parameters)));})))return false;
    return true;
}
module.exports={isLlmRequest};
