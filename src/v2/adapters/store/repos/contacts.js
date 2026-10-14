// @ts-check
'use strict';

const { normalizeJid } = require('../../../domain/jid');

const MAX_CONTACT_RESULTS = 8;

/** Read-only exact contact lookup over the v2 `user_affinities` migration table.
 * The injected DB is never opened here; callers own its lifecycle.
 * @param {{all:<T>(sql:string,params?:readonly (string|number|null|Buffer)[])=>Promise<T[]>}} db
 */
function createContactsRepo(db) {
    /** @param {string} query @returns {Promise<Array<{jid:string,name:string,isGroup:false}>>} */
    async function resolve(query) {
        if (typeof query !== 'string' || !query.trim() || query.trim().length > 160) return [];
        const clean = query.trim();
        const digits = clean.replace(/[^0-9]/g, '');

        if (/^[+\d\s().-]+$/.test(clean) && digits.length >= 10 && digits.length <= 15) {
            const candidates = phoneJids(digits);
            /** @type {{jid:string,user_name:string|null}[]} */
            const rows = await db.all(`SELECT jid,user_name FROM user_affinities
                WHERE jid IN (${candidates.map(() => '?').join(',')}) LIMIT ${MAX_CONTACT_RESULTS}`,
            candidates);
            return sanitizeRows(rows);
        }

        /** @type {{jid:string,user_name:string|null}[]} */
        const rows = await db.all(`SELECT jid,user_name FROM user_affinities
            WHERE user_name IS NOT NULL AND LOWER(TRIM(user_name))=LOWER(TRIM(?))
            ORDER BY jid LIMIT ${MAX_CONTACT_RESULTS}`, [clean]);
        const exact = rows.filter(row => normalizeName(row.user_name || '') === normalizeName(clean));
        return sanitizeRows(exact);
    }
    return { resolve };
}

/** @param {string} digits */
function phoneJids(digits) {
    const inputs = new Set([digits]);
    if (digits.length === 10) inputs.add(`521${digits}`); // legacy Mexico phone storage
    if (digits.length === 12 && digits.startsWith('52')) inputs.add(`521${digits.slice(2)}`);
    if (digits.length === 13 && digits.startsWith('521')) inputs.add(`52${digits.slice(3)}`);
    return [...inputs].map(number => `${number}@s.whatsapp.net`);
}

/** @param {{jid:string,user_name:string|null}[]} rows */
function sanitizeRows(rows) {
    const unique = new Map();
    for (const row of rows) {
        if (!row || typeof row.jid !== 'string' || !row.jid.endsWith('@s.whatsapp.net')) continue;
        const jid = normalizeJid(row.jid);
        if (!jid.endsWith('@s.whatsapp.net')) continue;
        const name = typeof row.user_name === 'string' && row.user_name.trim() ? row.user_name.trim().slice(0, 80) : jid.split('@')[0];
        unique.set(jid, { jid, name, isGroup: /** @type {false} */ (false) });
    }
    return [...unique.values()];
}

/** @param {string} value */
function normalizeName(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim().replace(/\s+/g, ' ');
}

module.exports = { createContactsRepo, MAX_CONTACT_RESULTS };
