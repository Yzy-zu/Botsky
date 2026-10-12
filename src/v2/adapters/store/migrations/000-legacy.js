// @ts-check
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Legacy silently swallowed duplicate-column errors. Check metadata before ALTER instead.
const additions = Object.freeze([
    Object.freeze({ table: 'school_tasks', column: 'media_path', sql: 'ALTER TABLE school_tasks ADD COLUMN media_path TEXT' }),
    Object.freeze({ table: 'school_tasks', column: 'due_text', sql: 'ALTER TABLE school_tasks ADD COLUMN due_text TEXT' }),
    Object.freeze({ table: 'school_tasks', column: 'batch_date', sql: 'ALTER TABLE school_tasks ADD COLUMN batch_date TEXT' }),
    Object.freeze({ table: 'user_affinities', column: 'is_doxxed', sql: 'ALTER TABLE user_affinities ADD COLUMN is_doxxed INTEGER DEFAULT 0' })
]);
async function legacyMigration() {
    const sql = await fs.readFile(path.join(__dirname, '000-legacy.sql'), 'utf8');
    const checksum = createHash('sha256').update(sql).update(JSON.stringify(additions)).digest('hex');
    return { version: '000', checksum,
        /** @param {import('../sqlite').Db} db */
        async up(db) {
            await db.exec(sql);
            for (const addition of additions) {
                /** @type {{name:string}[]} */
                const columns = await db.all(`PRAGMA table_info(${addition.table})`);
                if (!columns.some(column => column.name === addition.column)) await db.exec(addition.sql);
            }
            // There are no initialization seed rows in legacy. Personality/happy-hour
            // state is created on-demand by its repositories; do not invent seed data.
        }
    };
}
module.exports = { legacyMigration };
