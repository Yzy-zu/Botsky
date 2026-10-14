// @ts-check
'use strict';

const { normalizeJid } = require('../domain/jid');
const { accessPolicy } = require('./access.policy');

/** @typedef {'current_chat'|'main_group'|'contact'} DeliveryScope */
/** @typedef {{jid:string,name?:string,isGroup?:boolean}} ContactTarget */
/** @typedef {{status:'ready',target:{jid:string,name:string,isGroup:boolean,scope:DeliveryScope}}|{status:'denied',reason:'admin_required'}|{status:'needs_clarification',question:string,missingFields:string[],candidates?:Array<{name:string,suffix:string}>}} DeliveryTargetDecision */

/**
 * Resolve a destination without sending anything. Contact discovery is supplied by
 * the caller; this boundary validates every returned identity and never guesses a JID.
 * @param {{scope?:unknown,contactQuery?:unknown,currentChatId:string,senderJid:string,isGroup:boolean,roles:import('../pipeline/contracts').Roles,mainGroupJid:string,contacts:{resolve:(query:string)=>Promise<unknown>|unknown}}} input
 * @returns {Promise<DeliveryTargetDecision>}
 */
async function resolveDeliveryTarget(input) {
    const requestedScope = input.scope || (typeof input.contactQuery === 'string' && input.contactQuery.trim() ? 'contact' : undefined);
    if (!['current_chat', 'main_group', 'contact'].includes(String(requestedScope))) {
        return { status: 'needs_clarification', question: '¿A qué chat lo mando?', missingFields: ['scope'] };
    }
    /** @type {DeliveryScope} */
    const scope = /** @type {DeliveryScope} */ (requestedScope);

    if (scope === 'current_chat') {
        const jid = normalizeJid(input.currentChatId);
        if (!isCurrentChatJid(jid)) return { status: 'needs_clarification', question: 'No pude validar este chat como destino.', missingFields: ['current_chat'] };
        return ready(scope, jid, 'este chat');
    }

    const permission = accessPolicy({ senderJid: input.senderJid, chatId: input.currentChatId,
        isGroup: input.isGroup, roles: input.roles, requiredAccess: 'admin' });
    if (!permission.allow) return { status: 'denied', reason: 'admin_required' };

    if (scope === 'main_group') {
        const jid = normalizeJid(input.mainGroupJid);
        if (!jid.endsWith('@g.us')) return { status: 'needs_clarification', question: 'No pude validar el grupo principal configurado.', missingFields: ['main_group'] };
        return ready(scope, jid, 'el grupo principal');
    }

    if (typeof input.contactQuery !== 'string' || !input.contactQuery.trim()) {
        return { status: 'needs_clarification', question: '¿A qué contacto se lo mando?', missingFields: ['contact'] };
    }
    const query = input.contactQuery.trim();
    // A fully numeric phone is an explicit destination, unlike a name containing digits.
    // Keep this behind the external-target role check above.
    if (/^[+\d\s().-]+$/.test(query)) {
        const digits = query.replace(/[^0-9]/g, '');
        if (digits.length >= 10 && digits.length <= 15) {
            const legacyPhone = digits.length === 10 ? `521${digits}` : digits;
            const jid = normalizeJid(`${legacyPhone}@s.whatsapp.net`);
            if (jid.endsWith('@s.whatsapp.net')) return ready(scope, jid, query, false);
        }
    }
    const raw = await input.contacts.resolve(query);
    if (!Array.isArray(raw)) return { status: 'needs_clarification', question: 'No encontré un destino válido. Dime su nombre completo o número.', missingFields: ['contact'] };
    const unique = new Map();
    for (const value of raw) {
        const target = sanitizeContact(value);
        if (target) unique.set(target.jid, target);
    }
    const candidates = [...unique.values()];
    if (candidates.length === 0) return { status: 'needs_clarification', question: `No encontré a “${input.contactQuery.trim()}”. Dime su nombre completo o número; no envié nada.`, missingFields: ['contact'] };
    if (candidates.length > 1) return { status: 'needs_clarification', question: 'Encontré varios destinos. Dime el nombre completo para elegir uno.', missingFields: ['contact'], candidates: candidates.map(candidate => ({ name: candidate.name, suffix: candidate.jid.split('@')[0].slice(-4) })) };
    const candidate = candidates[0];
    return ready(scope, candidate.jid, candidate.name, candidate.isGroup);
}

/** @param {DeliveryScope} scope @param {string} jid @param {string} name @param {boolean} [group] @returns {DeliveryTargetDecision} */
function ready(scope, jid, name, group = jid.endsWith('@g.us')) {
    return { status: 'ready', target: { jid, name, isGroup: group, scope } };
}

/** @param {unknown} value @returns {ContactTarget|null} */
function sanitizeContact(value) {
    if (!value || typeof value !== 'object') return null;
    const row = /** @type {Record<string,unknown>} */ (value);
    if (typeof row.jid !== 'string') return null;
    const jid = normalizeJid(row.jid);
    // Contact destinations are externally selected identities: only canonical PN
    // or group namespaces are allowed. LID identifiers are never phone numbers.
    if (!jid || (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us'))) return null;
    const isGroup = jid.endsWith('@g.us');
    if (row.isGroup !== undefined && row.isGroup !== isGroup) return null;
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim().slice(0, 80) : jid.split('@')[0];
    return { jid, name, isGroup };
}

/** @param {string} jid */
function isCurrentChatJid(jid) {
    return Boolean(jid) && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us') || jid.endsWith('@lid'));
}

module.exports = { resolveDeliveryTarget };
