'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const intent = {};
const voiceRequests = {};
const contentIntent = {};
const from = 'sender@s.whatsapp.net';
const group = '120363315296139888@g.us';
const logger = { info() {}, warn() {}, error() {} };

function load(file, deps) {
    deps = { './aiFailure': require('../src/services/aiFailure'), './semanticRouting': require('../src/services/semanticRouting'), '../services/semanticRouting': require('../src/services/semanticRouting'), '../services/operationFeedback': require('../src/services/operationFeedback'), ...deps };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
        module, exports: module.exports, Date, Map, Set, Buffer, process: { env: {} },
        require(id) { if (!(id in deps)) throw Error('Import sin mock: ' + id); return deps[id]; }
    });
    return module.exports;
}

function harness({ authorized = true, failDownload = false, failSend = false, failConfirmation = false, relayText = null } = {}) {
    const sent = [], notices = [], downloads = [], scripts = [], synthesis = [], files = [], cleaned = [], relayRequests = [];
    const evolution = {
        sendRecording: async () => {},
        sendText: async (jid, text) => { if (failConfirmation) throw Error('confirmation failed'); notices.push({ jid, text }); },
        getGroupInfo: async () => ({ participants: [] }),
        downloadMedia: async (data, opts) => {
            downloads.push({ data, opts });
            if (failDownload) throw Object.assign(Error('El archivo expiró y no se pudo descargar'), {code:'MEDIA_UNAVAILABLE'});
            return { buffer: Buffer.from('original-media'), extension: data.messageType === 'audioMessage' ? 'ogg' : 'jpg' };
        },
        sendVoiceNote: async (jid, file, opts) => {
            if (failSend) throw Error('delivery failed');
            files.push(file);
            sent.push({ jid, opts, bytes: file === '/tmp/fake-tts' ? 'generated' : fs.readFileSync(file, 'utf8') });
            return { data: { key: { id: 'generated-id', remoteJid: jid, fromMe: true }, message: { audioMessage: { mimetype: 'audio/ogg', url: 'https://fake.invalid/media', ptt: true } } } };
        },
        sendMedia: async (jid, file, caption, document, hd, delay, name) => {
            if (failSend) throw Error('delivery failed');
            files.push(file); sent.push({ jid, caption, document, name, bytes: fs.readFileSync(file, 'utf8') });
        }
    };
    const auth = { isAuthorizedAdmin: () => authorized, getSenderJid: (chat, data) => data.key?.participant || chat };
    const contacts = [{ jid: 'fer1@s.whatsapp.net', user_name: 'Fernando' }, { jid: 'fer2@s.whatsapp.net', user_name: 'Fernanda' }];
    const message = load('commands/mensaje.js', {
        '../services/evolution': evolution, '../core/auth': auth, '../services/logger': logger,
        '../services/db': { db: { all: (_, params, done) => done(null, contacts) } },
        '../services/ai': { callGemini: async input => { relayRequests.push(input); if (relayText) return relayText; throw Error('No text relay needed'); }, callGroq: async () => null }
    });
    const attachments = load('services/attachmentContext.js', {
        '../utils/contentIntent': contentIntent, '../utils/mediaDeliveryRequest': intent
    });
    const delivery = load('services/outboundDelivery.js', { './evolution': evolution, './logger': logger, '../core/auth': auth, '../commands/mensaje': message });
    const media = load('commands/enviarmedia.js', {
        'node:fs/promises': require('node:fs/promises'), 'node:os': require('node:os'), 'node:path': path,
        '../services/evolution': evolution, '../services/logger': logger, './mensaje': message,
        '../utils/mediaDeliveryRequest': intent, '../services/outboundDelivery': delivery
    });
    const voice = load('commands/voz.js', {
        '../services/outboundDelivery': delivery, '../services/logger': logger, '../services/evolution': evolution, '../utils/voiceRequest': voiceRequests,
        '../utils/mediaDeliveryRequest': intent, './mensaje': message, './enviarmedia': media,
        '../services/voiceScript': { prepareVoiceScript: async params => {
            scripts.push(params); return { success: true, text: 'Qué onda, banda. Ya es viernes.', mode: 'compose', voice: 'hombre', durationSeconds: null };
        }, wordCount: text => text.split(' ').length },
        '../services/tts': { generateVoiceNote: async text => { synthesis.push(text); return { filePath: '/tmp/fake-tts', cleanup: async () => cleaned.push(true) }; } },
        '../services/audioDuration': { fitAudioDuration() { throw Error('No duration requested'); } },
        '../services/history': { getHistory: () => [{ role: 'assistant', content: 'Hoy es viernes.' }] },
        '../services/attachmentContext': attachments
    });
    return { media, voice, message, attachments, sent, notices, downloads, scripts, synthesis, files, cleaned, relayRequests };
}

function source(type = 'audioMessage') {
    return { key: { id: 'request-id', remoteJid: from }, messageType: type, quotedStanzaId: 'original-id',
        message: { [type]: { mimetype: type === 'audioMessage' ? 'audio/ogg' : 'image/jpeg', caption: 'Mi foto' } } };
}

const plan = (action,args,raw='Petición natural')=>({raw,semanticDecision:{action,args},aiArgs:args});
const main={destino_scope:'main_group',caption_mode:'none'};

test('Audio nuevo conserva contexto y entrega al grupo elegido por Gemini',async()=>{
    const h=harness();const request='Graba un audio y hazlo llegar a la banda también';const args={destino_scope:'main_group',modo:'compose',instruccion:request};
    const result=await h.voice.handleVoz(plan('voz',args,request),from,{pushName:'Ana'});
    assert.equal(result.success,true);assert.equal(h.sent.length,1);assert.equal(h.sent[0].jid,group);assert.equal(h.scripts[0].request,request);assert.equal(h.scripts[0].isGroup,true);assert.equal(h.cleaned.length,1);
});

test('Audio original citado no se recrea ni pasa por TTS; temporal se borra',async()=>{
    const h=harness();const result=await h.voice.handleVoz(plan('enviarmedia',main,'Mandalo el audio al grupo'),from,source());
    assert.equal(result.success,true);assert.equal(h.sent[0].bytes,'original-media');assert.equal(h.sent[0].jid,group);assert.equal(h.scripts.length,0);assert.equal(h.synthesis.length,0);
    assert.equal(h.downloads[0].data.quotedStanzaId,'original-id');assert.equal(fs.existsSync(h.files[0]),false);
});

test('Foto conserva bytes y caption original sólo si el modelo lo pidió',async()=>{
    const h=harness();await h.media.handleEnviarMedia(plan('enviarmedia',{...main,caption_mode:'original'}),from,source('imageMessage'));
    assert.equal(h.sent[0].bytes,'original-media');assert.equal(h.sent[0].caption,'Mi foto');assert.equal(h.sent[0].jid,group);assert.equal(fs.existsSync(h.files[0]),false);
});

test('Caso de la captura: manda la foto con recado compuesto sin censurar vulgaridades',async()=>{
    const caption='¿Quién fue el puto que dejó su desayuno olvidado?';const h=harness({relayText:caption});
    const request='Manda esta foto al grupo y diles que quien fue el puto que dejo su desayuno olvidado';
    const result=await h.media.handleEnviarMedia(plan('enviarmedia',{...main,caption_mode:'compose',caption:'quién dejó su desayuno olvidado'},request),from,source('imageMessage'));
    assert.equal(result.success,true);assert.equal(h.sent[0].caption,caption);assert.equal(h.sent[0].bytes,'original-media');assert.equal(h.sent[0].jid,group);
});

test('Caption literal con órdenes y voz no altera destinatario, archivo ni contenido',async()=>{
    const h=harness();const text='Manda un audio al grupo con voz de Goku';await h.media.handleEnviarMedia(plan('enviarmedia',{destino_scope:'current_chat',caption_mode:'literal',caption:text},text),from,source('imageMessage'));
    assert.equal(h.sent[0].jid,from);assert.equal(h.sent[0].caption,text);assert.equal(h.synthesis.length,0);
});

test('Permisos se verifican antes de descargar archivos o sintetizar un envío externo',async()=>{
    const h=harness({authorized:false});const photo=await h.media.handleEnviarMedia(plan('enviarmedia',main),from,source('imageMessage'));
    const audio=await h.voice.handleVoz(plan('voz',{destino_scope:'main_group',instruccion:'di hola',modo:'compose'}),from,{});
    assert.equal(photo.status,'denied');assert.equal(audio.status,'denied');assert.equal(h.downloads.length,0);assert.equal(h.synthesis.length,0);
});

test('Chat local admite respuesta sin permisos de administrador y no exige otro destinatario',async()=>{
    const h=harness({authorized:false});const result=await h.media.handleEnviarMedia(plan('enviarmedia',{destino_scope:'current_chat',caption_mode:'none'}),from,source('imageMessage'));
    assert.equal(result.success,true);assert.equal(h.sent[0].jid,from);assert.equal(h.sent[0].caption,'');assert.equal(h.notices.length,0);
});

test('Destino ausente o grupo desconocido no se sustituye por el grupo habitual',async()=>{
    const h=harness();const result=await h.media.handleEnviarMedia(plan('enviarmedia',{caption_mode:'none'},'Manda esto al grupo Trabajo'),from,source('imageMessage'));
    assert.equal(result.needs_clarification,true);assert.equal(h.downloads.length,0);assert.equal(h.sent.length,0);
});

test('Contacto ambiguo conserva archivo y sólo descarga tras elección tipada',async()=>{
    const h=harness();await h.media.handleEnviarMedia(plan('enviarmedia',{destino_scope:'contact',contacto:'Fer',caption_mode:'none'}),from,source('imageMessage'));
    assert.equal(h.downloads.length,0);assert.equal(h.message.getPendingContactContext(from).length,2);
    const result=await h.message.handlePendingContactChoice({from,args:{selection:2}});assert.equal(result.success,true);assert.equal(h.sent[0].jid,'fer2@s.whatsapp.net');assert.equal(h.sent[0].bytes,'original-media');
});

test('Contacto ambiguo conserva el encargo de audio y el historial hasta aclararlo',async()=>{
    const h=harness();await h.voice.handleVoz(plan('voz',{destino_scope:'contact',contacto:'Fer',modo:'compose',instruccion:'manda un audio dando las gracias'}),from,{});
    assert.equal(h.synthesis.length,0);const result=await h.message.handlePendingContactChoice({from,args:{selection:1}});
    assert.equal(result.success,true);assert.equal(h.sent[0].jid,'fer1@s.whatsapp.net');assert.equal(h.scripts[0].history[0].content,'Hoy es viernes.');
});

test('Archivo equivocado o inexistente aclara antes de intentar una entrega',async()=>{
    const h=harness();const result=await h.media.handleEnviarMedia(plan('enviarmedia',{...main,tipo_archivo:'audioMessage'}),from,source('imageMessage'));
    assert.equal(result.needs_clarification,true);assert.equal(h.downloads.length,0);assert.equal(h.sent.length,0);
});

test('Fallo de descarga, envío o generación de caption nunca confirma entrega ni reintenta',async()=>{
    for(const options of [{failDownload:true},{failSend:true},{}]){
        const h=harness(options);const args=Object.keys(options).length?main:{...main,caption_mode:'compose',caption:'explica quién dejó el desayuno'};
        const result=await h.media.handleEnviarMedia(plan('enviarmedia',args),from,source('imageMessage'));
        assert.equal(result.success,false);assert.equal(h.sent.length,0);assert.ok(h.downloads.length<=1);for(const file of h.files)assert.equal(fs.existsSync(file),false);
    }
});

test('Confirmación fallida no repite ni invalida una entrega confirmada',async()=>{
    const h=harness({failConfirmation:true});const result=await h.media.handleEnviarMedia(plan('enviarmedia',main),from,source('imageMessage'));
    assert.equal(result.success,true);assert.equal(h.sent.length,1);assert.equal(result.enviado_al_chat,false);
});

test('Audio generado guarda referencia confirmada y conserva chat origen para reenvío',async()=>{
    const h=harness();await h.voice.handleVoz(plan('voz',{destino_scope:'main_group',instruccion:'di qué onda',modo:'compose'}),from,{});
    const item=h.attachments.resolveAttachment({from,id:'generated-id'}).attachment;assert.equal(item.messageType,'audioMessage');
    const data=h.attachments.attachToMessage(item,{key:{id:'new',remoteJid:from}});assert.equal(data.quotedRemoteJid,group);assert.equal(data.quotedFromMe,true);
});
