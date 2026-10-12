// @ts-check
'use strict';
const path = require('node:path');
/** @typedef {{readdir:(dir:string)=>Promise<string[]>,stat:(file:string)=>Promise<{mtimeMs:number}>,unlink:(file:string)=>Promise<unknown>,rm:(file:string,options:{recursive:boolean,force:boolean})=>Promise<unknown>}} FileSystem */
/** @typedef {{fs:FileSystem,clock:{now:()=>number},tempDir:string,schoolMediaDir:string,checkpoint:()=>Promise<unknown>,scheduler:{register:(id:string,intervalMs:number,run:()=>Promise<unknown>)=>(()=>void)},onError?:(kind:string)=>void}} MaintenanceOptions */
/** @param {MaintenanceOptions} options */
function createMaintenance({fs,clock,tempDir,schoolMediaDir,checkpoint,scheduler,onError = () => {}}) {
    /** @type {Array<()=>void>} */ let cancellations = [];
    let running = false;
    /** @param {string} kind */
    function report(kind) { try { onError(kind); } catch { /* Observers cannot alter cleanup behavior. */ } }
    /** @param {string} dir @param {number} maxAgeMs */
    async function cleanDirectory(dir,maxAgeMs) {
        let deleted = 0;
        try {
            const names = await fs.readdir(dir); const now = clock.now();
            for (const name of names) {
                if (!name || path.basename(name) !== name || name === '.' || name === '..') continue;
                try { const file = path.join(dir,name); const stat = await fs.stat(file);
                    if (now - stat.mtimeMs > maxAgeMs) { await fs.unlink(file); deleted++; }
                } catch { /* Legacy tolerates races, folders and inaccessible files. */ }
            }
        } catch { report('directory'); }
        return deleted;
    }
    // Share one actual execution per action across immediate, manual and ticker
    // calls. Independent actions retain independent flight slots.
    /** @template T @param {()=>Promise<T>} action @returns {()=>Promise<T>} */
    function singleFlight(action) {
        /** @type {Promise<T>|undefined} */ let pending;
        return () => {
            if (!pending) pending = Promise.resolve().then(action).finally(() => { pending = undefined; });
            return pending;
        };
    }
    const cleanTempDirectory = singleFlight(() => cleanDirectory(tempDir,7200000));
    const cleanSchoolMediaDirectory = singleFlight(() => cleanDirectory(schoolMediaDir,604800000));
    async function checkpointAction() {
        try { const result = await checkpoint(); if (result === false) { report('checkpoint'); return false; } return true; }
        catch { report('checkpoint'); return false; }
    }
    const runWalCheckpoint = singleFlight(checkpointAction);
    /** Immediate explicit cleanup: files and directories, best effort.
     * @param {...string} files */
    async function cleanup(...files) {
        for (const file of files) { if (!file) continue; try { await fs.rm(file,{recursive:true,force:true}); } catch { /* Best effort. */ } }
    }
    async function runNow() { return {temp:await cleanTempDirectory(),school:await cleanSchoolMediaDirectory(),checkpoint:await runWalCheckpoint()}; }
    function stop() { for (const cancel of cancellations) cancel(); cancellations = []; running = false; }
    async function start() {
        if (running) return;
        running = true;
        try {
            cancellations.push(scheduler.register('temp-dir-cleanup',720000,cleanTempDirectory));
            cancellations.push(scheduler.register('school-media-cleanup',720000,cleanSchoolMediaDirectory));
            cancellations.push(scheduler.register('sqlite-wal-checkpoint',60000,runWalCheckpoint));
        } catch (error) { stop(); throw error; }
        await runNow();
    }
    return {cleanup,cleanTempDirectory,cleanSchoolMediaDirectory,runWalCheckpoint,runNow,start,stop};
}
module.exports = { createMaintenance };
