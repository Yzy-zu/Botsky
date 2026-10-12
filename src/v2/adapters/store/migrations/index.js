// @ts-check
'use strict';
const { legacyMigration } = require('./000-legacy');
/** @typedef {{version:string,checksum:string,up:(db:import('../sqlite').Db)=>Promise<void>}} Migration */

/** @param {import('../sqlite').Db} db
 * @param {{backupPath:string,migrations?:Migration[],clock?:{now:()=>number}}} options */
async function migrate(db, { backupPath, migrations, clock = { now: Date.now } }) {
    const list = migrations || [await legacyMigration()];
    const versions = list.map(migration => migration.version);
    if (new Set(versions).size !== versions.length || list.some(migration => !/^\d{3,}$/.test(migration.version)
        || !/^[a-f0-9]{64}$/.test(migration.checksum))) throw new Error('Invalid migration manifest');
    /** @type {{name:string}|undefined} */
    const metadata = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'");
    /** @type {{version:string,checksum:string}[]} */
    const existing = metadata ? await db.all('SELECT version,checksum FROM schema_migrations ORDER BY version') : [];
    for (const applied of existing) {
        const migration = list.find(item => item.version === applied.version);
        if (!migration || migration.checksum !== applied.checksum) throw new Error('Migration history mismatch');
    }
    const pending = list.filter(migration => !existing.some(applied => applied.version === migration.version))
        .sort((a, b) => a.version.localeCompare(b.version));
    if (!pending.length) return { applied: [], backup: null };
    if (!backupPath) throw new Error('Backup path required before migrations');
    const backup = await db.backupTo(backupPath);
    /** @type {string[]} */
    const applied = [];
    for (const migration of pending) {
        await db.transaction(async tx => {
            await tx.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)');
            // Recheck inside transaction for another process that may have applied it.
            /** @type {{checksum:string}|undefined} */
            const current = await tx.get('SELECT checksum FROM schema_migrations WHERE version=?', [migration.version]);
            if (current) {
                if (current.checksum !== migration.checksum) throw new Error('Migration history mismatch');
                return;
            }
            await migration.up(tx);
            await tx.run('INSERT INTO schema_migrations (version,checksum,applied_at) VALUES (?,?,?)',
                [migration.version, migration.checksum, clock.now()]);
            applied.push(migration.version);
        });
    }
    return { applied, backup };
}
module.exports = { migrate };
