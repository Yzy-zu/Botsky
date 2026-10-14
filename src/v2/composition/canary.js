// @ts-check
'use strict';
const { normalizeJid } = require('../domain/jid');

/**
 * Owns each inbound event exactly once while moving selected chats to v2.
 * @param {{mode:string,canaryChatIds?:readonly string[],pipeline:(raw:unknown)=>Promise<unknown>|unknown,legacy:(raw:unknown)=>Promise<unknown>|unknown,isEligibleWaveA:(raw:unknown)=>boolean,clock:import('../platform/clock').Clock}} options
 */
function createCanaryOwner({mode,canaryChatIds=[],pipeline,legacy,isEligibleWaveA,clock}) {
    if (!['legacy','canary','v2'].includes(mode)) throw new TypeError('Unsupported PIPELINE_MODE');
    const canaryIds = new Set();
    for (const value of canaryChatIds) {
        if (typeof value !== 'string' || !normalizeJid(value.includes('@') ? value : `${value}@s.whatsapp.net`)) throw new TypeError('Invalid canary chat ID');
        canaryIds.add(normalizeJid(value.includes('@') ? value : `${value}@s.whatsapp.net`));
    }
    if (mode === 'canary' && canaryIds.size === 0) throw new TypeError('Canary mode requires explicit canary chat IDs');
    if (typeof pipeline !== 'function' || typeof legacy !== 'function' || typeof isEligibleWaveA !== 'function' || !clock || typeof clock.now !== 'function') {
        throw new TypeError('Canary owner dependencies are required');
    }

    /** @type {Set<Promise<unknown>>} */
    const inFlight = new Set();
    let closing = false;
    let drained = Promise.resolve();

    /** Pure ownership decision; it does not inspect lifecycle state or call injected code.
     * @param {unknown} raw */
    function shouldHandle(raw) {
        const event = /** @type {any} */ (raw);
        const primary = typeof event?.key?.remoteJid === 'string' ? normalizeJid(event.key.remoteJid) : '';
        const valid = Boolean(primary && typeof event?.key?.id === 'string' && event.key.id.length > 0);
        // A private LID can map to a PN only through Evolution's explicit alternate identity.
        // Group routing always uses the group JID; participant aliases never select a chat.
        const alternate = !primary.endsWith('@g.us') && primary.endsWith('@lid') && typeof event?.key?.remoteJidAlt === 'string'
            ? normalizeJid(event.key.remoteJidAlt) : '';
        const chatId = alternate.endsWith('@s.whatsapp.net') ? alternate : primary;
        if (mode === 'legacy') return {owner:'legacy',reason:'legacy-mode',valid};
        if (!valid) return {owner:'legacy',reason:'invalid-event',valid:false};
        if (mode === 'v2') return {owner:'pipeline',reason:'v2-mode',valid:true};
        if (!event.key.fromMe && canaryIds.has(chatId) && isEligibleWaveA(raw)) return {owner:'pipeline',reason:'canary-match',valid:true};
        return {owner:'legacy',reason:canaryIds.has(chatId) ? 'not-eligible' : 'chat-not-selected',valid:true};
    }

    /** @param {unknown} raw */
    async function dispatch(raw) {
        const selection = shouldHandle(raw);
        if (closing) return {...selection,owner:'closed',selectedAt:clock.now()};
        const callback = selection.owner === 'pipeline' ? pipeline : legacy;
        const operation = Promise.resolve().then(() => callback(raw));
        inFlight.add(operation);
        try {
            return {...selection,result:await operation,selectedAt:clock.now()};
        } finally {
            inFlight.delete(operation);
            if (closing && inFlight.size === 0) drained = Promise.resolve();
        }
    }

    /** Synchronously closes admission; the returned promise resolves after accepted dispatches finish. */
    function close() {
        closing = true;
        drained = Promise.allSettled([...inFlight]).then(()=>undefined);
        return drained;
    }

    return {
        shouldHandle,
        dispatch,
        close,
        get readiness() { return {mode,canaryChatCount:canaryIds.size,ready:!closing,inFlight:inFlight.size}; }
    };
}

module.exports = {createCanaryOwner};
