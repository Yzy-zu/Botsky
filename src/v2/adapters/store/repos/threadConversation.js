// @ts-check
'use strict';
/** @typedef {{id:number,role:'user'|'assistant',content:string,messageId:string,senderJid:string,quotedMessageId:string|null,timestamp:number}} ThreadMessage */
/** @param {import('../sqlite').Db} db @param {{now:()=>number}} clock */
function createThreadConversationRepo(db, clock) {
    const retention = 100;
    /** @param {unknown} value @returns {value is string} */
    const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value;
    /** event.sender.jid owns the thread; senderJid optionally names the actual assistant author.
     * @param {import('../../../domain/events').InboundEvent} event
     * @param {'user'|'assistant'} role @param {string} content
     * @param {{replyTo?:string,senderJid?:string}} [options] */
    async function append(event, role, content, options = {}) {
        const owner = event?.sender?.jid;
        const sender = options.senderJid ?? owner;
        const quoted = options.replyTo ?? event?.quoted?.messageId ?? null;
        const timestamp = clock.now();
        if (!identity(event?.chatId) || !identity(event?.id) || !identity(owner) || !identity(sender)
            || !['user', 'assistant'].includes(role) || typeof content !== 'string' || content.length > 65536
            || (quoted !== null && !identity(quoted)) || !Number.isSafeInteger(timestamp)) throw new TypeError('Invalid thread message');
        if (role === 'user' && sender !== owner) throw new TypeError('User author must own the message');
        return db.transaction(async tx => {
            await tx.run(`INSERT INTO thread_history(chat_id,owner_jid,message_id,sender_jid,quoted_message_id,role,content,timestamp)
                VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(chat_id,message_id,role) DO NOTHING`,
            [event.chatId, owner, event.id, sender, quoted, role, content, timestamp]);
            await tx.run(`DELETE FROM thread_history WHERE chat_id=? AND owner_jid=? AND id NOT IN
                (SELECT id FROM thread_history WHERE chat_id=? AND owner_jid=? ORDER BY id DESC LIMIT ?)`,
            [event.chatId, owner, event.chatId, owner, retention]);
            /** @type {{id:number}|undefined} */
            const row = await tx.get('SELECT id FROM thread_history WHERE chat_id=? AND message_id=? AND role=?', [event.chatId, event.id, role]);
            return row?.id;
        });
    }
    /** Own messages + humans directly quoting own user IDs + assistant replies scoped to owner.
     * An explicit quotedId includes that single same-chat reference, including a bot reply, never its whole owner history.
     * Unknown legacy flat rows are never used as fallback.
     * @param {string} chatId @param {string} senderJid @param {string} [quotedId] @param {number} [limit]
     * @returns {Promise<ThreadMessage[]>} */
    async function recentThread(chatId, senderJid, quotedId, limit = 12) {
        if (!identity(chatId) || !identity(senderJid) || (quotedId !== undefined && !identity(quotedId)) || !Number.isSafeInteger(limit) || limit < 1 || limit > retention) throw new TypeError('Invalid thread query');
        return db.all(`SELECT id,role,content,message_id AS messageId,sender_jid AS senderJid,
            quoted_message_id AS quotedMessageId,timestamp FROM (
            SELECT h.* FROM thread_history h WHERE h.chat_id=? AND (
                h.owner_jid=? OR h.message_id=? OR (h.role='user' AND EXISTS (
                    SELECT 1 FROM thread_history own WHERE own.chat_id=h.chat_id AND own.role='user'
                    AND own.sender_jid=? AND own.message_id=h.quoted_message_id)))
            ORDER BY h.id DESC LIMIT ?) ORDER BY id ASC`, [chatId, senderJid, quotedId ?? null, senderJid, limit]);
    }
    return { append, recentThread };
}
module.exports = { createThreadConversationRepo };
