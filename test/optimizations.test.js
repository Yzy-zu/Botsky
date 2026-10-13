'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {harness,loadModule,gemini,groq}=require('./aiOfflineHarness.test');
const logger={info(){},warn(){},error(){},cmd(){}};
function downloadHarness(){return loadModule('commands/descargar.js',{
    fs:{mkdirSync(){},existsSync:()=>false},path,'../core/parser':loadModule('core/parser.js',{}),
    '../services/evolution':{sendText:async()=>{},sendMedia:async()=>{}},'../services/logger':logger,
    '../services/progress':{Progress:class{async start(){}async done(){}},spawnWithProgress:async()=>{throw Error('Unexpected download');}},
    '../services/drive':{},'../services/mediaSearch':{searchMedia:async()=>({status:'success',items:[{url:'https://youtube.com/watch?v=fake',title:'long video',duration:'1h',secs:3600}]})},'../services/operationFeedback':{},'../utils/thumbnailCollage':{}
});}
test('Groq Circuit Breaker: cooldown rechaza de forma tipada sin transporte',async()=>{
    const h=harness();h.ai.markGroqCooldown(60000);assert.equal(h.ai.isGroqAvailable(),false);
    await assert.rejects(h.ai.callGroq({userMessage:'hola'}),error=>error.diagnostic.kind==='provider_unavailable');assert.equal(h.calls.length,0);
    h.ai._resetGroqCircuitBreaker();assert.equal(h.ai.isGroqAvailable(),true);
});
test('Descargar: calidad 480p por defecto sin límites de corte/peso arbitrarios retirados',async()=>{
    const api=downloadHarness();await api.handleDescargar({args:['video largo'],flags:{}},'offline@s.whatsapp.net',{});const session=api.getSearchSession(api.getDownloadSessionKey('offline@s.whatsapp.net',{}));assert.equal(session.quality,'480');assert.equal(session.results.length,1,'Conservar video de una hora');const args=api.buildArgs('https://youtube.com/watch?v=fake','mp4',session.quality,false,'/tmp/out');
    assert.match(args.join(' '),/480/);assert.ok(!args.includes('--max-filesize'));assert.ok(!args.join(' ').includes('00:05:00'));assert.ok(!args.join(' ').includes('filesize<?10M'));
});
test('Gatekeeper: ingesta pasiva conserva historial y decisión semántica de silencio',async()=>{
    const source=fs.readFileSync(path.join(__dirname,'../src/core/dispatcher.js'),'utf8');const history=[],sent=[],requests=[];
    const deps=Object.fromEntries([...source.matchAll(/require\('([^']+)'\)/g)].map(m=>[m[1],{}]));
    Object.assign(deps,{'../core/parser':loadModule('core/parser.js',{}),'../services/scheduler':{registerTask(){}},'../services/logger':logger,
        '../services/evolution':{sendText:async(...args)=>sent.push(args),sendTyping:async()=>{}},'../services/history':{getHistory:()=>history,addMessage:(chat,role,content)=>history.push({chat,role,content})},
        '../services/ai':{routeWithAIOutcome:async text=>{requests.push(text);return{ok:true,decision:{action:'ignore',args:{},addressed_to_bot:false}};}},
        '../services/db':{getUserAffinityContext:async()=>''},'../services/proactive':{recordGroupActivity(){}},'../commands/mensaje':{getPendingContactContext:()=>[]},
        '../commands/cooperacha':{hasActiveCooperacha:()=>false},'../commands/buscar':{getSearchContext:()=>[]},'../services/attachmentContext':{getAttachmentState:()=>({attachments:[],activeId:null,pendingRequest:null}),clearPendingRequest(){}},
        '../services/semanticRouting':loadModule('services/semanticRouting.js',{}),'../services/operationFeedback':loadModule('services/operationFeedback.js',{}),
        './auth':loadModule('core/auth.js',{}),'./commandRegistry':{isRegisteredCommand:()=>false}});
    const dispatch=loadModule('core/dispatcher.js',deps,{env:{ALLOWED_GROUPS_NORMAL:'offline'}}).dispatch;
    await dispatch({from:'offline@g.us',text:'jajaja qué calor',messageType:'conversation',messageData:{key:{id:'passive',participant:'19995550001@s.whatsapp.net'}}});
    assert.equal(history.length,1);assert.match(history[0].content,/jajaja qué calor/);assert.equal(requests.length,1);assert.equal(sent.length,0);
});
test('Descargar: enlace de foto TikTok se ignora sin ejecutar descargas',async()=>{
    const api=downloadHarness();await api.handleDescargar({flags:{},args:['https://www.tiktok.com/@offline/photo/123']},'offline@s.whatsapp.net',{key:{id:'photo'}});
});
test('IA: modelo/respaldo/timeout configurados se verifican en HTTP sin regex sobre fuente',async()=>{
    const h=harness({env:{GEMINI_API_KEY:'offline-gemini-key',GROQ_API_KEY:'offline-groq-key',GEMINI_TIMEOUT_MS:'3000',GROQ_MODEL:'openai/gpt-oss-20b'},post:async url=>url.includes('googleapis')?gemini('ok'):groq('backup')});
    await h.ai.callGemini({userMessage:'hola'});assert.equal(h.calls[0][2].timeout,3000);
    await h.ai.callGemini({userMessage:'leer',media:{mimeType:'image/jpeg',data:'aW1n'}});assert.equal(h.calls[1][2].timeout,35000);
    await h.ai.callGroq({userMessage:'hola'});assert.equal(h.calls[2][1].model,'openai/gpt-oss-20b');assert.equal(h.calls[2][1].max_completion_tokens,300);
    h.http.post=async()=>{throw Object.assign(Error('too large'),{response:{status:413}});};await assert.rejects(h.ai.callGroq({userMessage:'large'}));assert.equal(h.ai.isGroqAvailable(),false);
});
