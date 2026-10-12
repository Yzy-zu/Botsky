// @ts-check
'use strict';
/** @typedef {{jid:string,xp:number,level:number,strikes:number}} User */
/** @param {string} jid */
function normalizeUserJid(jid) { return jid.trim().replace(/:[0-9]+(?=@)/, '').replace(/:[0-9]+$/, ''); }
/** @param {import('../sqlite').Db} db */
function createUsersRepo(db) {
    /** @param {string} jid @returns {Promise<User>} */
    function getOrCreate(jid) {
        const normalized = normalizeUserJid(jid);
        if (!normalized) return Promise.reject(new TypeError('User JID required'));
        return db.transaction(async tx => {
            await tx.run('INSERT INTO users (jid) VALUES (?) ON CONFLICT(jid) DO NOTHING', [normalized]);
            /** @type {User|undefined} */
            const user = await tx.get('SELECT jid,xp,level,strikes FROM users WHERE jid=?', [normalized]);
            if (!user) throw new Error('User missing after insert');
            return user;
        });
    }
    /** @param {string} jid @returns {Promise<User|undefined>} */
    function get(jid) { return db.get('SELECT jid,xp,level,strikes FROM users WHERE jid=?', [normalizeUserJid(jid)]); }
    /** Preserves legacy XP/level calculation and returns levelUp.
     * @param {string} jid @param {number} [amount] @returns {Promise<User & {levelUp:boolean}>} */
    function addXp(jid, amount = 1) {
        const normalized = normalizeUserJid(jid);
        if (!normalized || !Number.isSafeInteger(amount)) return Promise.reject(new TypeError('Invalid XP update'));
        return db.transaction(async tx => {
            await tx.run('INSERT INTO users (jid) VALUES (?) ON CONFLICT(jid) DO NOTHING', [normalized]);
            /** @type {User|undefined} */
            const before = await tx.get('SELECT jid,xp,level,strikes FROM users WHERE jid=?', [normalized]);
            await tx.run(`UPDATE users SET xp=COALESCE(xp,0)+?,
                level=MAX(1,((COALESCE(xp,0)+?)/20)+1) WHERE jid=?`, [amount, amount, normalized]);
            /** @type {User|undefined} */
            const user = await tx.get('SELECT jid,xp,level,strikes FROM users WHERE jid=?', [normalized]);
            if (!before || !user) throw new Error('User missing after XP update');
            return { ...user, levelUp: user.level > (before.level || 1) };
        });
    }
    return { get, getOrCreate, addXp };
}
module.exports = { createUsersRepo, normalizeUserJid };
