'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const DEFAULT_ROOT = '/home/petrov/petrovsky/backend/data/rikolino';
const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_EXTENSIONS = { 'image/jpeg': new Set(['.jpg', '.jpeg']), 'image/png': new Set(['.png']), 'image/webp': new Set(['.webp']) };
function normalizeCategory(value) {
    return typeof value === 'string' ? value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

/** Opens a fresh read-only snapshot per request; never initializes Petrovsky data. */
function createRikolinoReader({ rootDir = process.env.RIKOLINO_DIR || DEFAULT_ROOT, random = Math.random } = {}) {
    const root = path.resolve(rootDir);
    async function getImages(category = null, { count = 5 } = {}) {
        if (!Number.isInteger(count) || count < 1 || count > 1000) return [];
        let db;
        let opened = false;
        try {
            const originals = path.join(root, 'originals');
            const databasePath = path.join(root, 'library.db');
            const [rootStat, originalStat, databaseStat] = await Promise.all([fs.lstat(root), fs.lstat(originals), fs.lstat(databasePath)]);
            if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !originalStat.isDirectory() || originalStat.isSymbolicLink() || !databaseStat.isFile() || databaseStat.isSymbolicLink()) return [];
            const realRoot = await fs.realpath(root);
            if (await fs.realpath(originals) !== path.join(realRoot, 'originals')) return [];
            await new Promise((resolve, reject) => {
                db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, error => error ? reject(error) : resolve());
            });
            opened = true;
            db.configure('busyTimeout', 3000);
            const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
            const exec = sql => new Promise((resolve, reject) => db.run(sql, error => error ? reject(error) : resolve()));
            await exec('BEGIN');
            const albums = await all('SELECT id,name,slug FROM albums WHERE published=1 ORDER BY id');
            const normalized = normalizeCategory(category);
            const matching = normalized ? albums.filter(album => normalizeCategory(album.slug) === normalized || normalizeCategory(album.name) === normalized) : albums;
            let rows = [];
            if (matching.length) {
                const placeholders = matching.map(() => '?').join(',');
                rows = await all(`SELECT DISTINCT p.id,p.mime,p.originalPath FROM photos p JOIN album_photos ap ON ap.photoId=p.id WHERE p.deletedAt IS NULL AND ap.albumId IN (${placeholders}) ORDER BY p.id`, matching.map(album => album.id));
            }
            await exec('COMMIT');
            // Preserve the existing random selection policy, independent of pack settings.
            for (let i = rows.length - 1; i > 0; i--) {
                const draw = random();
                const j = Math.floor(Math.max(0, Math.min(0.999999999999, Number.isFinite(draw) ? draw : 0)) * (i + 1));
                [rows[i], rows[j]] = [rows[j], rows[i]];
            }
            const selected = [];
            for (const row of rows) {
                if (selected.length >= count) break;
                if (!PHOTO_ID.test(row.id) || typeof row.originalPath !== 'string') continue;
                const ext = path.extname(row.originalPath).toLowerCase();
                if (!MIME_EXTENSIONS[row.mime]?.has(ext) || row.originalPath !== `originals/${row.id}${ext}`) continue;
                const absolute = path.resolve(root, row.originalPath);
                if (path.dirname(absolute) !== originals) continue;
                let file;
                try {
                    const stat = await fs.lstat(absolute);
                    if (!stat.isFile() || stat.isSymbolicLink()) continue;
                    if (await fs.realpath(absolute) !== path.join(realRoot, row.originalPath)) continue;
                    file = await fs.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
                    const openedStat = await file.stat();
                    if (!openedStat.isFile() || openedStat.size === 0) continue;
                    selected.push({ path: absolute, source: 'rikolino', isTemporary: false });
                } catch (error) {
                    if (!['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES'].includes(error.code)) throw error;
                } finally { if (file) await file.close(); }
            }
            return selected;
        } catch (error) {
            if (['ENOENT', 'ENOTDIR', 'SQLITE_CANTOPEN', 'SQLITE_NOTADB', 'SQLITE_CORRUPT', 'SQLITE_ERROR', 'EACCES'].includes(error.code)) return [];
            throw error;
        } finally {
            if (db && opened) await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
        }
    }
    return { getImages };
}

module.exports = { createRikolinoReader, normalizeCategory, DEFAULT_ROOT };
