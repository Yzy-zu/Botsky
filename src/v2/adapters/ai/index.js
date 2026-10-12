// @ts-check
'use strict';
const {validateSchema}=require('./schema');
const {isLlmRequest}=require('./request');
const {createKeyPool,getConfiguredApiKeys,getActiveGroqKey,maskKey}=require('./keyPool');const {createCircuitBreaker}=require('./circuitBreaker');const {createGemini}=require('./gemini');const {createGroq}=require('./groq');const {AiProviderError,classifyAiError,toFailure,record}=require('./failures');
/** @param {{config:()=>Record<string,unknown>,persona?:()=>Record<string,unknown>,clock:{now:()=>number},http:import('./protocol').HttpTransport,maxConcurrent?:number}} dependencies */
function createAiAdapter({config,persona=()=>({}),clock,http,maxConcurrent=4}){
    const pool=createKeyPool({clock,keys:()=>getConfiguredApiKeys(config(),persona())});const geminiBreaker=createCircuitBreaker({clock,maxConcurrent}),groqBreaker=createCircuitBreaker({clock,maxConcurrent});
    const gemini=createGemini({clock,http,config,persona,pool,breaker:geminiBreaker});const groq=createGroq({clock,http,config,persona,breaker:groqBreaker});
    /** @param {import('../../domain/ports').LLMRequest} request @returns {Promise<import('../../domain/ports').LLMResult>} */
    async function performGenerate(request){
        if(!isLlmRequest(request))return{ok:false,failure:{kind:'bad_output',retryable:false}};
        const deadline=clock.now()+request.budget.timeoutMs;
        const systems=request.messages.filter(m=>m.role==='system');const messages=request.messages.filter(m=>m.role!=='system');
        /** @type {import('./protocol').ProviderRequest} */const options={deadline,systemInstruction:systems.flatMap(m=>m.parts.map(p=>'text'in p?p.text:'')).join('\n'),contents:messages.map(m=>({role:m.role==='assistant'?'model':m.role==='tool'?'user':m.role,parts:m.parts})),tools:request.tools?.length?[{functionDeclarations:request.tools}]:null,responseSchema:request.schema,responseMimeType:request.schema?'application/json':null,jsonMode:!!request.schema,returnContent:true,returnMetadata:true,generationProfile:{route:'router',chat:'conversation',agent:'tools',vision:'content'}[request.task],maxOutputTokens:request.budget.maxOutputTokens,maxTokens:request.budget.maxOutputTokens,temperature:request.budget.temperature,timeout:request.budget.timeoutMs};
        const visual=messages.some(m=>m.parts.some(p=>'inlineData'in p));let last=new AiProviderError({provider:'router',kind:'configuration'});
        for(const provider of ['gemini','groq']){
            if(clock.now()>=deadline)return{ok:false,failure:{kind:'timeout',retryable:true}};
            if(provider==='gemini'&&!pool.count())continue;if(provider==='groq'&&!getActiveGroqKey(config(),persona()))continue;
            if(provider==='groq'&&visual)return{ok:false,failure:{kind:'unsupported_media',retryable:false}};
            try{const raw=provider==='gemini'?await gemini.callGemini(options):await groq.callGroq(options);if(clock.now()>deadline)return{ok:false,failure:{kind:'timeout',retryable:true}};const generated=record(raw);const content=record(generated.content);const parts=/** @type {import('./protocol').Part[]} */(Array.isArray(content.parts)?content.parts:typeof generated.text==='string'&&generated.text?[{text:generated.text}]:[]);
                /** @type {Array<{name:string,args:Record<string,unknown>}>} */const toolCalls=parts.flatMap(p=>p.functionCall?[p.functionCall]:[]);
                if(provider==='groq'&&Array.isArray(generated.toolCalls)){for(const value of generated.toolCalls){const fn=record(record(value).function);let args;try{args=typeof fn.arguments==='string'?JSON.parse(fn.arguments):{};}catch{throw new AiProviderError({provider,kind:'invalid_response'});}if(typeof fn.name!=='string'||!args||typeof args!=='object'||Array.isArray(args))throw new AiProviderError({provider,kind:'invalid_response'});toolCalls.push({name:fn.name,args});parts.push({functionCall:{name:fn.name,args}});}}
                for(const call of toolCalls){const declaration=request.tools?.find(t=>t.name===call.name);if(!declaration||!call.args||typeof call.args!=='object'||Array.isArray(call.args)||(declaration.parameters&&!validateSchema(call.args,declaration.parameters)))throw new AiProviderError({provider,kind:'invalid_response'});}
                const finish=typeof generated.finishReason==='string'?generated.finishReason:null;const text=parts.map(p=>p.text||'').join('\n').trim();
                if(request.schema){if(finish==='MAX_TOKENS'||finish==='length')throw new AiProviderError({provider,kind:'invalid_response',finishReason:finish});let parsed;try{parsed=JSON.parse(text);}catch{throw new AiProviderError({provider,kind:'invalid_response'});}if(!validateSchema(parsed,request.schema))throw new AiProviderError({provider,kind:'invalid_response'});}
                const publicParts=parts.filter(p=>!p.thought).filter(p=>p.text!==undefined||p.inlineData||p.functionCall||p.functionResponse);
                return{ok:true,data:{text,parts:/** @type {import('../../domain/ports').LLMPart[]} */(publicParts),toolCalls,finishReason:finish,provider:/** @type {'gemini'|'groq'} */(provider)}};
            }catch(error){last=new AiProviderError({...classifyAiError(error,provider)});if(last.diagnostic.kind==='blocked')break;}
        }
        if(clock.now()>=deadline)return{ok:false,failure:{kind:'timeout',retryable:true}};
        const failure=toFailure(last.diagnostic);return{ok:false,failure:{kind:failure.kind,retryable:failure.retryable,diagnostic:/** @type {Record<string,string|number|boolean>} */({...failure.diagnostic})}};
    }
    /** @param {import('../../domain/ports').LLMRequest} request @returns {Promise<import('../../domain/ports').LLMResult>} */
    async function generate(request){try{return await performGenerate(request);}catch(error){const failure=toFailure(classifyAiError(error,'router'));return{ok:false,failure:{kind:failure.kind,retryable:failure.retryable}};}}
    return{generate,callGemini:gemini.callGemini,callGroq:groq.callGroq,pool,geminiBreaker,groqBreaker,getConfiguredApiKeys:()=>getConfiguredApiKeys(config(),persona()),getActiveGroqKey:()=>getActiveGroqKey(config(),persona()),maskKey,isGroqAvailable:groq.isGroqAvailable,markGroqCooldown:groq.markGroqCooldown};
}
module.exports={createAiAdapter};
