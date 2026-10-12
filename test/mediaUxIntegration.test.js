'use strict';

// El flujo real se compone dentro de VMs. Todos los efectos externos están
// simulados: ni .env, BD, claves reales, WhatsApp ni peticiones a modelos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contentIntent = {};
const style = require('../src/services/conversationStyle');
const generation = require('../src/services/generationSettings');
const whatsapp = require('../src/utils/whatsappText');
const { createContentReader } = require('../src/services/contentReader');
const root = path.join(__dirname, '../src');
const logger = { info() {}, warn() {}, error() {}, cmd() {} };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(24)]);

function load(file, deps, env = {}) {
    deps = { './aiFailure': require('../src/services/aiFailure'), './semanticRouting': require('../src/services/semanticRouting'), '../services/semanticRouting': require('../src/services/semanticRouting'), '../services/operationFeedback': require('../src/services/operationFeedback'), ...deps };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
        module, exports: module.exports, process: { env }, Date, Intl, Map, Set, Buffer,
        setTimeout, clearTimeout,
        require(id) { if (!(id in deps)) throw Error('Import sin mock: ' + id); return deps[id]; }
    }, { filename: file });
    return module.exports;
}

function harness({ bytes = PDF, router = { action: 'chat', args: {}, content_intent: 'analysis', uses_attachment: true },
    answer = '# Ejercicio 2\n\n**Resultado:** x = 4', finishReason = 'STOP', failGemini = false, failDownload = false, env = {} } = {}) {
    const delivered = [], downloads = [], requests = [], commands = [], planned = [], history = [];
    const historyApi = {
        addMessage(chat, role, content) { history.push({ chat, role, content }); },
        getHistory(chat) { return history.filter(item => item.chat === chat).slice(-8); }
    };
    const evolution = load('services/evolution.js', {
        dotenv: { config() {} }, fs, path,
        '../services/logger': logger, './history': historyApi, '../utils/whatsappText': whatsapp,
        axios: { create: () => ({ post: async (url, payload, options) => {
            if (url.includes('getBase64')) {
                downloads.push({ payload, options });
                if (failDownload) throw Object.assign(Error('download expired'), { response: { status: 400 } });
                return { data: { base64: bytes.toString('base64') } };
            }
            if (url.includes('sendText')) {
                delivered.push(payload);
                return { data: { key: { id: 'sent-' + delivered.length } } };
            }
            return { data: {} };
        } }) }
    }, { EVOLUTION_API_URL: 'https://fake.invalid', EVOLUTION_API_KEY: 'test', EVOLUTION_INSTANCE: 'test' });
    const ai = load('services/ai.js', {
        https: { Agent: class {} }, './logger': logger, './scheduler': { registerTask() {} },
        './aiConfig': { getAiConfig: () => ({}) }, './conversationStyle': style,
        './generationSettings': generation, './semanticRouting': require('../src/services/semanticRouting'), '../utils/mediaDeliveryRequest': {}, '../utils/contentIntent': contentIntent, '../utils/voiceRequest': {},
        axios: { post: async (url, payload) => {
            requests.push({ url, payload });
            if (failGemini && url.includes('googleapis')) throw Object.assign(Error('failed vision'), { response: { status: 400 } });
            const input = payload.generationConfig?.responseMimeType ? JSON.parse(payload.contents[0].parts[0].text) : null;
            const output = input ? (typeof router === 'function' ? router(input) : { addressed_to_bot: true, ...router,
                attachment_id: router.attachment_id || (router.uses_attachment && input.contexto.ADJUNTOS_DISPONIBLES.length ? input.contexto.ADJUNTOS_DISPONIBLES.at(-1).id : null) }) : null;
            const text = input ? JSON.stringify(output) : answer;
            return url.includes('googleapis')
                ? { data: { candidates: [{ finishReason: payload.generationConfig?.responseMimeType ? 'STOP' : finishReason, content: { parts: [{ text }] } }] } }
                : { data: { choices: [{ finish_reason: finishReason === 'MAX_TOKENS' ? 'length' : 'stop', message: { content: payload.response_format ? JSON.stringify(typeof router === 'function' ? router(JSON.parse(payload.messages.at(-1).content)) : { addressed_to_bot:true,...router,attachment_id:router.uses_attachment ? JSON.parse(payload.messages.at(-1).content).contexto.ADJUNTOS_DISPONIBLES.at(-1)?.id : router.attachment_id || null }) : answer } }] } };
        } }
    }, { GEMINI_API_KEY: 'fake-test', GROQ_API_KEY: 'fake-test' });
    const context = load('services/attachmentContext.js', { '../utils/mediaDeliveryRequest': {}, '../utils/contentIntent': contentIntent });
    const normalizer = load('core/message_normalizer.js', {
        '../services/logger': logger, '../services/scheduler': { registerTask() {} },
        '../utils/mediaDeliveryRequest': {}, '../utils/contentIntent': contentIntent, '../services/attachmentContext': context,
        '../commands/documentos': { hasActiveSession: () => false },
        '../commands/buscar': { hasActiveSearchSession: () => false, getSessionKey: from => from },
        '../commands/mensaje': { hasPendingContactChoice: () => false },
        '../commands/ruleta': { hasActiveRouletteLobby: () => false },
        '../commands/blackjack': { hasActiveBlackjackGame: () => false, hasActiveBlackjackTableLobby: () => false, hasActiveBlackjackTablePlaying: () => false }
    });
    const reader = createContentReader({ downloadMedia: evolution.downloadMedia, execFile: async () => ({ stdout: 'Pages: 3\nEncrypted: no\n' }) });
    const source = fs.readFileSync(path.join(root, 'core/dispatcher.js'), 'utf8');
    const deps = Object.fromEntries([...source.matchAll(/require\('([^']+)'\)/g)].map(match => [match[1], {}]));
    Object.assign(deps, {
        '../services/logger': logger, '../services/scheduler': { registerTask() {} },
        '../core/parser': require('../src/core/parser'), '../core/queue': { add: async (_, fn) => fn() },
        './auth': { isAuthorizedAdmin: () => true, getSenderJid: (from, data) => data?.key?.participant || from, cleanJidNumber: jid => jid.split('@')[0], normalizePhoneNumber: value => value },
        '../services/evolution': evolution, '../services/ai': ai, '../services/history': historyApi,
        '../services/contentReader': reader, '../utils/mediaDeliveryRequest': {}, '../utils/contentIntent': contentIntent, '../utils/voiceRequest': {},
        '../commands/descargar': { getSearchSession: () => null, getDownloadSessionKey: from => from, matchSelection: () => null },
        '../services/attachmentContext': context, '../services/semanticRouting': require('../src/services/semanticRouting'), '../services/operationFeedback': require('../src/services/operationFeedback'), '../commands/buscar': {},
        '../commands/mensaje': { getPendingContactContext: () => [], handlePendingContactChoice: async () => ({ consumed: false }) },
        '../services/db': { getUserAffinityContext: async () => '' },
        '../services/proactive': { recordGroupActivity() {} },
        '../services/agentEngine': { runUniversalAgent: async args => { planned.push(args); throw Error('El adjunto no debe ejecutar herramientas'); } },
        './commandRegistry': { isRegisteredCommand: command => ['convertir', 'sticker', 'doc', 'tarea', 'voz', 'enviarmedia'].includes(command), getCommandHandler: async (command, args) => ({ handler: async () => commands.push({ command, ...args }) }) }
    });
    const dispatcher = load('core/dispatcher.js', deps, env);
    let counter = 0;
    function media({ type = 'documentMessage', caption = '', fileName = 'clase.pdf', mimetype = 'application/pdf', from = 'student@s.whatsapp.net', participant } = {}) {
        return { key: { id: 'file-' + (++counter), remoteJid: from, participant }, pushName: 'Ana', message: { [type]: { caption, fileName, mimetype, mediaKey: Object.fromEntries(Array.from({ length: 32 }, (_, index) => [index, index])), fileLength: { low: bytes.length, high: 0, unsigned: true } } } };
    }
    function text(text, { from = 'student@s.whatsapp.net', participant } = {}) {
        return { key: { id: 'follow-' + (++counter), remoteJid: from, participant }, pushName: 'Ana', message: { conversation: text } };
    }
    async function dispatchNormalized(norm) {
        return dispatcher.dispatch({ ...norm, messageType: norm.actualMessageType, messageData: norm.actualMessageData });
    }
    return { setRouter(value) { router = value; }, ai, evolution, context, normalize: normalizer.normalizeIncomingMessage, delivered, downloads, requests, commands, planned, history, media, text,
        dispatch: async data => dispatchNormalized(normalizer.normalizeIncomingMessage(data)), dispatchNormalized };
}


test('PDF: Gemini clasifica antes de descargar; redactor recibe PDF nativo completo', async () => {
    const h = harness(); await h.dispatch(h.media({caption:'Resuelve el ejercicio 2'}));
    assert.equal(h.commands.length,0); assert.equal(h.planned.length,0); assert.equal(h.requests.length,2);
    assert.ok(h.requests[0].payload.contents[0].parts.every(part=>!part.inlineData));
    assert.equal(h.requests[1].payload.contents[0].parts[0].inlineData.mimeType,'application/pdf');
    assert.equal(h.requests[1].payload.generationConfig.maxOutputTokens,8192);
    assert.match(h.delivered[0].text,/\*Resultado:\* x = 4/);
    const context=JSON.parse(h.requests[0].payload.contents[0].parts[0].text).contexto;
    assert.ok(!JSON.stringify(context).includes('mediaKey')); assert.equal(context.ADJUNTOS_DISPONIBLES[0].id,'file-1');
});

test('Cualquier paráfrasis llega al modelo una vez y su plan no se sustituye por palabras clave', async () => {
    for(const request of ['Que la banda vea esto, porfa','Hazles llegar lo que te pasé','Compártelo allá y pregunta quién dejó su desayuno','Manda esta foto al grupo y diles que quien fue el puto que dejo su desayuno olvidado']) {
        const h=harness({bytes:PNG,router:{action:'enviarmedia',uses_attachment:true,args:{destino_scope:'main_group',caption_mode:'compose',caption:'quién dejó su desayuno'}}});
        h.normalize(h.media({type:'imageMessage',mimetype:'image/png'})); await h.dispatch(h.text(request));
        assert.equal(h.requests.length,1); assert.equal(h.commands[0].command,'enviarmedia');
        assert.equal(h.commands[0].parsed.aiArgs.caption,'quién dejó su desayuno'); assert.equal(h.commands[0].messageData.messageType,'imageMessage');
        assert.equal(h.downloads.length,0); assert.equal(h.commands[0].parsed.raw,request);
    }
});

test('Seguimiento en grupo usa el ID elegido y conserva identidad del solicitante', async () => {
    const h=harness();const loc={from:'clase@g.us',participant:'ana@s.whatsapp.net'};
    const original=h.media(loc);h.normalize(original);await h.dispatch(h.text('haz los primeros tres',loc));
    assert.equal(h.downloads[0].payload.message.key.id,original.key.id);assert.equal(h.delivered.length,1);
});

test('Archivos ambiguos preguntan; aclaración semántica conserva encargo y elige sólo un ID autorizado', async () => {
    const h=harness({router:{action:'chat',args:{},needs_clarification:true,question:'¿Cuál archivo uso?'}});
    const first=h.media({fileName:'uno.pdf'}), second=h.media({fileName:'dos.pdf'});h.normalize(first);h.normalize(second);
    await h.dispatch(h.text('resuélvelo')); assert.equal(h.downloads.length,0);assert.match(h.delivered[0].text,/Cuál/);
    h.setRouter({action:'chat',args:{},uses_attachment:true,attachment_id:first.key.id});await h.dispatch(h.text('el que mandé antes del otro'));
    assert.equal(h.downloads[0].payload.message.key.id,first.key.id);
    assert.match(h.requests.at(-1).payload.contents.at(-1).parts.at(-1).text,/resuélvelo/);
});

test('ID inventado o archivo de otro remitente se rechaza antes de descargar', async () => {
    const h=harness({router:{action:'enviarmedia',args:{destino_scope:'main_group',caption_mode:'none'},attachment_id:'other-file'}});
    h.normalize(h.media());await h.dispatch(h.text('mándalo'));assert.equal(h.commands.length,0);assert.equal(h.downloads.length,0);assert.match(h.delivered[0].text,/identificado/);
    const state=h.context.getAttachmentState({from:'another@s.whatsapp.net'});assert.equal(state.attachments.length,0);
});

test('Petición pendiente sólo se guarda cuando Gemini declara que falta el adjunto', async () => {
    const h=harness({router:{action:'chat',args:{},needs_clarification:true,awaiting_attachment:true,question:'Pásame el PDF'}});
    await h.dispatch(h.text('ayúdame con el archivo que te voy a pasar'));h.setRouter({action:'chat',args:{},uses_attachment:true});
    const incoming=h.media();const norm=h.normalize(incoming);assert.equal(norm.text,'ayúdame con el archivo que te voy a pasar');await h.dispatchNormalized(norm);
    assert.equal(h.downloads.length,1);
});

test('Saludo, matemáticas y QR con texto no heredan un archivo aunque exista contexto reciente', async () => {
    for(const request of ['hola','resuelve 2 + 2','recomiéndame un PDF']) {
        const h=harness({router:{action:'chat',args:{},uses_attachment:false}});h.normalize(h.media());await h.dispatch(h.text(request));
        assert.equal(h.downloads.length,0);assert.equal(h.requests.length,2);assert.ok(h.requests[1].payload.contents[0].parts.every(part=>!part.inlineData));
    }
});

test('Subir un video o imagen sin encargo requiere aclaración y jamás conversión automática', async () => {
    for(const type of ['videoMessage','imageMessage']) {
        const h=harness({router:{action:'chat',args:{},needs_clarification:true,question:'¿Qué necesitas con este archivo?'}});
        await h.dispatch(h.media({type,caption:''}));assert.equal(h.commands.length,0);assert.equal(h.downloads.length,0);assert.equal(h.requests.length,1);
    }
});

test('Preguntas, negaciones y palabras de herramientas conservan chat si el modelo así decide', async () => {
    for(const request of ['¿Cuánto cuesta la nuclear?','No conviertas esto, explícame la tabla','¿Qué significa guardar una nota?','Busca qué quiere decir el verbo descargar']) {
        const h=harness({router:{action:'chat',args:{},uses_attachment:false}});await h.dispatch(h.text(request));assert.equal(h.commands.length,0);assert.equal(h.planned.length,0);
    }
});

test('La acción estructurada gana aunque la frase contenga audio, difusión, video o nuclear', async () => {
    const h=harness({router:{action:'enviarmedia',uses_attachment:true,args:{destino_scope:'current_chat',caption_mode:'literal',caption:'manda un audio al grupo nuclear'}}});
    await h.dispatch(h.media({type:'imageMessage',caption:'Manda la imagen con este mensaje: manda un audio al grupo nuclear',mimetype:'image/png'}));
    assert.equal(h.commands[0].command,'enviarmedia');assert.equal(h.commands[0].parsed.aiArgs.destino_scope,'current_chat');assert.equal(h.commands[0].messageData.messageType,'imageMessage');
});

test('Fallo de los dos modelos no dispara descarga ni ejecuta el primer término como comando', async () => {
    const h=harness({router:null,failGemini:true});await h.dispatch(h.text('descargar https://youtube.com/watch?v=abc'));
    assert.equal(h.commands.length,0);assert.equal(h.downloads.length,0);assert.match(h.delivered[0].text,/IA no está disponible/);
});

test('Grupo pasivo: el modelo decide ignorar y no prepara ni descarga contenido', async () => {
    const h=harness({router:{action:'ignore',args:{},addressed_to_bot:false}});
    await h.dispatch(h.media({caption:'resuelve tú lo del profe',from:'clase@g.us',participant:'ana@s.whatsapp.net'}));
    assert.equal(h.downloads.length,0);assert.equal(h.delivered.length,0);assert.equal(h.commands.length,0);
});

test('Whitelist impide incluso clasificar una solicitud de un chat no autorizado', async () => {
    const h=harness({env:{ALLOWED_NUMBERS_NORMAL:'1234'}});await h.dispatch(h.media());assert.equal(h.requests.length,0);assert.equal(h.downloads.length,0);
});

test('La misma frase se interpreta de nuevo si cambian adjuntos e historial; no hay caché de intención', async () => {
    const h=harness({router:{action:'chat',args:{},uses_attachment:true}});await h.dispatch(h.media({caption:'hazlo'}));await h.dispatch(h.media({caption:'hazlo',fileName:'otra.pdf'}));
    assert.equal(h.requests.filter(item=>item.payload.generationConfig?.responseMimeType).length,2);assert.equal(h.downloads.length,2);
});

test('Descarga fallida detiene lectura sin inventar respuesta, con una sola clasificación', async () => {
    const h=harness({failDownload:true});await h.dispatch(h.media({caption:'resuelve'}));assert.equal(h.requests.length,1);assert.equal(h.delivered.length,1);assert.ok(!h.delivered[0].text.includes('x = 4'));
});

test('Respuesta incompleta avisa y mantiene formato de WhatsApp', async () => {
    const h=harness({finishReason:'MAX_TOKENS',answer:'**Paso 1:** Resultado parcial'});await h.dispatch(h.media({caption:'resuelve'}));
    assert.match(h.delivered.map(x=>x.text).join(' '),/faltó|pendiente|completa|incomplet|alcanz|límite/);
});

test('Conversión desde URL no exige un adjunto inexistente',async()=>{
    const h=harness({router:{action:'convertir',args:{url:'https://example.invalid/video.mp4',formato:'mp3'},uses_attachment:false}});
    await h.dispatch(h.text('Necesito el sonido de ese enlace'));
    assert.equal(h.commands[0].command,'convertir');assert.equal(h.commands[0].parsed.flags.f,'mp3');assert.equal(h.downloads.length,0);
});

test('JSON de envío incompleto se repara una sola vez por Gemini; no se interpreta localmente',async()=>{
    let count=0;const h=harness({router:()=>++count===1?{action:'enviarmedia',args:{},addressed_to_bot:true}:
        {action:'enviarmedia',args:{destino_scope:'main_group',caption_mode:'none'},attachment_id:'file-1',addressed_to_bot:true}});
    h.normalize(h.media());await h.dispatch(h.text('Hazles llegar eso'));
    assert.equal(count,2);assert.equal(h.commands[0].command,'enviarmedia');assert.equal(h.requests.length,2);
    const repair=JSON.parse(h.requests[1].payload.contents[0].parts[0].text);assert.ok(repair.errores_de_esquema.includes('args.destino_scope requerido'));
});
