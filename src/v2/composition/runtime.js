// @ts-check
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { normalizeJid } = require('../domain/jid');
const { createDb } = require('../adapters/store/sqlite');
const { migrate } = require('../adapters/store/migrations');
const { legacyMigration } = require('../adapters/store/migrations/000-legacy');
const { threadConversationMigration } = require('../adapters/store/migrations/001-thread-conversation');
const { createConversationRepo } = require('../adapters/store/repos/conversation');
const { createThreadConversationRepo } = require('../adapters/store/repos/threadConversation');
const { TtlStore } = require('../platform/ttlStore');
const { EchoGuard } = require('../adapters/evolution/echoGuard');
const { createEvolutionAdapter } = require('../adapters/evolution');
const { createMediaServices } = require('./media');
const { createApplication } = require('../main');

const SENT_ID_TTL_MS = 24 * 60 * 60 * 1000;
const MEDIA_CLEANUP_INTERVAL_MS = 60 * 1000;
const RETURNED_MEDIA_TTL_MS = 10 * 60 * 1000;

/** @param {string} filename @param {string} backupPath */
function validatePaths(filename, backupPath) {
    if (!path.isAbsolute(filename) || !path.isAbsolute(backupPath)) throw new TypeError('Runtime SQLite paths must be absolute');
    const resolved = path.resolve(filename), backup = path.resolve(backupPath);
    if (resolved === backup || path.basename(resolved).toLowerCase() === 'bot.db') throw new TypeError('Runtime sidecar must be separate from bot.db and its backup');
}

/** @param {string} directory */
async function ensurePrivateDirectory(directory) {
    if (directory === path.parse(directory).root || directory === os.tmpdir()) throw new TypeError('Runtime state requires a dedicated private directory');
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const stat=await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o002) !== 0 || await fs.realpath(directory)!==path.resolve(directory)) throw new TypeError('Runtime state directory must not be shared or symlinked');
    await fs.chmod(directory,0o700);
}

/** @param {unknown} values @param {'s.whatsapp.net'|'g.us'} defaultDomain */
function normalizeConfiguredJids(values,defaultDomain) {
    if (values === undefined) return [];
    if (!Array.isArray(values)) throw new TypeError('Runtime allowlists must be arrays');
    return [...new Set(values.map(value=>{
        if (typeof value !== 'string' || !value.trim() || value.trim() !== value) throw new TypeError('Invalid configured allowlist JID');
        const jid=normalizeJid(value.includes('@')?value:`${value}@${defaultDomain}`);
        if (!jid || (defaultDomain==='g.us' && !jid.endsWith('@g.us')) || (defaultDomain==='s.whatsapp.net' && !jid.endsWith('@s.whatsapp.net'))) throw new TypeError('Invalid configured allowlist JID');
        return jid;
    }))];
}

/** Cache only provider-acknowledged media IDs, never a local file path or content-derived proof.
 * @param {import('../platform/ttlStore').TtlStore} store @param {import('../platform/clock').Clock} clock @param {string} botJid
 * @param {import('../pipeline/contracts').Ctx} ctx @param {import('../domain/types').Reply['parts'][number]} part @param {unknown} delivery */
function rememberDeliveredMedia(store,clock,botJid,ctx,part,delivery) {
    if (part.type==='text'||part.type==='reaction'||part.type==='poll') return false;
    const mediaType=part.type;
    const receipt=/** @type {{messageId?:unknown,data?:{key?:{id?:unknown}}}|null} */ (delivery && typeof delivery==='object'?delivery:null);
    const id=typeof receipt?.messageId==='string'?receipt.messageId:receipt?.data?.key?.id;
    if (typeof id!=='string'||!id||id.trim()!==id||id.length>512||!ctx.event.chatId) return false;
    const fallback={image:'image/jpeg',video:'video/mp4',audio:'audio/ogg',document:'application/octet-stream',sticker:'image/webp'};
    const mime=mediaType==='sticker'?'image/webp':/^[a-z][a-z0-9.+-]*\/[a-z0-9.+-]+$/i.test(part.mime)?part.mime:fallback[mediaType];
    const expected={image:'image/',video:'video/',audio:'audio/',document:'application/',sticker:'image/'};
    if (!mime.toLowerCase().startsWith(expected[mediaType])) return false;
    const attachment={id,chatId:ctx.event.chatId,ownerJid:botJid,expiresAt:clock.now()+RETURNED_MEDIA_TTL_MS,
        ref:`provider-media:${id}`,mime,kind:mediaType,providerKey:{id,remoteJid:ctx.event.chatId,fromMe:true}};
    store.set('pipeline.attachment.id',JSON.stringify([ctx.event.chatId,id]),attachment,RETURNED_MEDIA_TTL_MS);
    return true;
}

/**
 * Build a separate, disposable v2 runtime graph. Calling this function performs
 * the explicit SQLite and directory IO; importing this module performs none.
 * @param {{config:Record<string,any>,clock:import('../platform/clock').Clock,evolutionHttp:import('../adapters/evolution/client').HttpClient,llm:import('../domain/ports').LLM,http:import('../adapters/media/transcription').TranscriptionAdapterOptions['http'],formData:import('../adapters/media/transcription').TranscriptionAdapterOptions['formData'],sidecarDbFilename:string,backupPath:string,logger?:{info:(message:string)=>void,warn:(message:string)=>void}}} options
 */
async function createRuntime({config,clock,evolutionHttp,llm,http,formData,sidecarDbFilename,backupPath,logger={info(){},warn(){}}}) {
    if (!config || typeof config !== 'object' || !clock || !evolutionHttp || !llm || !http || typeof formData !== 'function') throw new TypeError('Validated runtime dependencies are required');
    const botJid = normalizeJid(String(config.BOT_NUMBER || '').includes('@') ? String(config.BOT_NUMBER) : `${String(config.BOT_NUMBER || '')}@s.whatsapp.net`);
    if (!botJid) throw new TypeError('A valid configured BOT_NUMBER is required');
    const privateNumbers=normalizeConfiguredJids([...(config.ALLOWED_NUMBERS_NORMAL || []),...(config.ALLOWED_NUMBERS_ADMIN || []),...(config.ALLOWED_NUMBERS_TASKS || [])],'s.whatsapp.net');
    const allowedGroups=normalizeConfiguredJids([...(config.ALLOWED_GROUPS_NORMAL || []),...(config.ALLOWED_GROUPS_ADMIN || [])],'g.us');
    validatePaths(sidecarDbFilename,backupPath);

    const dbDirectory = path.dirname(path.resolve(sidecarDbFilename));
    const backupDirectory = path.dirname(path.resolve(backupPath));
    await ensurePrivateDirectory(dbDirectory);
    if (backupDirectory !== dbDirectory) await ensurePrivateDirectory(backupDirectory);
    try {
        const stat=await fs.lstat(path.resolve(sidecarDbFilename));
        if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError('Runtime sidecar must be a regular file');
    } catch (error) {
        if (!(error && typeof error==='object' && 'code' in error && error.code==='ENOENT')) throw error;
    }
    const db = createDb({filename:path.resolve(sidecarDbFilename)});
    /** @type {TtlStore|undefined} */ let echoStore;
    /** @type {TtlStore|undefined} */ let sentStore;
    /** @type {EchoGuard|undefined} */ let echoGuard;
    /** @type {ReturnType<typeof createMediaServices>|undefined} */ let media;
    /** @type {ReturnType<typeof createApplication>|undefined} */ let app;
    /** @type {number|undefined} */ let cleanupTimer;
    /** @type {Promise<void>|undefined} */ let cleanupPromise;
    let disposed = false;
    /** @type {Promise<void>|undefined} */ let disposal;

    try {
        await db.open();
        await fs.chmod(path.resolve(sidecarDbFilename),0o600);
        await migrate(db,{backupPath:path.resolve(backupPath),migrations:[await legacyMigration(),threadConversationMigration()],clock});
        await fs.chmod(path.resolve(sidecarDbFilename),0o600);

        const conversation = createConversationRepo(db,clock);
        const threads = createThreadConversationRepo(db,clock);
        echoStore = new TtlStore({clock,maxEntries:4000});
        sentStore = new TtlStore({clock,maxEntries:10000});
        echoGuard = new EchoGuard({clock,store:echoStore});
        const evolution = createEvolutionAdapter({client:evolutionHttp,instance:String(config.EVOLUTION_INSTANCE || ''),clock,echoGuard,
            io:{readFile:filename=>fs.readFile(filename),stat:filename=>fs.stat(filename)},history:{addMessage(){ }},logger,
            maxFileSizeMb:Number(config.MAX_FILE_SIZE_MB || 64),maxDocumentSizeMb:Number(config.MAX_DOCUMENT_SIZE_MB || 200),
            maxDownloadBytes:Number(config.MAX_FILE_SIZE_MB || 64)*1024*1024});

        media = createMediaServices({config,clock,llm,evolution,http,formData});
        const roles = {admins:normalizeConfiguredJids(config.ALLOWED_NUMBERS_ADMIN || [],'s.whatsapp.net'),owners:[],
            members:normalizeConfiguredJids([...(config.ALLOWED_NUMBERS_NORMAL || []),...(config.ALLOWED_NUMBERS_TASKS || [])],'s.whatsapp.net'),groups:allowedGroups};
        const startedAt = clock.now();
        app = createApplication({clock,botJid,conversation:{recent:conversation.recent,
            recentThread:(chatId,senderJid,quotedId,limit)=>threads.recentThread(chatId,senderJid,quotedId,limit)},
            messenger:evolution,llm,roles,accessSnapshot:{privateNumbers,groups:allowedGroups},sessionGroupRelaxed:config.SESSION_GROUP_RELAXED === true,
            config:{RESPONSE_PRIVATE_MAX_CHARS:Number(config.RESPONSE_PRIVATE_MAX_CHARS ?? 600),
                RESPONSE_GROUP_MAX_CHARS:Number(config.RESPONSE_GROUP_MAX_CHARS ?? 350),
                LLM_CHAT_MAX_OUTPUT_TOKENS:Number(config.LLM_CHAT_MAX_OUTPUT_TOKENS ?? 300),
                LLM_ROUTE_MAX_OUTPUT_TOKENS:Number(config.LLM_ROUTE_MAX_OUTPUT_TOKENS ?? 120)},extraFeatures:media.features.filter(feature=>!Array.isArray(config.V2_CANARY_FEATURES)||config.V2_CANARY_FEATURES.includes(feature.id)),
            isSentId:(chatId,id)=>sentStore?.get('runtime.sent',JSON.stringify([chatId,id])) === true,
            rememberSent:(chatId,id)=>{try{sentStore?.set('runtime.sent',JSON.stringify([chatId,id]),true,SENT_ID_TTL_MS);}catch{/* Echo protection is bounded and best effort. */}},
            rememberMedia:(ctx,part,delivery)=>app?.store?rememberDeliveredMedia(app.store,clock,botJid,ctx,part,delivery):false,
            recordInbound:async ctx=>{
                const event=ctx.event;const content = event.text || '';
                await conversation.append(event.chatId,'user',content,event.sender.name);
                if (event.isGroup) await threads.append(event,'user',content,{replyTo:event.quoted?.messageId});
            },
            record:async(ctx,text)=>{
                try {
                    await conversation.append(ctx.event.chatId,'assistant',text,'Botsky');
                    if (ctx.event.isGroup) await threads.append(ctx.event,'assistant',text,{senderJid:botJid,replyTo:ctx.event.id});
                } catch { /* Transcript storage cannot turn an acknowledged reply into a failure. */ }
            },
            recentReplies:async chatId=>(await conversation.recent(chatId,12)).filter(row=>row.role==='assistant').map(row=>row.content),
            releaseMedia:ref=>media?.releaseMedia(ref) || Promise.resolve(),
            getStatus:()=>{
                const stats=app?.queue.stats || {};
                const pending=Object.values(stats).reduce((sum,value)=>sum+value.pending,0);
                const running=Object.values(stats).reduce((sum,value)=>sum+value.running,0);
                return {version:'v2',uptimeMs:Math.max(0,clock.now()-startedAt),queue:{pending,running},
                    sessions:app?.store.stats.namespaces['pipeline.session'] || 0,
                    ai:hasConfiguredAi(config)?'configured':'not-configured',memoryMb:Math.round(process.memoryUsage().rss/1024/1024)};
            }});

        const scheduleCleanup=()=>{
            if (disposed) return;
            cleanupTimer=clock.setTimeout(()=>{
                cleanupTimer=undefined;
                const run=Promise.resolve(media?.cleanupExpired()).then(()=>undefined,()=>undefined);
                cleanupPromise=run;
                void run.finally(()=>{if(cleanupPromise===run)cleanupPromise=undefined;scheduleCleanup();});
            },MEDIA_CLEANUP_INTERVAL_MS);
        };
        scheduleCleanup();

        function dispose() {
            if (disposal) return disposal;
            disposed=true;
            if (cleanupTimer !== undefined) { clock.clearTimeout(cleanupTimer); cleanupTimer=undefined; }
            // app.dispose closes pipeline admissions synchronously before awaiting work.
            const appDrained=app?.dispose() || Promise.resolve();
            disposal=(async()=>{
                /** @type {unknown[]} */ const failures=[];
                try { await appDrained; } catch(error) { failures.push(error); }
                try { await cleanupPromise; } catch(error) { failures.push(error); }
                try { await media?.dispose(); } catch(error) { failures.push(error); }
                try { echoGuard?.dispose();echoStore?.dispose();sentStore?.dispose(); } catch(error) { failures.push(error); }
                try { await db.close(); } catch(error) { failures.push(error); }
                if(failures.length)throw new AggregateError(failures,'Runtime disposal failed');
            })();
            return disposal;
        }
        return {app,evolution,media,db,conversation,threads,botJid,dispose,get readiness(){return{ready:!disposed,sidecar:path.resolve(sidecarDbFilename)};}};
    } catch (error) {
        disposed=true;
        if (cleanupTimer !== undefined) clock.clearTimeout(cleanupTimer);
        try { await app?.dispose(); } catch { /* Preserve initialization error. */ }
        try { await cleanupPromise; } catch { /* Preserve initialization error. */ }
        try { await media?.dispose(); } catch { /* Preserve initialization error. */ }
        echoGuard?.dispose();echoStore?.dispose();sentStore?.dispose();
        try { await db.close(); } catch { /* Preserve initialization error. */ }
        throw error;
    }
}

/** @param {Record<string,any>} config */
function hasConfiguredAi(config) {
    const gemini=[config.GEMINI_API_KEY,config.GEMINI_API_KEY_2,config.GEMINI_API_KEY_3,config.GEMINI_API_KEYS]
        .some(value=>Array.isArray(value)?value.some(key=>typeof key==='string'&&key.trim()):typeof value==='string'&&value.trim());
    return gemini || (typeof config.GROQ_API_KEY==='string'&&Boolean(config.GROQ_API_KEY.trim()));
}
module.exports={createRuntime,validatePaths,ensurePrivateDirectory,normalizeConfiguredJids,hasConfiguredAi,rememberDeliveredMedia,RETURNED_MEDIA_TTL_MS};
