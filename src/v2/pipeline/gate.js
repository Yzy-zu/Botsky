// @ts-check
'use strict';
const { normalizeJid } = require('./normalize');
/** @typedef {{groups?:readonly string[],numbers?:readonly string[],privateNumbers?:readonly string[],blocked?:readonly string[]}} AccessSnapshot */
/** @typedef {{blockedUntil?:number,cooldownUntil?:number,limited?:boolean}} RateState */
/** Pure snapshot decision; no counters, timers, IO, or mutation.
 * @param {import('../domain/events').InboundEvent} event
 * @param {{accessSnapshot?:AccessSnapshot,rateState?:RateState,now:number}} options */
function gate(event, { accessSnapshot = {}, rateState = {}, now }) {
    if (!Number.isFinite(now)) return { allow: false, reason: 'invalid-time' };
    if (event.isFromMe) return { allow: false, reason: 'outbound-echo' };
    const jid = normalizeJid(event.sender.jid);
    const chat = normalizeJid(event.chatId);
    const contains = /** @param {readonly string[]|undefined} values @param {string} target @param {'s.whatsapp.net'|'g.us'} [defaultDomain] */ (values, target, defaultDomain='s.whatsapp.net') => Boolean(values?.some(value => normalizeJid(value.includes('@') ? value : `${value}@${defaultDomain}`) === target));
    if (contains(accessSnapshot.blocked, jid) || contains(accessSnapshot.blocked, chat)) return { allow: false, reason: 'blocked' };
    if (event.isGroup && accessSnapshot.groups?.length && !contains(accessSnapshot.groups, chat, 'g.us')) return { allow: false, reason: 'group-not-allowed' };
    if (accessSnapshot.numbers?.length && !contains(accessSnapshot.numbers, jid)) return { allow: false, reason: 'sender-not-allowed' };
    const privateNumbers = accessSnapshot.privateNumbers;
    if (!event.isGroup && privateNumbers?.length && !contains(privateNumbers, jid)) return { allow: false, reason: 'sender-not-allowed' };
    if (rateState.limited || (rateState.blockedUntil ?? 0) > now) return { allow: false, reason: 'rate-limit' };
    if ((rateState.cooldownUntil ?? 0) > now) return { allow: false, reason: 'cooldown' };
    return { allow: true, reason: 'allowed' };
}
module.exports = { gate };
