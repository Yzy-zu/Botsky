// @ts-check
'use strict';
const { createHash } = require('node:crypto');
const sql = `CREATE TABLE IF NOT EXISTS thread_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    owner_jid TEXT NOT NULL,
    message_id TEXT NOT NULL,
    sender_jid TEXT NOT NULL,
    quoted_message_id TEXT,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    UNIQUE(chat_id,message_id,role)
);
CREATE INDEX IF NOT EXISTS idx_thread_history_owner ON thread_history(chat_id,owner_jid,id DESC);
CREATE INDEX IF NOT EXISTS idx_thread_history_quote ON thread_history(chat_id,quoted_message_id);
CREATE INDEX IF NOT EXISTS idx_thread_history_sender ON thread_history(chat_id,sender_jid,message_id);`;
/** Additive migration; composition must include 000 and 001 explicitly.
 * @returns {import('./index').Migration} */
function threadConversationMigration() {
    return { version: '001', checksum: createHash('sha256').update(sql).digest('hex'),
        up: db => db.exec(sql) };
}
module.exports = { threadConversationMigration };
