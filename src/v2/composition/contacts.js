// @ts-check
'use strict';

const { normalizeJid } = require('../domain/jid');

const CONTACT_CACHE_TTL_MS = 5 * 60 * 1000;
const CONTACT_FETCH_TIMEOUT_MS = 15 * 1000;
const MAX_GROUP_PARTICIPANTS = 2000;
const MAX_CONTACT_RESULTS = 8;

/**
 * Add a bounded group-roster fallback to the read-only exact sidecar directory.
 * Construction is inert; only resolve() may call fetchGroup.
 * @param {{repo:{resolve:(query:string)=>Promise<Array<{jid:string,name:string,isGroup?:boolean}>>},fetchGroup:(groupJid:string,signal:AbortSignal)=>Promise<unknown>,mainGroupJid:string,clock:import('../platform/clock').Clock}} options
 */
function createContactDirectory({repo,fetchGroup,mainGroupJid,clock}) {
    const groupJid=normalizeJid(mainGroupJid);
    /** @type {{expiresAt:number,participants:Array<{jid:string,name:string}>}|undefined} */ let cached;
    /** @param {string} query @param {AbortSignal} [signal] */
    async function resolve(query,signal) {
        if(typeof query!=='string'||!query.trim()||query.trim().length>160)return [];
        if(signal?.aborted)throw abortError(signal.reason);
        const clean=query.trim();
        try {
            const exact=await repo.resolve(clean);
            const sanitized=sanitizeRepo(exact);
            if(sanitized.length)return sanitized.slice(0,MAX_CONTACT_RESULTS);
        } catch { /* Group roster remains an independent read-only fallback. */ }
        if(!groupJid.endsWith('@g.us')||typeof fetchGroup!=='function')return [];
        let participants=cached&&cached.expiresAt>clock.now()?cached.participants:undefined;
        if(!participants) {
            const loaded=await fetchWithTimeout(fetchGroup,groupJid,clock,signal);
            if(!loaded.ok)return [];
            const extracted=extractParticipants(loaded.value);
            if(!extracted)return [];
            participants=extracted;
            cached={expiresAt:clock.now()+CONTACT_CACHE_TTL_MS,participants};
        }
        const sought=normalizeName(clean);
        if(!sought)return [];
        const named=participants.filter(row=>normalizeName(row.name)===sought);
        const selected=named.length?named:participants.filter(row=>normalizeName(row.name).includes(sought));
        return selected.slice(0,MAX_CONTACT_RESULTS).map(row=>({jid:row.jid,name:row.name,isGroup:false}));
    }
    return {resolve};
}

/** @param {unknown} raw @returns {Array<{jid:string,name:string,isGroup:false}>} */
function sanitizeRepo(raw) {
    if(!Array.isArray(raw))return [];
    const unique=new Map();
    for(const value of raw) {
        if(!value||typeof value!=='object')continue;
        const row=/** @type {Record<string,unknown>} */(value);
        if(typeof row.jid!=='string')continue;
        const jid=normalizeJid(row.jid);
        if(!jid.endsWith('@s.whatsapp.net'))continue;
        const name=typeof row.name==='string'&&row.name.trim()?row.name.trim().slice(0,80):jid.split('@')[0];
        unique.set(jid,{jid,name,isGroup:false});
    }
    return [...unique.values()];
}

/** @param {unknown} raw @returns {Array<{jid:string,name:string}>|null} */
function extractParticipants(raw) {
    if(!raw||typeof raw!=='object')return null;
    const envelope=/** @type {Record<string,unknown>} */(raw);
    const data=envelope.data&&typeof envelope.data==='object'?/** @type {Record<string,unknown>} */(envelope.data):envelope;
    const list=Array.isArray(data.participants)?data.participants:
        data.data&&typeof data.data==='object'&&Array.isArray(/** @type {Record<string,unknown>} */(data.data).participants)
            ?/** @type {unknown[]} */(/** @type {Record<string,unknown>} */(data.data).participants):null;
    if(!list)return null;
    // A partial roster cannot safely establish uniqueness for a destination.
    if(list.length>MAX_GROUP_PARTICIPANTS)return null;
    const byJid=new Map();
    for(const value of list) {
        if(!value||typeof value!=='object')continue;
        const row=/** @type {Record<string,unknown>} */(value);
        const idJid=validPnJid(row.id);
        // Trust a valid PN id first; an explicit phoneNumber is a safe fallback
        // for LID-only provider identities, never a source of digit inference.
        const jid=idJid||explicitPhoneJid(row.phoneNumber);
        if(!jid)continue;
        const name=firstName(row.name,row.pushName,row.notify);
        if(!name)continue;
        byJid.set(jid,{jid,name});
    }
    return [...byJid.values()];
}

/** @param {unknown} value */
function explicitPhoneJid(value) {
    if(typeof value!=='string'||!value.trim())return '';
    const raw=value.trim();
    if(/^[+\d\s().-]+$/.test(raw)) {
        const digits=raw.replace(/[^0-9]/g,'');
        if(digits.length<10||digits.length>15)return '';
        return normalizeJid(`${digits}@s.whatsapp.net`);
    }
    return validPnJid(raw);
}

/** @param {unknown} value */
function validPnJid(value) {
    if(typeof value!=='string')return '';
    const jid=normalizeJid(value);
    return jid.endsWith('@s.whatsapp.net')?jid:'';
}

/** @param {...unknown} values */
function firstName(...values) {
    for(const value of values)if(typeof value==='string'&&value.trim())return value.trim().slice(0,80);
    return '';
}

/** @param {string} value */
function normalizeName(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim().replace(/\s+/g,' ');
}

/** @param {(groupJid:string,signal:AbortSignal)=>Promise<unknown>} fetchGroup @param {string} groupJid @param {import('../platform/clock').Clock} clock @param {AbortSignal|undefined} parentSignal @returns {Promise<{ok:true,value:unknown}|{ok:false}>} */
async function fetchWithTimeout(fetchGroup,groupJid,clock,parentSignal) {
    if(parentSignal?.aborted)throw abortError(parentSignal.reason);
    const controller=new AbortController();
    /** @type {(error:Error)=>void} */ let rejectTimeout=()=>{};
    const timeout=new Promise((_,reject)=>{rejectTimeout=reject;});
    const abortParent=()=>{
        controller.abort(parentSignal?.reason);
        rejectTimeout(abortError(parentSignal?.reason));
    };
    parentSignal?.addEventListener('abort',abortParent,{once:true});
    let timer;
    try {
        timer=clock.setTimeout(()=>{
            controller.abort();
            rejectTimeout(Object.assign(new Error('Contact lookup timed out'),{name:'TimeoutError'}));
        },CONTACT_FETCH_TIMEOUT_MS);
        const result=await Promise.race([Promise.resolve().then(()=>fetchGroup(groupJid,controller.signal)).then(value=>({ok:true,value})),timeout]);
        return /** @type {{ok:true,value:unknown}} */(result);
    } catch(error) {
        if(parentSignal?.aborted)throw abortError(parentSignal.reason);
        // Never expose provider errors/bodies to the contact resolver caller.
        return /** @type {{ok:false}} */({ok:false});
    } finally {
        if(timer!==undefined)clock.clearTimeout(timer);
        parentSignal?.removeEventListener('abort',abortParent);
    }
}

/** @param {unknown} reason */
function abortError(reason) {
    if(reason&&typeof reason==='object'&&'name' in reason&&reason.name==='AbortError')return /** @type {Error} */(reason);
    return Object.assign(new Error('Contact lookup cancelled'),{name:'AbortError',cause:reason});
}

module.exports={createContactDirectory,CONTACT_CACHE_TTL_MS,CONTACT_FETCH_TIMEOUT_MS,MAX_GROUP_PARTICIPANTS,MAX_CONTACT_RESULTS};
