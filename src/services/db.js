'use strict';

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('../services/logger');

// DATA_DIR usa una ruta persistente fuera de /tmp
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'bot.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) logger.error('Error al abrir SQLite:', err.message);
    else logger.info('Base de datos SQLite conectada en ' + dbPath);
});

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            jid TEXT PRIMARY KEY,
            xp INTEGER DEFAULT 0,
            level INTEGER DEFAULT 1,
            strikes INTEGER DEFAULT 0
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS lore_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_jid TEXT NOT NULL,
            target_name TEXT,
            event_text TEXT NOT NULL,
            author_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_lore_events_target ON lore_events(target_jid)
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS lore_profiles (
            jid TEXT PRIMARY KEY,
            alias TEXT,
            role TEXT,
            phrase TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

// ─── Utilidad de fecha (centralizada) ─────────────────────────────────────────
// Usa la zona horaria del servidor (configurada vía TZ=America/Mexico_City)
const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getOrCreateUser = (jid) => {
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO users (jid) VALUES (?) ON CONFLICT(jid) DO NOTHING', [jid], (err) => {
            if (err) return reject(err);
            db.get('SELECT * FROM users WHERE jid = ?', [jid], (err, row) => {
                if (err) return reject(err);
                resolve(row || { jid, xp: 0, level: 1, strikes: 0 });
            });
        });
    });
};

const addXp = async (jid, amount = 1) => {
    const user = await getOrCreateUser(jid);
    const newXp = user.xp + amount;
    // Nivel basado en fórmula simple: XP requerida para el nivel N es 20 * N
    const newLevel = Math.floor(newXp / 20) + 1; 

    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET xp = ?, level = ? WHERE jid = ?', [newXp, newLevel, jid], (err) => {
            if (err) reject(err);
            else resolve({ ...user, xp: newXp, level: newLevel, levelUp: newLevel > user.level });
        });
    });
};

const addStrike = async (jid) => {
    const user = await getOrCreateUser(jid);
    const newStrikes = user.strikes + 1;
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET strikes = ? WHERE jid = ?', [newStrikes, jid], (err) => {
            if (err) reject(err);
            else resolve(newStrikes);
        });
    });
};

const removeStrike = async (jid) => {
    const user = await getOrCreateUser(jid);
    const newStrikes = Math.max(0, user.strikes - 1);
    return new Promise((resolve, reject) => {
        db.run('UPDATE users SET strikes = ? WHERE jid = ?', [newStrikes, jid], (err) => {
            if (err) reject(err);
            else resolve(newStrikes);
        });
    });
};

const getTop = (limit = 5) => {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM users ORDER BY xp DESC LIMIT ?', [limit], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};



const addLoreEvent = (targetJid, targetName, eventText, authorName) => {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO lore_events (target_jid, target_name, event_text, author_name) VALUES (?, ?, ?, ?)',
            [targetJid, targetName, eventText, authorName],
            function (err) {
                if (err) return reject(err);
                resolve({ id: this.lastID, targetJid, targetName, eventText, authorName });
            }
        );
    });
};

const getLoreEvents = (targetJid) => {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM lore_events WHERE target_jid = ? ORDER BY id ASC',
            [targetJid],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });
};

const getAllLoreTargets = () => {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT target_jid, target_name, COUNT(*) as total_events, MAX(created_at) as last_event_at
             FROM lore_events
             GROUP BY target_jid
             ORDER BY total_events DESC`,
            [],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });
};

const setLoreProfile = (jid, alias, role, phrase) => {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO lore_profiles (jid, alias, role, phrase, updated_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(jid) DO UPDATE SET
             alias = COALESCE(?, alias),
             role = COALESCE(?, role),
             phrase = COALESCE(?, phrase),
             updated_at = CURRENT_TIMESTAMP`,
            [jid, alias, role, phrase, alias, role, phrase],
            (err) => {
                if (err) return reject(err);
                resolve(true);
            }
        );
    });
};

const getLoreProfile = (jid) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM lore_profiles WHERE jid = ?', [jid], (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
};

const deleteLastLoreEvent = (targetJid) => {
    return new Promise((resolve, reject) => {
        db.run(
            'DELETE FROM lore_events WHERE id = (SELECT MAX(id) FROM lore_events WHERE target_jid = ?)',
            [targetJid],
            function (err) {
                if (err) return reject(err);
                resolve(this.changes > 0);
            }
        );
    });
};

module.exports = {
    db,
    getOrCreateUser,
    addXp,
    addStrike,
    removeStrike,
    getTop,
    getTodayStr,
    addLoreEvent,
    getLoreEvents,
    getAllLoreTargets,
    setLoreProfile,
    getLoreProfile,
    deleteLastLoreEvent
};
