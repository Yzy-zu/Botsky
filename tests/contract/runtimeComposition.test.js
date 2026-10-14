'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createRuntime,validatePaths,rememberDeliveredMedia}=require('../../src/v2/composition/runtime');
const {FakeClock}=require('../../src/v2/platform/clock');
const {TtlStore}=require('../../src/v2/platform/ttlStore');
const {createAttachmentDownload}=require('../../src/v2/composition/media');

function config(bot='15551234567'){
 return {BOT_NUMBER:bot,EVOLUTION_INSTANCE:'fake-instance',TMP_DIR:'/tmp/runtime-media-test',
  MAX_FILE_SIZE_MB:64,MAX_DOCUMENT_SIZE_MB:200,SESSION_GROUP_RELAXED:false,
  ALLOWED_NUMBERS_NORMAL:['15550000001'],ALLOWED_NUMBERS_TASKS:[],ALLOWED_NUMBERS_ADMIN:['15550000002'],
  ALLOWED_GROUPS_NORMAL:['120363000000000001'],ALLOWED_GROUPS_ADMIN:[],
  GROQ_API_KEY:'',LLM_AGENT_MAX_OUTPUT_TOKENS:600,LLM_CHAT_MAX_OUTPUT_TOKENS:300,LLM_VISION_MAX_OUTPUT_TOKENS:1500,WHISPER_LANGUAGE:'auto'};
}
function fakePorts(){
 const sends=[];let llmCalls=0;let mediaHttpCalls=0;
 return {sends,get llmCalls(){return llmCalls;},get mediaHttpCalls(){return mediaHttpCalls;},
  evolutionHttp:{post:async(route,body)=>{sends.push({route,body});return{status:200,data:{key:{id:`sent-${sends.length}`}}};},get:async()=>assert.fail('Unexpected Evolution GET'),put:async()=>assert.fail('Unexpected Evolution PUT')},
  llm:{generate:async()=>{llmCalls++;throw Error('Provider should not be called for explicit help');}},
  http:{post:async()=>{mediaHttpCalls++;throw Error('Media HTTP should not be called');}},
  formData:()=>({append(){},getHeaders(){return{};}})};
}

test('runtime opens a private sidecar, composes Wave A, and drains before disposal',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-runtime-'));
 try{
  await fs.chmod(directory,0o700);
  const filename=path.join(directory,'v2-sidecar.sqlite');const backup=path.join(directory,'migration-backup.sqlite');
  const clock=new FakeClock(1000);const ports=fakePorts();
  const runtime=await createRuntime({config:config(),clock,evolutionHttp:ports.evolutionHttp,llm:ports.llm,http:ports.http,formData:ports.formData,
   sidecarDbFilename:filename,backupPath:backup});
  assert.equal(runtime.botJid,'15551234567@s.whatsapp.net');
  assert.deepEqual(runtime.media.features.map(feature=>feature.id),['qr','documents','transcription','sticker','voice']);
  assert.equal((await fs.stat(directory)).mode&0o777,0o700);
  assert.equal((await fs.stat(filename)).mode&0o777,0o600);
  assert.equal((await fs.stat(backup)).mode&0o777,0o600);
  assert.deepEqual(await runtime.db.all('SELECT version FROM schema_migrations ORDER BY version'),[{version:'000'},{version:'001'}]);
  assert.ok(await runtime.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='thread_history'"));
  assert.equal(clock.pendingTimers,1);

  const result=await runtime.app.pipeline.handle({key:{id:'help-1',remoteJid:'15550000001@s.whatsapp.net'},message:{conversation:'/ayuda'}});
  assert.equal(result.kind,'reply');assert.equal(ports.sends.length,1);
  assert.equal(ports.sends[0].route,'/message/sendText/fake-instance');
  assert.equal(ports.llmCalls,0);assert.equal(ports.mediaHttpCalls,0);
  assert.deepEqual((await runtime.conversation.recent('15550000001@s.whatsapp.net')).map(row=>row.role),['user','assistant']);

  const groupChat='120363000000000001@g.us';
  const groupRaw=(id,text,chat=groupChat,sender='15550000003@s.whatsapp.net')=>({key:{id,remoteJid:chat,participant:sender},message:{conversation:text}});
  const groupReply=await runtime.app.pipeline.handle(groupRaw('group-help','/ayuda'));
  assert.equal(groupReply.kind,'reply','allowed numeric group IDs normalize into @g.us and do not require its sender in the private allowlist');
  assert.deepEqual((await runtime.db.all('SELECT role FROM thread_history WHERE chat_id=? AND message_id=? ORDER BY role',[groupChat,'group-help'])).map(row=>row.role),['assistant','user']);

  const passive=runtime.app.pipeline.handle(groupRaw('passive-group','solo estoy conversando',groupChat,'15550000005@s.whatsapp.net'));
  await clock.advance(1200);assert.equal((await passive).kind,'ignore');
  assert.equal((await runtime.db.get('SELECT COUNT(*) AS count FROM thread_history WHERE message_id=?',['passive-group'])).count,0);
  const shadow=await runtime.app.pipeline.decideOnly(groupRaw('shadow-group','/ayuda',groupChat,'15550000006@s.whatsapp.net'));
  assert.equal(shadow.kind,'decision');
  assert.equal((await runtime.db.get('SELECT COUNT(*) AS count FROM thread_history WHERE message_id=?',['shadow-group'])).count,0);

  assert.equal((await runtime.app.pipeline.handle(groupRaw('denied-group','/ayuda','120363000000000099@g.us'))).reason,'group-not-allowed');
  assert.equal((await runtime.app.pipeline.handle({key:{id:'denied-private',remoteJid:'15550000004@s.whatsapp.net'},message:{conversation:'/ayuda'}})).reason,'sender-not-allowed');
  assert.equal((await runtime.conversation.recent('15550000004@s.whatsapp.net')).length,0);
  const status=await runtime.app.pipeline.handle({key:{id:'status-1',remoteJid:'15550000002@s.whatsapp.net'},message:{conversation:'/estado'}});
  assert.equal(status.kind,'reply');assert.match(ports.sends.at(-1).body.text,/IA: no configurada/);
  assert.equal(ports.llmCalls,0);assert.equal(ports.mediaHttpCalls,0);

  let finishCleanup;const cleanupBlocked=new Promise(resolve=>{finishCleanup=resolve;});
  runtime.media.services.qr.cleanupExpired=async()=>cleanupBlocked;
  await clock.advance(60000);
  let disposed=false;const disposal=runtime.dispose().then(()=>{disposed=true;});
  await Promise.resolve();assert.equal(disposed,false,'disposal waits for an already running janitor');
  finishCleanup();await disposal;
  assert.equal(runtime.readiness.ready,false);assert.equal(clock.pendingTimers,0);
  assert.equal((await fs.stat(filename)).isFile(),true);assert.equal((await fs.stat(backup)).isFile(),true);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('runtime requires configured bot identity and refuses the live legacy filename',async()=>{
 assert.doesNotThrow(()=>validatePaths('/tmp/private/v2.sqlite','/tmp/private/backup.sqlite'));
 assert.throws(()=>validatePaths('/tmp/private/bot.db','/tmp/private/backup.sqlite'),/separate/);
 assert.throws(()=>validatePaths('/tmp/private/v2.sqlite','/tmp/private/v2.sqlite'),/separate/);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-runtime-invalid-'));
 try{
  const ports=fakePorts();
  await assert.rejects(createRuntime({config:config('invalid@invalid'),clock:new FakeClock(),evolutionHttp:ports.evolutionHttp,llm:ports.llm,http:ports.http,formData:ports.formData,
   sidecarDbFilename:path.join(directory,'v2.sqlite'),backupPath:path.join(directory,'backup.sqlite')}),/BOT_NUMBER/);
  assert.deepEqual(await fs.readdir(directory),[]);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('acknowledged returned media caches only opaque provider identity for exact quoted reuse',async()=>{
 const clock=new FakeClock(5000);const store=new TtlStore({clock,maxEntries:10});
 const chatId='120363000000000001@g.us';const botJid='15551234567@s.whatsapp.net';
 const ctx={event:{chatId,sender:{jid:'15550000001@s.whatsapp.net'},isGroup:true}};
 const part={type:'sticker',ref:'/private/local/botsky-sticker-output.webp',mime:'image/webp'};
 assert.equal(rememberDeliveredMedia(store,clock,botJid,ctx,part,{data:{key:{id:'provider-id-1'}}}),true);
 const attachment=store.get('pipeline.attachment.id',JSON.stringify([chatId,'provider-id-1']));
 assert.equal(attachment.ref,'provider-media:provider-id-1');assert.equal(attachment.ownerJid,botJid);
 assert.deepEqual(attachment.providerKey,{id:'provider-id-1',remoteJid:chatId,fromMe:true});
 assert.equal(attachment.expiresAt,5000+10*60*1000);
 assert.equal(rememberDeliveredMedia(store,clock,botJid,ctx,{type:'image',ref:'/private/path.png',mime:'image/png'},{}),false);
 let hydrated;
 const download=createAttachmentDownload({downloadMedia:async message=>{hydrated=message;return{buffer:Buffer.from('x'),extension:'webp'};}});
 await download(attachment,{maxBytes:10,signal:new AbortController().signal});
 assert.deepEqual(hydrated.key,{id:'provider-id-1',remoteJid:chatId,fromMe:true});
 store.dispose();
});
