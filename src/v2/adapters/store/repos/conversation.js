// @ts-check
'use strict';
/** @typedef {{id:number,role:string,content:string,name:string,timestamp:number}} Message */
/** Keeps legacy chat_history intact; thread-aware schema will be additive in pipeline phase.
 * @param {import('../sqlite').Db} db @param {{now:()=>number}} clock */
function createConversationRepo(db, clock) {
    /** @param {string} chatId @param {string} role @param {string} content
     * @param {string} [name] @param {number} [timestamp] */
    function append(chatId, role, content, name, timestamp = clock.now()) {
        if (!chatId || !['user', 'assistant', 'system'].includes(role) || !Number.isSafeInteger(timestamp)) {
            return Promise.reject(new TypeError('Invalid conversation message'));
        }
        return db.transaction(async tx => {
            const result = await tx.run('INSERT INTO chat_history (chat_id,role,content,name,timestamp) VALUES (?,?,?,?,?)',
                [chatId, role, content, name || (role === 'assistant' ? 'Botsky' : 'Usuario'), timestamp]);
            await tx.run(`DELETE FROM chat_history WHERE chat_id=? AND id NOT IN (
                SELECT id FROM chat_history WHERE chat_id=? ORDER BY id DESC LIMIT 20)`, [chatId, chatId]);
            return result.lastID;
        });
    }
    /** @param {string} chatId @param {number} [limit] @returns {Promise<Message[]>} */
    function recent(chatId, limit = 12) {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) return Promise.reject(new TypeError('Invalid history limit'));
        return db.all(`SELECT id,role,content,name,timestamp FROM (SELECT id,role,content,name,timestamp
            FROM chat_history WHERE chat_id=? ORDER BY id DESC LIMIT ?) ORDER BY id ASC`, [chatId, limit]);
    }
    /** @param {string} chatId */
    function clear(chatId) { return db.run('DELETE FROM chat_history WHERE chat_id=?', [chatId]); }
    return { append, recent, clear };
}
module.exports = { createConversationRepo };
