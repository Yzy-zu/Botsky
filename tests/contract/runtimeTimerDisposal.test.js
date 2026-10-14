'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createRuntime}=require('../../src/v2/composition/runtime');
const {FakeClock}=require('../../src/v2/platform/clock');

function config(){return {BOT_NUMBER:'15551234567',EVOLUTION_INSTANCE:'timer-test',TMP_DIR:'/tmp/runtime-timer-test',
 MAX_FILE_SIZE_MB:64,MAX_DOCUMENT_SIZE_MB:200,SESSION_GROUP_RELAXED:false,ALLOWED_NUMBERS_NORMAL:[],ALLOWED_NUMBERS_TASKS:[],
 ALLOWED_NUMBERS_ADMIN:[],ALLOWED_GROUPS_NORMAL:[],ALLOWED_GROUPS_ADMIN:[],GROQ_API_KEY:''};}
function ports(){return {evolutionHttp:{post:async()=>({status:200,data:{key:{id:'ack'}}}),get:async()=>assert.fail('Unexpected GET'),put:async()=>assert.fail('Unexpected PUT')},
 llm:{generate:async()=>assert.fail('Unexpected LLM call')},http:{post:async()=>assert.fail('Unexpected media HTTP')},formData:()=>({append(){},getHeaders(){return{};}})};}
async function runtimeIn(root,clock,logger={info(){},warn(){}}){
 const injected=ports();
 return createRuntime({config:config(),clock,...injected,logger,sidecarDbFilename:path.join(root,'data','sidecar.sqlite'),backupPath:path.join(root,'backup','sidecar.sqlite')});
}

test('runtime closes admissions and drains SQLite when clearTimeout fails once; stale callback performs no janitor IO',async t=>{
 class ThrowOnceClearClock extends FakeClock{
  failed=false;
  clearTimeout(id){if(!this.failed){this.failed=true;throw Error('transient clear failure');}super.clearTimeout(id);}
 }
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-timer-clear-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const clock=new ThrowOnceClearClock(1000);const runtime=await runtimeIn(root,clock);
 let cleanupCalls=0;runtime.media.services.qr.cleanupExpired=async()=>{cleanupCalls++;};
 const staleCallback=Object.values(clock.timers)[0].callback;
 await runtime.dispose();
 assert.equal(runtime.readiness.ready,false);
 assert.equal(clock.pendingTimers,0,'the one-time clear failure is retried');
 assert.deepEqual(await runtime.app.pipeline.handle({}),{kind:'ignore',reason:'pipeline-closed'},'admissions close before timer cancellation');
 staleCallback();await clock.flush();
 assert.equal(cleanupCalls,0,'a callback already queued before disposal exits before janitor IO');
 await assert.rejects(runtime.db.get('SELECT 1'),/not open/,'database closes despite the timer failure');
});

test('a failed janitor timer re-arm is caught and leaves no unhandled rejection',async t=>{
 class ThrowSecondTimeoutClock extends FakeClock{
  calls=0;
  setTimeout(callback,delay){this.calls++;if(this.calls===2)throw Error('rearm failure');return super.setTimeout(callback,delay);}
 }
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'botsky-timer-rearm-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const warnings=[];const clock=new ThrowSecondTimeoutClock(1000);const runtime=await runtimeIn(root,clock,{info(){},warn(message){warnings.push(message);}});
 let cleanups=0;runtime.media.cleanupExpired=async()=>{cleanups++;};
 await clock.advance(60_000);
 await clock.flush();
 assert.equal(cleanups,1);
 assert.equal(clock.calls,2,'cleanup completion attempts to install the next timer');
 assert.deepEqual(warnings,['Runtime media cleanup timer could not be rescheduled.']);
 assert.equal(clock.pendingTimers,0);
 await runtime.dispose();
 assert.equal(runtime.readiness.ready,false);
 await assert.rejects(runtime.db.get('SELECT 1'),/not open/);
});
