// @ts-check
'use strict';
/** @typedef {import('../domain/ports').Messenger} Messenger */
/** @typedef {{kind:string,respond?:boolean,via?:string,feature?:string,reason:string}} DecisionSnapshot */
/** @typedef {{v1_decision:DecisionSnapshot,v2_decision:DecisionSnapshot,category:'same'|'v2-more'|'v2-less'|'changed'|'unknown',observedAt:number}} ShadowDiff */
/** @typedef {{startedAt:number,observedUntil:number,observed:number,processed:number,exceptions:number,dropped:number}} ShadowCheckpoint */
/** @param {unknown} value @param {string} key @returns {unknown} */
function field(value,key) {
    if (!value||typeof value!=='object'||Array.isArray(value)) return undefined;
    try {const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&'value' in descriptor?descriptor.value:undefined;}
    catch {return undefined;}
}
/** @param {unknown} input @param {readonly string[]} features @param {readonly string[]} reasons @returns {DecisionSnapshot} */
function sanitizeDecision(input,features,reasons) {
    const nested=field(input,'decision');
    const source=nested&&typeof nested==='object'?nested:input;
    const kind=field(source,'kind');
    const allowedKinds=['command','intent','chat','ignore','denied','reply','error'];
    const via=field(source,'via');const feature=field(source,'feature');
    const reason=field(input,'reason')??field(field(input,'addressing'),'reason');
    const respond=field(input,'respond')??field(field(input,'addressing'),'respond');
    return {kind:typeof kind==='string'&&allowedKinds.includes(kind)?kind:'unknown',
        ...(typeof respond==='boolean'?{respond}:{}),
        ...(typeof via==='string'&&['explicit','session','rule','llm'].includes(via)?{via}:{}),
        ...(typeof feature==='string'&&features.includes(feature)?{feature}:{}),
        reason:typeof reason==='string'&&reasons.includes(reason)?reason:'unknown'};
}
/** @param {DecisionSnapshot} v1 @param {DecisionSnapshot} v2 @returns {ShadowDiff['category']} */
function category(v1,v2) {
    if (v1.kind==='unknown'||v2.kind==='unknown') return 'unknown';
    if (v1.respond===true&&v2.respond===false) return 'v2-less';
    if (v1.respond===false&&v2.respond===true) return 'v2-more';
    return JSON.stringify(v1)===JSON.stringify(v2)?'same':'changed';
}
/** A throwing trap implements the full Messenger port; accidental IO is visible.
 * @returns {Messenger} */
function createNullMessenger() {
    const fail=()=>{throw Object.assign(new Error('Shadow mode attempted Messenger IO'),{code:'SHADOW_IO'});};
    return {sendText:fail,sendMedia:fail,sendVoice:fail,sendSticker:fail,react:fail,typing:fail,delete:fail,edit:fail,groupInfo:fail};
}
/** @param {{clock:import('./clock').Clock,decideOnly:(raw:unknown,signal:AbortSignal)=>Promise<unknown>,writeDiff:(diff:ShadowDiff)=>void|Promise<void>,maxPending?:number,timeoutMs?:number,allowedFeatures?:readonly string[],allowedReasons?:readonly string[],initialCheckpoint?:ShadowCheckpoint}} options */
function createShadowObserver({clock,decideOnly,writeDiff,maxPending=32,timeoutMs=30000,
    allowedFeatures=['help','system-info'],allowedReasons=[],initialCheckpoint}) {
    if (!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>1000||!Number.isSafeInteger(timeoutMs)||timeoutMs<1) throw new RangeError('Invalid shadow limits');
    const startedAt=clock.now();
    if (!Number.isFinite(startedAt)) throw new RangeError('Invalid shadow clock');
    if (initialCheckpoint) {
        if (![initialCheckpoint.startedAt,initialCheckpoint.observedUntil].every(Number.isFinite)||initialCheckpoint.startedAt>initialCheckpoint.observedUntil||initialCheckpoint.observedUntil>startedAt||
            ![initialCheckpoint.observed,initialCheckpoint.processed,initialCheckpoint.exceptions,initialCheckpoint.dropped].every(value=>Number.isSafeInteger(value)&&value>=0)||
            initialCheckpoint.processed>initialCheckpoint.observed) throw new RangeError('Invalid shadow checkpoint');
    }
    const features=[...allowedFeatures];
    const reasons=['own-message','private-chat','active-airdrop-claim','active-session','bot-mentioned','bot-quoted','explicit-command','wake-word','own-attachment-followup',
        'session-not-addressed','group-not-addressed','attachment-suggestion','operation-failed','duplicate','invalid-event','scope-denied','role-denied','access-granted','unknown',...allowedReasons];
    /** @type {{raw:unknown,v1:Promise<DecisionSnapshot>,at:number}[]} */ const queue=[];
    let accepting=true;let active=false;
    /** @type {number|undefined} */ let stoppedAt;
    let observed=initialCheckpoint?.observed??0;let processed=initialCheckpoint?.processed??0;
    let exceptions=initialCheckpoint?.exceptions??0;let dropped=initialCheckpoint?.dropped??0;
    /** @type {Promise<void>} */ let worker=Promise.resolve();
    /** @type {AbortController|undefined} */ let currentAbort;
    /** @param {unknown} snapshot */
    const sanitize=snapshot=>sanitizeDecision(snapshot,features,reasons);
    function pump() {
        if (active||!queue.length) return;
        const item=queue.shift();if (!item) return;
        active=true;
        worker=(async()=>{
            currentAbort=new AbortController();let timedOut=false;
            const timer=clock.setTimeout(()=>{timedOut=true;exceptions++;currentAbort?.abort();},timeoutMs);
            try {
                let v2;
                try {v2=sanitize(await decideOnly(item.raw,currentAbort.signal));}
                catch {if (!timedOut) exceptions++;v2=sanitize(undefined);}
                // Neither a decision, legacy promise nor sink timeout frees the
                // slot before real settlement. Retain only sanitized decisions.
                const v1=await item.v1;
                if (timedOut) v2=sanitize(undefined);
                try {await writeDiff({v1_decision:v1,v2_decision:v2,category:category(v1,v2),observedAt:item.at});}
                catch {exceptions++;}
                processed++;
            } finally {clock.clearTimeout(timer);currentAbort=undefined;}
        })().finally(()=>{active=false;pump();});
    }
    /** Immediate admission only. Never return/await a business decision to v1.
     * @param {unknown} raw @param {unknown|Promise<unknown>} v1DecisionPromiseOrSnapshot */
    function observe(raw,v1DecisionPromiseOrSnapshot) {
        // Attach a rejection handler even to a dropped v1 promise.
        const v1=Promise.resolve(v1DecisionPromiseOrSnapshot).then(sanitize,()=>{exceptions++;return sanitize(undefined);});
        if (!accepting||queue.length+Number(active)>=maxPending) {dropped++;return false;}
        observed++;queue.push({raw,v1,at:clock.now()});
        // Dispatch on a microtask: the legacy webhook never waits on the observer.
        void Promise.resolve().then(pump);
        return true;
    }
    function stats() {return {startedAt,observedUntil:stoppedAt??clock.now(),observed,processed,exceptions,dropped,pending:queue.length+Number(active),active,
        elapsedMs:Math.max(0,(stoppedAt??clock.now())-startedAt),previousObservedUntil:initialCheckpoint?.observedUntil??null};}
    function checkpoint() {const snapshot=stats();return {startedAt:snapshot.startedAt,observedUntil:snapshot.observedUntil,observed,processed,exceptions,dropped};}
    async function flush() {await Promise.resolve();while(active||queue.length){await worker;await Promise.resolve();}}
    function stop() {if(stoppedAt===undefined)stoppedAt=clock.now();accepting=false;dropped+=queue.length;queue.splice(0);currentAbort?.abort();}
    async function dispose() {stop();await flush();}
    return {observe,stats,checkpoint,flush,stop,dispose};
}
module.exports={createShadowObserver,createNullMessenger};
