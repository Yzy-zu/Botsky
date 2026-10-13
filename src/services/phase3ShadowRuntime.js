'use strict';
// Optional composition glue. Importing creates no instances, reads no env, and performs no IO.
let bridge;
let writes = Promise.resolve();
let sinkErrors = 0;
let output;
let snapshotFile;
let fileSystem;
let runtimeClock;
let heartbeat;
let operationalClock = false;
let snapshotWriting = false;
let snapshotPromise = Promise.resolve();
let stopped = false;
function initialize(options = {}) {
    if (bridge) return status();
    const config = options.config || require('../v2/config').readConfigFromProcessEnv();
    if (config.PIPELINE_MODE !== 'shadow') return { enabled:false };
    if (typeof options.filename !== 'string' || !options.filename) throw new TypeError('Explicit shadow sidecar filename required');
    const fs = options.fs || require('node:fs');
    const path = require('node:path');
    output = options.filename;
    snapshotFile = options.snapshotFilename || `${output}.checkpoint.json`;
    if (snapshotFile === output) throw new TypeError('Separate shadow checkpoint filename required');
    fileSystem = fs;
    // Exclusive new run file prevents accidental overwrite/append to business files.
    fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
    const descriptor = fs.openSync(output,'wx',0o600);
    fs.closeSync(descriptor);
    const clock = options.clock || new (require('../v2/platform/clock').SystemClock)();
    runtimeClock = clock;
    operationalClock = !options.clock;
    const factory = options.factory || require('../v2/shadowBridge').createShadowBridge;
    const candidate = factory({clock,config,botJid:options.botJid || (config.BOT_NUMBER ? `${config.BOT_NUMBER}@s.whatsapp.net` : ''),features:options.features,
        maxPending:options.maxPending,decisionTimeoutMs:options.decisionTimeoutMs,
        sink:diff=>{
            // Only the platform's closed sanitizer snapshot reaches this dedicated sink.
            writes=writes.then(()=>fs.promises.appendFile(output,JSON.stringify(diff)+'\n',{mode:0o600})).catch(()=>{sinkErrors++;});
            return writes;
        }});
    try {
        fs.mkdirSync(path.dirname(snapshotFile),{recursive:true,mode:0o700});
        fs.writeFileSync(snapshotFile,JSON.stringify({...candidate.status(),operationalClock}),{flag:'wx',mode:0o600});
    } catch(error) {candidate.stop();throw error;}
    bridge=candidate;
    stopped=false;
    armHeartbeat();
    return status();
}
function observeWebhook(raw) { try {return bridge && !stopped ? bridge.observeWebhook(raw) : false;} catch (_) {return false;} }
function recordV1Decision(decision) { try {return bridge && !stopped ? bridge.recordV1Decision(decision) : false;} catch (_) {return false;} }
function status() { return { ...(bridge ? bridge.status() : {enabled:false}),operationalClock,sinkErrors,...(output?{output}:{}),stopped }; }
async function flush() {
    if(bridge) await bridge.flush();
    await writes;
    if(bridge && fileSystem && snapshotFile) {
        await snapshotPromise;
        try { await writeSnapshot(); }
        catch (_) {sinkErrors++;}
    }
}
async function writeSnapshot() {
    const temp=`${snapshotFile}.tmp`;
    await fileSystem.promises.writeFile(temp,JSON.stringify({...bridge.status(),sinkErrors,operationalClock}),{mode:0o600});
    await fileSystem.promises.rename(temp,snapshotFile);
}
function armHeartbeat() {
    if(stopped || !runtimeClock) return;
    heartbeat=runtimeClock.setTimeout(()=>{
        if(!snapshotWriting && bridge) {
            snapshotWriting=true;
            snapshotPromise=Promise.resolve().then(writeSnapshot)
                .catch(()=>{sinkErrors++;}).finally(()=>{snapshotWriting=false;});
        }
        armHeartbeat();
    },60000);
}
function stop() {stopped=true;if(runtimeClock && heartbeat!==undefined) runtimeClock.clearTimeout(heartbeat);if(bridge) bridge.stop();}
module.exports={initialize,install:initialize,observeWebhook,recordV1Decision,status,flush,stop};
