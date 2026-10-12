'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createAiAdapter}=require('../../src/v2/adapters/ai');const {FakeClock}=require('../../src/v2/platform/clock');
const gemini=(text='ok',finishReason='STOP')=>({data:{candidates:[{finishReason,content:{role:'model',parts:[{text}]}}]}});
const groq=(text='ok',finish_reason='stop')=>({data:{choices:[{finish_reason,message:{content:text}}]}});
function harness(post,config={GEMINI_API_KEY:['key-one','key-two'],GROQ_API_KEY:'groq-key'}){const calls=[],clock=new FakeClock();const api=createAiAdapter({clock,config:()=>config,http:{post:async(...args)=>{calls.push(args);return post(...args);}}});return{api,clock,calls,config};}
const request=(extra={})=>({task:'chat',messages:[{role:'user',parts:[{text:'hola'}]}],budget:{maxOutputTokens:300,timeoutMs:1000},...extra});
const fault=status=>Object.assign(new Error('SECRET-user-provider-body'),{response:{status,data:{error:{message:'SECRET-user-provider-body'}}}});
test('Gemini header-only keys, rotating 429/403/503 and 400 non-retry contract',async()=>{
    for(const status of [429,403,503]){let count=0;const h=harness(async()=>{if(!count++)throw fault(status);return gemini();});assert.equal(await h.api.callGemini({userMessage:'hola'}),'ok');assert.equal(h.calls.length,2);assert.equal(h.calls[0][2].headers['x-goog-api-key'],'key-one');assert.equal(h.calls[1][2].headers['x-goog-api-key'],'key-two');assert.ok(!h.calls.some(c=>c[0].includes('key-one')));assert.equal(h.api.pool.snapshot()[0].failures,1);}
    const h=harness(async()=>{throw fault(400);});await assert.rejects(h.api.callGemini({userMessage:'hola'}));assert.equal(h.calls.length,1);
});
test('Gemini native PDF/tools/function-response parts and return-content ABI survive',async()=>{
    const content={role:'model',parts:[{functionCall:{name:'lookup',args:{id:2}}}]};const h=harness(async()=>({data:{candidates:[{content,finishReason:'STOP'}]}}));
    const contents=[{role:'user',parts:[{inlineData:{mimeType:'application/pdf',data:'cGRm'}},{functionResponse:{name:'lookup',response:{ok:true}}}]}];const tools=[{functionDeclarations:[{name:'lookup'}]}];
    assert.equal(await h.api.callGemini({contents,tools,toolConfig:{functionCallingConfig:{mode:'AUTO'}},returnContent:true}),content);
    assert.deepEqual(h.calls[0][1].contents,contents);assert.deepEqual(h.calls[0][1].tools,tools);
    const meta=await h.api.callGemini({userMessage:'lookup',returnContent:true,returnMetadata:true});assert.equal(meta.content,content);assert.equal(meta.finishReason,'STOP');
    await h.api.callGemini({media:{mimeType:'application/pdf',data:'cGRm'},userMessage:'leer',returnContent:true});assert.equal(h.calls[2][1].contents[0].parts[0].inlineData.mimeType,'application/pdf');
});
test('confirmed safety rejection never invokes fallback; empty/bad/truncated schema can fallback',async()=>{
    for(const data of [{promptFeedback:{blockReason:'UNKNOWN_FUTURE_REASON'}},{candidates:[{finishReason:'SAFETY'}]}]){const h=harness(async()=>({data}));const result=await h.api.generate(request());assert.equal(result.ok,false);assert.equal(result.failure.kind,'safety_block');assert.equal(h.calls.length,1);}
    const schema={type:'object',properties:{action:{type:'string',enum:['help']}},required:['action'],additionalProperties:false};
    for(const response of [{data:{}},gemini('not-json'),gemini('{"action":"help"}','MAX_TOKENS'),gemini('{"action":"unknown"}')]){const h=harness(async url=>url.includes('googleapis')?response:groq('{"action":"help"}'));const result=await h.api.generate(request({task:'route',schema}));assert.equal(result.ok,true);assert.equal(result.data.provider,'groq');assert.equal(h.calls.length,2);}
});
test('Groq payload preserves current token field OSS options and custom model omission',async()=>{
    const h=harness(async()=>groq());await h.api.callGroq({generationProfile:'router',systemInstruction:'system',userMessage:'request',maxTokens:120,jsonMode:true});const payload=h.calls[0][1];assert.equal(payload.max_completion_tokens,120);assert.equal(payload.max_tokens,undefined);assert.equal(payload.reasoning_effort,'low');assert.equal(payload.include_reasoning,false);assert.equal(payload.messages[0].role,'system');
    h.config.GROQ_MODEL='llama-test';await h.api.callGroq({userMessage:'hola'});assert.equal(h.calls[1][1].include_reasoning,undefined);
});
test('port budgets/content/system and neutral tool declarations cross adapter without tool execution',async()=>{
    const h=harness(async()=>({data:{candidates:[{finishReason:'STOP',content:{role:'model',parts:[{functionCall:{name:'lookup',args:{id:1}}}]}}]}}));
    const r=await h.api.generate(request({task:'agent',messages:[{role:'system',parts:[{text:'policy'}]},{role:'assistant',parts:[{functionCall:{name:'lookup',args:{id:1}}}]},{role:'tool',parts:[{functionResponse:{name:'lookup',response:{data:1}}}]}],tools:[{name:'lookup',parameters:{type:'object'}}]}));
    assert.equal(r.ok,true);assert.equal(r.data.toolCalls[0].name,'lookup');assert.equal(h.calls[0][1].generationConfig.maxOutputTokens,300);assert.equal(h.calls[0][2].timeout,1000);assert.equal(h.calls[0][1].systemInstruction.parts[0].text,'policy');assert.equal(h.calls[0][1].tools[0].functionDeclarations[0].name,'lookup');assert.equal(h.calls[0][1].contents[0].role,'model');
});
test('vision failure never asks text-only backup to invent unseen content',async()=>{
    const h=harness(async()=>{throw fault(400);});const result=await h.api.generate(request({task:'vision',messages:[{role:'user',parts:[{inlineData:{mimeType:'application/pdf',data:'cGRm'}}]}]}));assert.equal(result.ok,false);assert.equal(result.failure.kind,'unsupported_media');assert.equal(h.calls.length,1);
});
test('single timeout retry and safe failures omit raw/provider secrets',async()=>{
    let n=0;const h=harness(async()=>{if(!n++)throw Object.assign(Error('secret'),{code:'ETIMEDOUT'});return gemini();});assert.equal(await h.api.callGemini({userMessage:'hi'}),'ok');assert.equal(h.calls.length,2);
    const bad=harness(async()=>{throw fault(401);});const result=await bad.api.generate(request());assert.equal(result.ok,false);assert.ok(!JSON.stringify(result).includes('SECRET'));assert.ok(bad.api.pool.snapshot().every(s=>s.disabled));
});
test('effective rate-limit breaker blocks repeated requests and one half-open probe admits recovery',async()=>{
    let limited=true,release;const h=harness(async url=>{if(limited)throw fault(429);return new Promise(resolve=>{release=()=>resolve(groq());});},{GROQ_API_KEY:'groq-key'});
    await assert.rejects(h.api.callGroq({userMessage:'hi'}));const count=h.calls.length;await assert.rejects(h.api.callGroq({userMessage:'hi'}));assert.equal(h.calls.length,count);
    limited=false;await h.clock.advance(60000);const probe=h.api.callGroq({userMessage:'hi'});await assert.rejects(h.api.callGroq({userMessage:'other'}));assert.equal(h.calls.length,count+1);release();await probe;assert.equal(h.api.isGroqAvailable(),true);
});
test('malformed nested port requests produce bad_output without transport or rejection',async()=>{
    const h=harness(async()=>{throw Error('must not call');});
    for(const r of [null,request({messages:[null]}),request({messages:[{role:'wrong',parts:[{text:'hi'}]}]}),request({messages:[{role:'user',parts:null}]}),request({messages:[{role:'user',parts:[{text:1}]}]}),request({messages:[{role:'user',parts:[{inlineData:{mimeType:'unknown',data:'a'}}]}]}),request({tools:[{name:123}]}),request({budget:{maxOutputTokens:0,timeoutMs:1}})]){const out=await h.api.generate(r);assert.equal(out.ok,false);assert.equal(out.failure.kind,'bad_output');}assert.equal(h.calls.length,0);
});
test('one shared deadline reduces retry and fallback transport timeouts and prevents late attempts',async()=>{
    const clock=new FakeClock();const calls=[];const api=createAiAdapter({clock,config:()=>({GEMINI_API_KEY:['a','b'],GROQ_API_KEY:'g'}),http:{post:async(url,payload,opts)=>{calls.push(opts.timeout);if(calls.length===1){await clock.advance(400);throw fault(503);}if(calls.length===2){await clock.advance(300);return{data:{}};}return groq();}}});
    const out=await api.generate(request());assert.equal(out.ok,true);assert.deepEqual(calls,[1000,600,300]);
    const exhausted=createAiAdapter({clock,config:()=>({GEMINI_API_KEY:['a','b'],GROQ_API_KEY:'g'}),http:{post:async()=>{await clock.advance(1000);throw fault(503);}}});
    const result=await exhausted.generate(request());assert.equal(result.ok,false);assert.equal(result.failure.kind,'timeout');
});
test('Groq function-call cycles retain matching tool IDs and parsed response calls',async()=>{
    const calls=[];const api=createAiAdapter({clock:new FakeClock(),config:()=>({GROQ_API_KEY:'g'}),http:{post:async(url,payload)=>{calls.push(payload);return{data:{choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'provider-id',function:{name:'lookup',arguments:'{"id":2}'}}]}}]}};}}});
    const result=await api.generate(request({task:'agent',tools:[{name:'lookup',parameters:{type:'object'}}],messages:[{role:'assistant',parts:[{functionCall:{name:'lookup',args:{id:1}}}]},{role:'tool',parts:[{functionResponse:{name:'lookup',response:{value:1}}}]}]}));
    assert.equal(result.ok,true);assert.deepEqual(result.data.toolCalls,[{name:'lookup',args:{id:2}}]);assert.equal(calls[0].messages[1].role,'tool');assert.equal(calls[0].messages[1].tool_call_id,calls[0].messages[0].tool_calls[0].id);assert.equal(calls[0].tools[0].function.name,'lookup');
});
test('throwing dynamic configuration setup always releases provider concurrency slots',async()=>{
    const {createGemini}=require('../../src/v2/adapters/ai/gemini');const {createGroq}=require('../../src/v2/adapters/ai/groq');const {createCircuitBreaker}=require('../../src/v2/adapters/ai/circuitBreaker');const {createKeyPool}=require('../../src/v2/adapters/ai/keyPool');
    const clock=new FakeClock();const breaker=createCircuitBreaker({clock,maxConcurrent:1});const pool=createKeyPool({clock,keys:()=>['a']});const provider=createGemini({clock,http:{post:async()=>gemini()},config:()=>({}),persona:()=>{throw Error('config private error');},pool,breaker});
    for(let n=0;n<4;n++){await assert.rejects(provider.callGemini({userMessage:'hi'}));assert.equal(breaker.snapshot().active,0);}
    const settings={groqKey:'g'};Object.defineProperty(settings,'generationProfiles',{get(){throw Error('settings private error');}});
    const backup=createGroq({clock,http:{post:async()=>groq()},config:()=>({}),persona:()=>settings,breaker});
    for(let n=0;n<4;n++){await assert.rejects(backup.callGroq({generationProfile:'router',userMessage:'hi'}));assert.equal(breaker.snapshot().active,0);}
});
test('public result stays typed on config failure and rejects undeclared/malformed tool proposals',async()=>{
    const broken=createAiAdapter({clock:new FakeClock(),config:()=>{throw Error('private config');},http:{post:async()=>{throw Error('no request');}}});assert.equal((await broken.generate(request())).ok,false);
    for(const call of [{name:'unauthorized',args:{}},{name:'lookup',args:{id:'bad'}}]){const h=harness(async()=>({data:{candidates:[{content:{parts:[{functionCall:call}]}}]}}),{GEMINI_API_KEY:['a']});const result=await h.api.generate(request({task:'agent',tools:[{name:'lookup',parameters:{type:'object',properties:{id:{type:'integer'}},required:['id']}}]}));assert.equal(result.ok,false);assert.equal(result.failure.kind,'bad_output');}
});
