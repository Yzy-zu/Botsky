// @ts-check
'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
/** @typedef {string|number|null|Buffer} SqlValue */
/** @typedef {{lastID:number,changes:number}} RunResult */
/** @typedef {ReturnType<typeof createDb>} Db */

/** Explicit lifecycle; all operations share a lock, including transactions and backups.
 * @param {{filename:string,readonly?:boolean,busyTimeoutMs?:number,cacheSizeKb?:number}} options */
function createDb({ filename, readonly = false, busyTimeoutMs = 5000, cacheSizeKb = 64000 }) {
    if (!filename || !Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0
        || !Number.isSafeInteger(cacheSizeKb) || cacheSizeKb < 1) throw new TypeError('Invalid SQLite options');
    /** @type {import('sqlite3').Database|null} */
    let connection = null;
    let opened = false;
    /** @type {Promise<unknown>} */
    let tail = Promise.resolve();
    /** @type {AsyncLocalStorage<{active:boolean,inTransaction:boolean}>} */
    const context = new AsyncLocalStorage();
    /** @template T @param {()=>Promise<T>} work @returns {Promise<T>} */
    function locked(work) {
        if (context.getStore()?.active) return work();
        const token = { active: true, inTransaction: false };
        const result = tail.then(() => context.run(token, work));
        tail = result.then(() => undefined, () => undefined);
        return result.finally(() => { token.active = false; });
    }
    function handle() {
        if (!connection || !opened) throw new Error('SQLite connection is not open');
        return connection;
    }
    /** @param {string} sql @param {readonly SqlValue[]} [params] @returns {Promise<RunResult>} */
    function run(sql, params = []) {
        return locked(() => new Promise((resolve, reject) => {
            handle().run(sql, params, function (error) {
                if (error) reject(error);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        }));
    }
    /** @template T @param {string} sql @param {readonly SqlValue[]} [params] @returns {Promise<T|undefined>} */
    function get(sql, params = []) {
        return locked(() => new Promise((resolve, reject) => {
            handle().get(sql, params, (/** @type {Error|null} */ error, /** @type {T|undefined} */ row) => error ? reject(error) : resolve(row));
        }));
    }
    /** @template T @param {string} sql @param {readonly SqlValue[]} [params] @returns {Promise<T[]>} */
    function all(sql, params = []) {
        return locked(() => new Promise((resolve, reject) => {
            handle().all(sql, params, (/** @type {Error|null} */ error, /** @type {T[]} */ rows) => error ? reject(error) : resolve(rows));
        }));
    }
    /** @param {string} sql @returns {Promise<void>} */
    function exec(sql) {
        return locked(() => new Promise((resolve, reject) => handle().exec(sql, error => error ? reject(error) : resolve())));
    }
    /** @returns {Promise<void>} */
    function open() {
        return locked(async () => {
            if (opened) return;
            const sqlite = require('sqlite3');
            const mode = readonly ? sqlite.OPEN_READONLY : sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE;
            await new Promise((resolve, reject) => {
                connection = new sqlite.Database(filename, mode, error => {
                    if (error) { connection = null; reject(error); }
                    else resolve(undefined);
                });
            });
            opened = true;
            try {
                await exec(`PRAGMA busy_timeout=${busyTimeoutMs}; PRAGMA cache_size=-${cacheSizeKb};`);
                if (!readonly) await exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
            } catch (error) {
                await close();
                throw error;
            }
        });
    }
    /** @returns {Promise<void>} */
    function close() {
        return locked(async () => {
            if (context.getStore()?.inTransaction) throw new Error('Cannot close during transaction');
            if (!connection) return;
            await new Promise((resolve, reject) => connection?.close(error => error ? reject(error) : resolve(undefined)));
            connection = null;
            opened = false;
        });
    }
    /** @template T @param {(tx:Db)=>Promise<T>} work @returns {Promise<T>} */
    function transaction(work) {
        return locked(async () => {
            const token = context.getStore();
            if (!token || token.inTransaction) throw new Error('Nested SQLite transactions are not supported');
            await exec('BEGIN IMMEDIATE');
            token.inTransaction = true;
            try {
                const result = await work(api);
                await exec('COMMIT');
                return result;
            } catch (error) {
                try { await exec('ROLLBACK'); }
                catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Transaction and rollback failed'); }
                throw error;
            } finally { token.inTransaction = false; }
        });
    }
    /** A consistent SQLite snapshot, including committed WAL pages, not a file copy.
     * @param {string} destination */
    function backupTo(destination) {
        return locked(async () => {
            if (context.getStore()?.inTransaction) throw new Error('Cannot backup during transaction');
            if (path.resolve(destination) === path.resolve(filename)) throw new Error('Backup destination must differ from source');
            await rejectSidecars(destination);
            const reserved = await fs.open(destination, 'wx', 0o600);
            await reserved.close();
            try {
                await run('VACUUM INTO ?', [destination]);
                const completed = await fs.open(destination, 'r+');
                try { await completed.sync(); } finally { await completed.close(); }
                const manifest = await inspectBackup(destination);
                return manifest;
            } catch (error) { await fs.unlink(destination).catch(() => {}); throw error; }
        });
    }
    const api = { open, close, run, get, all, exec, transaction, backupTo, filename };
    return api;
}

/** Validates actual SQLite contents and versions, never opens the live source.
 * @param {string} filename */
async function inspectBackup(filename) {
    const backup = createDb({ filename, readonly: true });
    await backup.open();
    try {
        /** @type {{integrity_check:string}[]} */
        const integrity = await backup.all('PRAGMA integrity_check');
        if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('SQLite backup integrity check failed');
        /** @type {{name:string}|undefined} */
        const hasVersions = await backup.get("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'");
        /** @type {{version:string,checksum:string}[]} */
        const versions = hasVersions ? await backup.all('SELECT version,checksum FROM schema_migrations ORDER BY version') : [];
        const bytes = await fs.readFile(filename);
        /** @type {{version:string}|undefined} */
        const sqlite = await backup.get('SELECT sqlite_version() AS version');
        return { method: 'vacuum-into', sha256: createHash('sha256').update(bytes).digest('hex'),
            sizeBytes: bytes.length, integrity: 'ok', versions, sqliteVersion: sqlite?.version, createdAt: Date.now() };
    } finally { await backup.close(); }
}

/** Offline restore to a NEW destination only. Caller stops all writers before a real cutover.
 * @param {string} source @param {string} destination */
async function restoreBackup(source, destination) {
    const sourceManifest = await inspectBackup(source);
    await rejectSidecars(destination);
    await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
    await fs.chmod(destination, 0o600);
    try {
        const restored = await inspectBackup(destination);
        if (restored.sha256 !== sourceManifest.sha256) throw new Error('Restore checksum mismatch');
        return restored;
    }
    catch (error) { await fs.unlink(destination).catch(() => {}); throw error; }
}

/** Restores/snapshots must never adopt WAL from another database.
 * @param {string} filename */
async function rejectSidecars(filename) {
    for (const suffix of ['-wal', '-shm']) {
        let exists = true;
        try { await fs.lstat(filename + suffix); }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') exists = false;
            else throw error;
        }
        if (exists) throw new Error('SQLite destination has existing sidecars');
    }
}

module.exports = { createDb, inspectBackup, restoreBackup };
