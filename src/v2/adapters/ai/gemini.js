// @ts-check
'use strict';
const {AiProviderError,classifyAiError,assertGeminiResponse}=require('./failures');
const {getGenerationSettings}=require('./generationSettings');
/** @param {{clock:{now:()=>number},http:import('./protocol').HttpTransport,config:()=>Record<string,unknown>,persona:()=>Record<string,unknown>,pool:ReturnType<typeof import('./keyPool').createKeyPool>,breaker:ReturnType<typeof import('./circuitBreaker').createCircuitBreaker>}} dependencies */
function createGemini({clock,http,config,persona,pool,breaker}){
    /** @param {import('./protocol').ProviderRequest} request */
    async function callGemini(request){
        const slot=breaker.acquire();if(!slot)throw new AiProviderError({provider:'gemini',kind:'provider_unavailable',retryable:true});
        try {
        const settingsConfig=persona(),cfg=config();const {temperature,maxOutputTokens}=getGenerationSettings(settingsConfig,request.generationProfile,request.temperature,request.maxOutputTokens);
        const contents=request.contents||[{role:'user',parts:[...(request.media?[{inlineData:request.media}]:[]),...(request.userMessage?[{text:request.userMessage}]:[])]}];
        /** @type {Record<string,unknown>} */const payload={contents,generationConfig:{temperature,maxOutputTokens,...(request.responseMimeType?{responseMimeType:request.responseMimeType}:{}),...(request.responseSchema?{responseSchema:request.responseSchema}:{})},safetySettings:['HARM_CATEGORY_HARASSMENT','HARM_CATEGORY_HATE_SPEECH','HARM_CATEGORY_SEXUALLY_EXPLICIT','HARM_CATEGORY_DANGEROUS_CONTENT'].map(category=>({category,threshold:'BLOCK_NONE'}))};
        if(request.tools)payload.tools=request.tools;if(request.toolConfig)payload.toolConfig=request.toolConfig;if(request.systemInstruction)payload.systemInstruction={parts:[{text:request.systemInstruction}]};
        const model=String(settingsConfig.model||cfg.GEMINI_MODEL||'gemini-3.5-flash-lite');
        if(!/^[a-zA-Z0-9_.-]+$/.test(model)){slot.failure(false);throw new AiProviderError({provider:'gemini',kind:'configuration'});}
        const timeout=request.timeout||(request.media?35000:Number(cfg.GEMINI_TIMEOUT_MS)||12000);const tried=new Set();let last=new AiProviderError({provider:'gemini',kind:pool.count()?'rate_limit':'configuration',retryable:pool.count()>0});
        for(let attempt=0;attempt<pool.count();attempt++){
            const key=pool.next(tried);if(!key)break;tried.add(key);
            /** @param {number} duration */const send=async duration=>{const remaining=request.deadline===undefined?duration:Math.min(duration,request.deadline-clock.now());if(remaining<=0)throw new AiProviderError({provider:'gemini',kind:'network',networkCode:'ETIMEDOUT',retryable:true});const response=await http.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,payload,{headers:{'Content-Type':'application/json','x-goog-api-key':key},timeout:remaining});return assertGeminiResponse(response.data,{needsText:!(request.returnContent||request.tools)});};
            try{
                let generated;
                try{generated=await send(timeout);}catch(error){const f=classifyAiError(error,'gemini');if(f.networkCode==='ECONNABORTED'||f.networkCode==='ETIMEDOUT')generated=await send(request.media?35000:timeout);else throw error;}
                pool.success(key);slot.success();if(request.returnContent||request.tools)return request.returnMetadata?{content:generated.content,finishReason:generated.finishReason}:generated.content;
                return request.returnMetadata?{text:generated.text,finishReason:generated.finishReason}:generated.text;
            }catch(error){const failure=classifyAiError(error,'gemini');last=new AiProviderError({...failure});
                if(error instanceof AiProviderError||failure.kind==='invalid_request')break;
                if(failure.kind==='rate_limit')pool.cooldown(key,15000,true);
                else if(failure.httpStatus===401){pool.disable(key);}
                else if(failure.httpStatus===403)pool.cooldown(key,120000);
                else if(failure.kind==='network')pool.cooldown(key,3000);
                else if(failure.kind==='provider_unavailable')pool.cooldown(key,4000);
                else break;
            }
        }
        if(['rate_limit','network','provider_unavailable'].includes(last.diagnostic.kind))slot.failure(last.diagnostic.kind==='rate_limit');else slot.success();
        throw last;
        } finally { slot.success(); }
    }
    return{callGemini};
}
module.exports={createGemini};
