'use strict';
// Importing this module performs no IO. Startup explicitly constructs the service.
const path=require('node:path');
const {SystemClock}=require('../v2/platform/clock');
const {normalizeJid}=require('../v2/domain/jid');
const {createCanaryOwner}=require('../v2/composition/canary');

function messageText(data){
    let message=data?.message;
    for(let i=0;i<8&&message&&typeof message==='object';i++){
        const wrapper=message.ephemeralMessage||message.viewOnceMessage||message.viewOnceMessageV2||message.documentWithCaptionMessage;
        if(!wrapper?.message)break;message=wrapper.message;
    }
    if(!message||typeof message!=='object')return{ text:'',media:false,quoted:false };
    let text=typeof message.conversation==='string'?message.conversation:typeof message.extendedTextMessage?.text==='string'?message.extendedTextMessage.text:'';
    let media=false;
    for(const name of ['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage']){
        if(!message[name])continue;media=true;
        if(typeof message[name].caption==='string')text=message[name].caption;
    }
    const context=message.extendedTextMessage?.contextInfo||message.imageMessage?.contextInfo||message.videoMessage?.contextInfo||message.documentMessage?.contextInfo;
    return{text,media,quoted:!!context?.stanzaId};
}

function createPhase4Service({root,clock=new SystemClock(),buildGraph,logger={info(){},error(){}}}){
    if(typeof root!=='string'||!path.isAbsolute(root))throw new TypeError('Explicit project root required');
    let graph,owner,closed=false,closing;
    const enabled=new Set();
    const counters={handled:0,replies:0,errors:0,denied:0,ignored:0};
    function eligible(raw){
        const {text,media,quoted}=messageText(raw);const clean=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        if(!clean.trim())return false;
        // Literal QR contents cannot change the selected feature or destination.
        if(enabled.has('qr')&&!media&&!quoted&&/^(?:(?:botsky|botsito)[,:]?\s+)?qr(?:\s+|$)/u.test(clean.trim()))return true;
        // Until later waves are ported, requests naming their domain stay with v1.
        if(/\b(?:minecraft|maicra|recordatorios?|notas?|tareas?|escuela|ruleta|blackjack|daily|niveles?|xp|cooperacha|packs?|nopor|terminal|sistema|drive|difusion|encuesta|airdrop)\b/.test(clean))return false;
        if(/--(?:to|destino|para)\b/.test(clean))return false;
        const matches={help:/\b(?:ayuda|help)\b/, 'system-info':/\b(?:estado|estadobot|status)\b/,
            qr:/\bqr\b/,documents:/\b(?:leer|ocr|convertir|conversion|comprimir|recortar|recortarpdf|unirpdf|pdf2img|pdf|doc)\b/,
            sticker:/\b(?:sticker|stickers|calca|efecto)\b/,voice:/\b(?:voz|tts)\b/,
            transcription:/\b(?:transcribir|transcribe|transcripcion)\b/};
        // QR reading/quoted media keeps its existing owner until attachment workflows are ported.
        if(/\bqr\b/.test(clean)&&(media||quoted||/\b(?:leer|lee|leeme|escanea|decodifica)\b/.test(clean)))return false;
        return [...enabled].some(feature=>matches[feature]?.test(clean));
    }
    async function initialize(config){
        if(config.PIPELINE_MODE!=='canary'){
            if(config.PIPELINE_MODE==='v2')throw new Error('Full cutover requires the remaining feature gates');
            return{enabled:false};
        }
        const chats=Array.isArray(config.V2_CANARY_CHAT_IDS)?config.V2_CANARY_CHAT_IDS:[];
        if(!chats.length||chats.some(value=>!normalizeJid(value)||normalizeJid(value).endsWith('@g.us')))throw new Error('First canary requires explicit private chat IDs');
        const features=config.V2_CANARY_FEATURES||['qr','help','system-info'];
        if(!Array.isArray(features)||!features.length||features.some(value=>!['qr','help','system-info','documents','sticker','voice','transcription'].includes(value)))throw new Error('Explicit supported canary features required');
        if(graph||closed)throw new Error('Canary lifecycle already initialized or closed');
        for(const feature of features)enabled.add(feature);
        const factory=buildGraph||defaultGraph;
        graph=await factory({config,clock,root});
        owner=createCanaryOwner({mode:'canary',canaryChatIds:chats,clock,isEligibleWaveA:eligible,
            legacy:async()=>undefined,pipeline:raw=>graph.app.pipeline.handle(raw)});
        logger.info('[V2] Private media canary initialized. Legacy remains owner of other events and all business jobs.');
        return{enabled:true,canaryChats:chats.length};
    }
    async function tryHandle(raw){
        if(!owner)return false;
        if(closed)return owner.shouldHandle(raw).owner==='pipeline';
        // Decide once: a changing session window cannot silently drop an event.
        try{
            const handled=await owner.dispatch(raw);
            if(handled.owner!=='pipeline')return false;
            counters.handled++;
            const kind=handled.result?.kind;
            if(kind==='reply')counters.replies++;
            else if(kind==='error')counters.errors++;
            else if(kind==='denied')counters.denied++;
            else if(kind==='ignore')counters.ignored++;
            return true;
        }
        catch{counters.handled++;counters.errors++;logger.error('[V2] Owned request failed; no legacy replay.');return true;}
    }
    function dispose(){
        if(closing)return closing;closed=true;
        const owned=owner?.close()||Promise.resolve();
        const application=graph?.dispose()||Promise.resolve();
        closing=Promise.allSettled([owned,application]).then(results=>{
            enabled.clear();const error=results.find(value=>value.status==='rejected');if(error)throw error.reason;
        });return closing;
    }
    return{initialize,tryHandle,dispose,get status(){return{enabled:!!owner&&!closed,mode:owner?'canary':'legacy',canaryChats:owner?.readiness.canaryChatCount||0,features:[...enabled],counters:{...counters}};}};
}

async function defaultGraph({config,clock,root}){
    const axios=require('axios');const FormData=require('form-data');
    const {createClient}=require('../v2/adapters/evolution');
    const {createAiAdapter}=require('../v2/adapters/ai');
    const {createElevenLabsMedia}=require('../v2/adapters/media/elevenLabs');
    const {createRuntime}=require('../v2/composition/runtime');
    const http={get:(url,options)=>axios.get(url,options),post:(url,payload,options)=>axios.post(url,payload,options)};
    const client=createClient({baseUrl:String(config.EVOLUTION_API_URL),apiKey:String(config.EVOLUTION_API_KEY),clock});
    const llm=createAiAdapter({config:()=>config,clock,http});
    const elevenLabsMedia=createElevenLabsMedia({http,config:{elevenLabsApiKey:String(config.ELEVENLABS_API_KEY||'')},clock});
    const elevenLabs=async(text,voice,signal)=>(await elevenLabsMedia.generateAudio(text,voice,signal)).buffer;
    const stateDirectory=path.join(path.resolve(root,String(config.DATA_DIR||'data')),'v2');
    return createRuntime({config,clock,evolutionHttp:client,llm,http,formData:()=>new FormData(),elevenLabs,
        sidecarDbFilename:path.join(stateDirectory,'canary.db'),backupPath:path.join(stateDirectory,'backups',`before-${clock.now()}.db`)});
}
module.exports={createPhase4Service,messageText,defaultGraph};
