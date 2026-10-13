'use strict';
const fs=require('node:fs');const path=require('node:path');
const pm2=require('/usr/lib/node_modules/pm2');const root=path.resolve(__dirname,'../..');
const call=(method,...args)=>new Promise((resolve,reject)=>pm2[method](...args,(error,value)=>error?reject(error):resolve(value)));
async function main(){
 const state=JSON.parse(fs.readFileSync('/tmp/botsky-phase3-shadow-state.json'));const checkpoint=JSON.parse(fs.readFileSync(state.output+'.checkpoint.json'));
 await call('connect');const app=(await call('list')).find(value=>value.pm_id===state.id&&value.name==='wasa');
 const rows=fs.readFileSync(state.output,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));const categories={};for(const row of rows){if(!['same','v2-more','v2-less','changed','unknown'].includes(row.category))throw Error('Unexpected diff category');categories[row.category]=(categories[row.category]||0)+1;}
 const now=Date.now();const live=app?.pm2_env.status==='online'&&app.pid===state.pid&&app.pm2_env.env?.PIPELINE_MODE==='shadow';
 // checkpoint.active means worker busy, not observation enabled. Continuous runtime
 // requires same live PM2 process, real clock, fresh heartbeat and unfrozen time.
 const active=live&&checkpoint.enabled===true&&checkpoint.operationalClock===true&&now-checkpoint.observedUntil<120000;
 const report={recordedAt:new Date(now).toISOString(),active,clock:checkpoint.operationalClock?'SystemClock':'injected',startedAt:checkpoint.startedAt,observedUntil:checkpoint.observedUntil,elapsedMs:checkpoint.elapsedMs,observed:checkpoint.observed,processed:checkpoint.processed,exceptions:checkpoint.exceptions,sinkErrors:checkpoint.sinkErrors||0,dropped:checkpoint.dropped,bridgeDropped:checkpoint.bridgeDropped,v1TimedOut:checkpoint.v1TimedOut,unmatchedRecords:checkpoint.unmatchedRecords,workerBusy:checkpoint.active,actualDiffs:rows.length,categories,earliestCompletion:new Date(checkpoint.startedAt+86400000).toISOString(),businessEffects:0,additionalProviderCalls:0,limitations:['Read-only replay and NullMessenger construction enforce no business callbacks; this is not a claim that v1 stopped running.','No imported legacy history/sessions; unknown/unmatched remain explicit, not successful comparisons.','Elapsed time is real UTC and requires same process/fresh heartbeat; a restart cannot accumulate segments.','Diff review and final architecture approval remain manual; 24h alone never closes Gate3.']};
 if(process.argv.includes('--write')){
  fs.writeFileSync(path.join(root,'docs/refactor/phase3-shadow-status.json'),JSON.stringify(report,null,2)+'\n');
  const filename=path.join(root,'docs/refactor/phase3-evidence.json');const evidence=JSON.parse(fs.readFileSync(filename));evidence.status='shadow_active_gate_open';evidence.shadow={...report,diffReport:'docs/refactor/phase3-shadow-status.json',diffReviewed:false};fs.writeFileSync(filename,JSON.stringify(evidence,null,2)+'\n');
 }
 console.log(JSON.stringify(report));
}
main().catch(()=>{console.error('Could not verify the current shadow process/checkpoint. No gate evidence updated.');process.exitCode=1;}).finally(()=>pm2.disconnect());
