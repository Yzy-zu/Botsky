// @ts-check
'use strict';
/** @typedef {'blocked'|'empty_response'|'invalid_response'|'configuration'|'rate_limit'|'provider_unavailable'|'network'|'invalid_request'} LegacyKind */
/** @typedef {{kind:LegacyKind,provider:'gemini'|'groq'|'router',retryable:boolean,httpStatus?:number,providerCode?:string,finishReason?:string,blockReason?:string,networkCode?:string,parameter?:string}} Diagnostic */
const KINDS=Object.freeze(['blocked','empty_response','invalid_response','configuration','rate_limit','provider_unavailable','network','invalid_request']);
const CODES=Object.freeze(['INVALID_ARGUMENT','PERMISSION_DENIED','UNAUTHENTICATED','RESOURCE_EXHAUSTED','UNAVAILABLE','INTERNAL','DEADLINE_EXCEEDED','json_validate_failed','model_not_found','invalid_api_key','context_length_exceeded','rate_limit_exceeded','content_policy_violation','invalid_request_error','authentication_error','permission_error']);
const FINISH=Object.freeze(['STOP','MAX_TOKENS','SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII','IMAGE_SAFETY','OTHER','MALFORMED_FUNCTION_CALL','UNEXPECTED_TOOL_CALL','stop','length','content_filter','tool_calls']);
const BLOCK=Object.freeze(['SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII','IMAGE_SAFETY','content_filter']);
const NETWORK=Object.freeze(['ECONNABORTED','ETIMEDOUT','ECONNRESET','ENOTFOUND','EAI_AGAIN','ERR_NETWORK','ECONNREFUSED']);
const PARAMETERS=Object.freeze(['model','messages','response_format','temperature','max_tokens','max_completion_tokens','reasoning_format','reasoning_effort','include_reasoning']);
/** @param {unknown} value @returns {Record<string,unknown>} */function record(value){return value&&typeof value==='object'&&!Array.isArray(value)?/** @type {Record<string,unknown>} */(value):{};}
/** @param {Record<string,unknown>} [input] @returns {Diagnostic} */
function diagnostic(input={}){
    /** @type {Diagnostic} */ const result={kind:KINDS.includes(String(input.kind))?/** @type {LegacyKind} */(input.kind):'provider_unavailable',provider:['gemini','groq','router'].includes(String(input.provider))?/** @type {Diagnostic['provider']} */(input.provider):'router',retryable:input.retryable===true};
    if(typeof input.httpStatus==='number'&&Number.isInteger(input.httpStatus)&&input.httpStatus>=100&&input.httpStatus<=599)result.httpStatus=input.httpStatus;
    for(const [name,allowed] of [['providerCode',CODES],['finishReason',FINISH],['blockReason',BLOCK],['networkCode',NETWORK],['parameter',PARAMETERS]]){
        const field=String(name);const values=/** @type {readonly string[]} */(allowed);if(typeof input[field]==='string'&&values.includes(input[field]))Object.assign(result,{[field]:input[field]});
    }
    return result;
}
class AiProviderError extends Error{
    /** @param {Record<string,unknown>} input */constructor(input){const safe=diagnostic(input);super(`AI ${safe.provider}: ${safe.kind}`);this.name='AiProviderError';this.diagnostic=safe;}
}
/** @param {unknown} error @param {string} provider */
function classifyAiError(error,provider){if(error instanceof AiProviderError)return diagnostic({...error.diagnostic});const e=record(error),response=record(e.response),detail=record(record(response.data).error);const status=response.status;
    const code=CODES.includes(String(detail.code))?detail.code:CODES.includes(String(detail.status))?detail.status:detail.type;
    /** @type {LegacyKind} */let kind='provider_unavailable';
    if(code==='content_policy_violation')kind='blocked';else if(code==='json_validate_failed')kind='invalid_response';else if(status===401||status===403||code==='model_not_found')kind='configuration';else if(status===429||detail.code===429||detail.status==='RESOURCE_EXHAUSTED')kind='rate_limit';else if(status===400||status===413||status===422)kind='invalid_request';else if(NETWORK.includes(String(e.code)))kind='network';
    return diagnostic({provider,kind,httpStatus:status,providerCode:code,parameter:detail.param,networkCode:e.code,retryable:['network','rate_limit','provider_unavailable'].includes(kind)});
}
/** @param {unknown} data @param {{needsText?:boolean}} [options] */
function assertGeminiResponse(data,{needsText=true}={}){
    const d=record(data),candidate=record(Array.isArray(d.candidates)?d.candidates[0]:null),prompt=record(d.promptFeedback).blockReason,finish=candidate.finishReason;
    if((prompt&&prompt!=='BLOCK_REASON_UNSPECIFIED')||BLOCK.includes(String(finish)))throw new AiProviderError({kind:'blocked',provider:'gemini',finishReason:finish,blockReason:prompt||finish});
    const content=/** @type {import('./protocol').Content} */(candidate.content);const parts=Array.isArray(content?.parts)?content.parts.filter(p=>!p.thought):[];const text=parts.map(p=>typeof p.text==='string'?p.text:'').join('\n').trim();
    if(['MALFORMED_FUNCTION_CALL','UNEXPECTED_TOOL_CALL','OTHER'].includes(String(finish)))throw new AiProviderError({provider:'gemini',kind:'invalid_response',finishReason:finish});
    if(!(text||parts.some(p=>p.functionCall||p.inlineData||p.executableCode||p.codeExecutionResult))||(needsText&&!text))throw new AiProviderError({provider:'gemini',kind:finish==='MAX_TOKENS'?'invalid_response':'empty_response',finishReason:finish});
    return{content,text,finishReason:typeof finish==='string'?finish:null};
}
/** @param {unknown} data @param {{needsText?:boolean}} [options] */
function assertGroqResponse(data,{needsText=true}={}){const d=record(data),choice=record(Array.isArray(d.choices)?d.choices[0]:null),message=record(choice.message),finish=choice.finish_reason;
    if(finish==='content_filter'||message.refusal)throw new AiProviderError({provider:'groq',kind:'blocked',finishReason:finish});
    const text=typeof message.content==='string'?message.content.trim():'';const calls=Array.isArray(message.tool_calls)?message.tool_calls:[];
    if(!text&&(needsText||!calls.length))throw new AiProviderError({provider:'groq',kind:finish==='length'?'invalid_response':'empty_response',finishReason:finish});
    return{text,toolCalls:calls,finishReason:typeof finish==='string'?finish:null};}
/** Domain failure mapped without exposing provider bodies.
 * @param {Diagnostic} failure @returns {{kind:import('../../domain/errors').ErrorKind,retryable:boolean,diagnostic:Diagnostic}} */
function toFailure(failure){
    /** @type {import('../../domain/errors').ErrorKind} */
    let kind='unknown';const mapping={blocked:'safety_block',empty_response:'bad_output',invalid_response:'bad_output',configuration:'auth_key',rate_limit:'quota',provider_unavailable:'network',network:'network',invalid_request:'bad_output'};kind=/** @type {import('../../domain/errors').ErrorKind} */(mapping[failure.kind]);if(failure.httpStatus===413)kind='too_large';if(['ECONNABORTED','ETIMEDOUT'].includes(failure.networkCode||''))kind='timeout';return{kind,retryable:failure.retryable,diagnostic:failure};}
module.exports={AiProviderError,diagnostic,classifyAiError,assertGeminiResponse,assertGroqResponse,toFailure,record};
