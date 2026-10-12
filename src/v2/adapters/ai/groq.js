// @ts-check
'use strict';
const {AiProviderError,classifyAiError,assertGroqResponse,record}=require('./failures');
const {getGenerationSettings}=require('./generationSettings');const {getActiveGroqKey}=require('./keyPool');
/** @param {{clock:{now:()=>number},http:import('./protocol').HttpTransport,config:()=>Record<string,unknown>,persona:()=>Record<string,unknown>,breaker:ReturnType<typeof import('./circuitBreaker').createCircuitBreaker>}} dependencies */
function createGroq({clock,http,config,persona,breaker}){
    /** @param {import('./protocol').ProviderRequest} request */
    async function callGroq(request){const settingsConfig=persona(),cfg=config(),key=getActiveGroqKey(cfg,settingsConfig);if(!key)throw new AiProviderError({provider:'groq',kind:'configuration'});
        if(request.media||request.contents?.some(c=>c.parts.some(p=>p.inlineData)))throw new AiProviderError({provider:'groq',kind:'invalid_request'});
        let messages;try{messages=toGroqMessages(request.contents||[{role:'user',parts:[{text:request.userMessage||''}]}]);}catch{throw new AiProviderError({provider:'groq',kind:'invalid_request'});}
        const slot=breaker.acquire();if(!slot)throw new AiProviderError({provider:'groq',kind:'provider_unavailable',retryable:true});
        try {
        const model=String(settingsConfig.groqModel||cfg.GROQ_MODEL||'openai/gpt-oss-20b');const settings=getGenerationSettings(settingsConfig,request.generationProfile,request.temperature,request.maxTokens||request.maxOutputTokens);
        /** @type {Record<string,unknown>} */const payload={model,messages:[...(request.systemInstruction?[{role:'system',content:request.systemInstruction}]:[]),...messages],temperature:settings.temperature,max_completion_tokens:settings.maxOutputTokens,...(['openai/gpt-oss-20b','openai/gpt-oss-120b'].includes(model)?{include_reasoning:false,...(request.generationProfile==='router'?{reasoning_effort:'low'}:{})}:{}),...(request.jsonMode||request.responseMimeType==='application/json'?{response_format:{type:'json_object'}}:{})};
        if(request.tools){const tools=Array.isArray(request.tools)?request.tools:[];payload.tools=tools.flatMap(t=>{const entry=record(t);return Array.isArray(entry.functionDeclarations)?entry.functionDeclarations:[];}).map(declaration=>({type:'function',function:declaration}));}
        try{const remaining=request.deadline===undefined?(request.timeout||15000):Math.min(request.timeout||15000,request.deadline-clock.now());if(remaining<=0)throw new AiProviderError({provider:'groq',kind:'network',networkCode:'ETIMEDOUT',retryable:true});const response=await http.post('https://api.groq.com/openai/v1/chat/completions',payload,{headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},timeout:remaining});const generated=assertGroqResponse(response.data,{needsText:!request.tools});slot.success();return request.returnContent||request.returnMetadata||request.tools?generated:generated.text;}
        catch(error){const failure=classifyAiError(error,'groq');if(['rate_limit','provider_unavailable','network'].includes(failure.kind)||failure.httpStatus===413)slot.failure(failure.kind==='rate_limit'||failure.httpStatus===413);else slot.success();throw new AiProviderError({...failure});}
        } finally { slot.success(); }
    }
    return{callGroq,isGroqAvailable:breaker.available,markGroqCooldown:breaker.trip,reset:breaker.reset};
}
/** @param {import('./protocol').Content[]} contents */
function toGroqMessages(contents){
    /** @type {Record<string,string[]>} */const pending=Object.create(null);let sequence=0;
    /** @type {Array<Record<string,unknown>>} */const messages=[];
    for(const content of contents){
        const responses=content.parts.filter(p=>p.functionResponse);
        if(responses.length){for(const part of responses){const response=part.functionResponse;if(!response)continue;const id=pending[response.name]?.shift();if(!id)throw new Error('Unknown tool response');messages.push({role:'tool',tool_call_id:id,content:JSON.stringify(response.response)});}continue;}
        const calls=content.parts.flatMap(p=>p.functionCall?[p.functionCall]:[]).map(fn=>{const id=`call-${sequence++}`;(pending[fn.name]||= []).push(id);return{id,type:'function',function:{name:fn.name,arguments:JSON.stringify(fn.args)}};});
        messages.push({role:content.role==='model'?'assistant':content.role,content:content.parts.map(p=>p.text||'').join('\n'),...(calls.length?{tool_calls:calls}:{})});
    }
    return messages;
}
module.exports={createGroq,toGroqMessages};
