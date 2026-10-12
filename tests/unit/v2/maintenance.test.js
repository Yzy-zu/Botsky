'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createMaintenance}=require('../../../src/v2/platform/maintenance');
function harness(){const deleted=[],jobs=[],errors=[];let time=700000001;const fs={readdir:async()=>['old','boundary','new','directory','../escape'],stat:async file=>({mtimeMs:file.endsWith('old')?0:file.endsWith('boundary')?time-7200000:time}),unlink:async file=>deleted.push(file),rm:async file=>{if(file==='fail')throw Error();deleted.push(file);}};const api=createMaintenance({fs,clock:{now:()=>time},tempDir:'/temp',schoolMediaDir:'/school',checkpoint:async()=>true,scheduler:{register:(id,interval,run)=>{const job={id,interval,run,cancelled:false};jobs.push(job);return()=>{job.cancelled=true;};}},onError:e=>errors.push(e)});return{api,deleted,jobs,errors,fs};}
test('cleanup thresholds preserve exact boundary and tolerate errors without scheduling at construction',async()=>{
    const h=harness();assert.equal(h.jobs.length,0);assert.equal(h.deleted.length,0);assert.equal(await h.api.cleanTempDirectory(),1);assert.deepEqual(h.deleted,['/temp/old']);
    await h.api.cleanup('','file','fail','folder');assert.deepEqual(h.deleted,['/temp/old','file','folder']);
    h.fs.readdir=async()=>{throw Error('raw private path');};assert.equal(await h.api.cleanSchoolMediaDirectory(),0);assert.deepEqual(h.errors,['directory']);
});
test('explicit start registers legacy intervals once, performs immediate work, stop cancels',async()=>{
    const h=harness();await h.api.start();await h.api.start();assert.deepEqual(h.jobs.map(j=>j.interval),[720000,720000,60000]);assert.equal(h.deleted.length,2);h.api.stop();assert.ok(h.jobs.every(j=>j.cancelled));
});
test('checkpoint failure propagates boolean without asserting backup consistency',async()=>{
    const errors=[];const api=createMaintenance({fs:{},clock:{now:()=>0},tempDir:'/temp',schoolMediaDir:'/school',checkpoint:async()=>false,scheduler:{},onError:e=>errors.push(e)});
    assert.equal(await api.runWalCheckpoint(),false);assert.deepEqual(errors,['checkpoint']);
});
test('throwing observer cannot escape cleanup and checkpoint failures',async()=>{
    const api=createMaintenance({fs:{readdir:async()=>{throw Error('fs failed');}},clock:{now:()=>0},tempDir:'/temp',schoolMediaDir:'/school',checkpoint:async()=>{throw Error('db failed');},scheduler:{},onError(){throw Error('observer failed');}});
    assert.equal(await api.cleanTempDirectory(),0);assert.equal(await api.runWalCheckpoint(),false);
});
test('initial/manual actions share flights with real scheduler ticker; independent actions progress',async()=>{
    const {FakeClock}=require('../../../src/v2/platform/clock');const {Scheduler}=require('../../../src/v2/platform/scheduler');
    const clock=new FakeClock(800000000);const scheduler=new Scheduler({clock,tickMs:60000});
    let finishTemp,finishCheckpoint;let tempReads=0,schoolReads=0,checkpointRuns=0;
    const api=createMaintenance({clock,scheduler,tempDir:'/temp',schoolMediaDir:'/school',fs:{
        readdir:dir=>dir==='/temp'?(tempReads++,new Promise(resolve=>{finishTemp=resolve;})):(schoolReads++,Promise.resolve([])),
        stat:async()=>({mtimeMs:0}),unlink:async()=>{},rm:async()=>{}
    },checkpoint:()=>{checkpointRuns++;return new Promise(resolve=>{finishCheckpoint=resolve;});}});
    const starting=api.start();await clock.flush();const manualTemp=api.cleanTempDirectory();
    assert.equal(api.cleanTempDirectory(),manualTemp);assert.equal(tempReads,1);
    scheduler.start();await clock.advance(720000);
    assert.equal(tempReads,1,'ticker joins the pending initial temp cleanup');assert.equal(schoolReads,1,'school cleanup proceeds independently');assert.equal(checkpointRuns,1);
    const manualCheckpoint=api.runWalCheckpoint();assert.equal(api.runWalCheckpoint(),manualCheckpoint);
    finishTemp([]);await manualTemp;await clock.flush();assert.equal(checkpointRuns,1,'initial round joins ticker checkpoint');
    api.stop();assert.deepEqual(scheduler.getRegisteredTasks(),[]);
    finishCheckpoint(true);await manualCheckpoint;await starting;await scheduler.dispose();
    assert.equal(clock.pendingTimers,0);assert.deepEqual(scheduler.getRegisteredTasks(),[],'settling start does not reactivate after stop');
    const next=api.runWalCheckpoint();await clock.flush();assert.equal(checkpointRuns,2,'flight slot resets after settlement');finishCheckpoint(true);await next;
});
