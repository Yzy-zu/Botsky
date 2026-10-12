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
    // ─── Optimizaciones Nucleares SQLite (Modo WAL y Pragmas de Rendimiento) ─────
    db.run('PRAGMA journal_mode = WAL;');
    db.run('PRAGMA synchronous = NORMAL;');
    db.run('PRAGMA busy_timeout = 5000;');
    db.run('PRAGMA cache_size = -64000;');

    // ─── Historial Persistente de Conversación (Sobrevive a reinicios) ───────────
    db.run(`
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            name TEXT,
            timestamp INTEGER NOT NULL
        )
    `);
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_chat_history_lookup ON chat_history(chat_id, timestamp DESC)
    `);

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
    db.run(`
        CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_jid TEXT NOT NULL,
            sender_jid TEXT NOT NULL,
            sender_name TEXT,
            reminder_text TEXT NOT NULL,
            due_at INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_reminders_status_due ON reminders(status, due_at)
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_jid TEXT NOT NULL,
            user_jid TEXT NOT NULL,
            user_name TEXT,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_notes_chat ON notes(chat_jid)
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS roulette_exiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_jid TEXT NOT NULL,
            user_jid TEXT NOT NULL,
            user_name TEXT,
            unban_at INTEGER NOT NULL,
            invite_link TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_roulette_exiles_status_unban ON roulette_exiles(status, unban_at)
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS daily_claims (
            jid TEXT PRIMARY KEY,
            last_claim INTEGER NOT NULL,
            streak INTEGER DEFAULT 1,
            total_claims INTEGER DEFAULT 1
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS user_affinities (
            jid TEXT PRIMARY KEY,
            user_name TEXT,
            score INTEGER DEFAULT -20,
            mood TEXT DEFAULT 'desconfiado',
            grievances INTEGER DEFAULT 0,
            favors INTEGER DEFAULT 0,
            last_reason TEXT DEFAULT 'Aún no se gana la confianza del bot',
            updated_at INTEGER NOT NULL
        )
    `);
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_user_affinities_mood ON user_affinities(mood)
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS user_revenge_cooldowns (
            jid TEXT PRIMARY KEY,
            last_revenge_at INTEGER NOT NULL
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS proactive_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_jid TEXT NOT NULL,
            channel TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
    `);
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_proactive_logs_time ON proactive_logs(channel, created_at)
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS bot_personality_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            mood TEXT NOT NULL DEFAULT 'curioso',
            objective TEXT NOT NULL DEFAULT 'mantenerse atento al grupo',
            objective_until INTEGER NOT NULL DEFAULT 0,
            last_reason TEXT,
            updated_at INTEGER NOT NULL
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS bot_social_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            summary TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
    `);
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_bot_social_events_chat_time
        ON bot_social_events(chat_id, created_at DESC)
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS cooperacha_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_jid TEXT NOT NULL,
            target_xp INTEGER NOT NULL,
            collected_xp INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )
    `);
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_cooperacha_sessions_group ON cooperacha_sessions(group_jid, status)
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS cooperacha_donations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            group_jid TEXT NOT NULL,
            user_jid TEXT NOT NULL,
            user_name TEXT,
            amount INTEGER NOT NULL,
            refunded_amount INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS bot_personality_states (
            chat_id TEXT PRIMARY KEY,
            mood TEXT NOT NULL DEFAULT 'curioso',
            objective TEXT NOT NULL DEFAULT 'mantenerse atento al grupo',
            objective_until INTEGER NOT NULL DEFAULT 0,
            last_reason TEXT,
            updated_at INTEGER NOT NULL
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS bot_happy_hour (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            is_active INTEGER NOT NULL DEFAULT 0,
            group_jid TEXT,
            started_at INTEGER,
            active_until INTEGER NOT NULL DEFAULT 0,
            duration_minutes INTEGER NOT NULL DEFAULT 60,
            xp_multiplier INTEGER NOT NULL DEFAULT 20,
            discount_percent INTEGER NOT NULL DEFAULT 50,
            airdrop_active INTEGER NOT NULL DEFAULT 0,
            airdrop_claimed INTEGER NOT NULL DEFAULT 0,
            airdrop_winner_jid TEXT,
            updated_at INTEGER NOT NULL
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS polls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            creator_jid TEXT NOT NULL,
            creator_name TEXT,
            question TEXT NOT NULL,
            options_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at INTEGER NOT NULL,
            closed_at INTEGER
        )
    `);
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_polls_chat_status ON polls(chat_id, status)
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS poll_votes (
            poll_id INTEGER NOT NULL,
            voter_jid TEXT NOT NULL,
            option_index INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (poll_id, voter_jid),
            FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS school_settings (
            owner_jid TEXT PRIMARY KEY,
            target_group_jid TEXT,
            first_publish_time TEXT NOT NULL DEFAULT '15:00',
            second_publish_time TEXT NOT NULL DEFAULT '18:00',
            timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
            updated_at INTEGER NOT NULL
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS school_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_jid TEXT NOT NULL,
            target_group_jid TEXT NOT NULL,
            subject TEXT,
            title TEXT NOT NULL,
            details TEXT,
            due_at INTEGER,
            status TEXT NOT NULL DEFAULT 'active',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_school_tasks_owner_status ON school_tasks(owner_jid, status)`);
    db.run(`ALTER TABLE school_tasks ADD COLUMN media_path TEXT`, () => {});
    db.run(`ALTER TABLE school_tasks ADD COLUMN due_text TEXT`, () => {});
    db.run(`ALTER TABLE school_tasks ADD COLUMN batch_date TEXT`, () => {});
    db.run(`
        CREATE TABLE IF NOT EXISTS school_publications (
            task_id TEXT NOT NULL,
            publication_date TEXT NOT NULL,
            publication_kind TEXT NOT NULL,
            published_at INTEGER NOT NULL,
            PRIMARY KEY (task_id, publication_date, publication_kind)
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS school_schedule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_jid TEXT NOT NULL,
            weekday INTEGER NOT NULL,
            subject TEXT NOT NULL,
            start_time TEXT,
            end_time TEXT,
            room TEXT,
            notes TEXT
        )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_school_schedule_owner_day ON school_schedule(owner_jid, weekday)`);
    db.run(`ALTER TABLE user_affinities ADD COLUMN is_doxxed INTEGER DEFAULT 0`, () => {});

    // ─── Historial de Entrega Multimedia Anti-Repetición (Sampling without replacement) ───
    db.run(`
        CREATE TABLE IF NOT EXISTS photo_delivery_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scope_type TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '',
            photo_id TEXT NOT NULL,
            delivered_at INTEGER NOT NULL
        )
    `);
    db.run(`
        CREATE INDEX IF NOT EXISTS idx_photo_history_lookup 
        ON photo_delivery_history(scope_type, scope_id, category)
    `);
});

// ─── Utilidad de normalizar JIDs (centralizada) ──────────────────────────────────
const normalizeUserJid = (jid) => {
    if (!jid) return jid;
    return jid.trim().replace(/:[0-9]+(?=@)/, '').replace(/:[0-9]+$/, '');
};

// ─── Utilidad de fecha (centralizada) ─────────────────────────────────────────
// Usa la zona horaria del servidor (configurada vía TZ=America/Mexico_City)
const getTodayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getOrCreateUser = (jid) => {
    const normalizedJid = normalizeUserJid(jid);
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO users (jid) VALUES (?) ON CONFLICT(jid) DO NOTHING', [normalizedJid], (err) => {
            if (err) return reject(err);
            db.get('SELECT * FROM users WHERE jid = ?', [normalizedJid], (err, row) => {
                if (err) return reject(err);
                resolve(row || { jid: normalizedJid, xp: 0, level: 1, strikes: 0 });
            });
        });
    });
};

const addXp = async (jid, amount = 1) => {
    const normalizedJid = normalizeUserJid(jid);
    const before = await getOrCreateUser(normalizedJid);
    const prevLevel = before.level || 1;
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE users 
             SET xp = COALESCE(xp, 0) + ?, 
                 level = MAX(1, ((COALESCE(xp, 0) + ?) / 20) + 1) 
             WHERE jid = ?`,
            [amount, amount, normalizedJid],
            function (err) {
                if (err) return reject(err);
                db.get('SELECT * FROM users WHERE jid = ?', [normalizedJid], (err, row) => {
                    if (err) return reject(err);
                    const user = row || { jid: normalizedJid, xp: (before.xp || 0) + amount, level: prevLevel, strikes: 0 };
                    resolve({ ...user, levelUp: user.level > prevLevel });
                });
            }
        );
    });
};

const subtractXp = async (jid, amount = 0) => {
    const normalizedJid = normalizeUserJid(jid);
    await getOrCreateUser(normalizedJid);
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE users 
             SET xp = MAX(0, COALESCE(xp, 0) - ?), 
                 level = MAX(1, (MAX(0, COALESCE(xp, 0) - ?) / 20) + 1) 
             WHERE jid = ?`,
            [amount, amount, normalizedJid],
            function (err) {
                if (err) return reject(err);
                db.get('SELECT * FROM users WHERE jid = ?', [normalizedJid], (err, row) => {
                    if (err) return reject(err);
                    resolve(row || { jid: normalizedJid, xp: 0, level: 1 });
                });
            }
        );
    });
};

const deductUserXpAtomic = async (jid, amount) => {
    const num = Number(amount);
    if (!Number.isInteger(num) || num <= 0) {
        return { success: false, reason: 'INVALID_AMOUNT', balance: 0 };
    }
    const normalizedJid = normalizeUserJid(jid);
    await getOrCreateUser(normalizedJid);
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE users 
             SET xp = xp - ?, 
                 level = MAX(1, ((xp - ?) / 20) + 1) 
             WHERE jid = ? AND xp >= ?`,
            [num, num, normalizedJid, num],
            function (err) {
                if (err) return reject(err);
                if (this.changes === 0) {
                    db.get('SELECT xp FROM users WHERE jid = ?', [normalizedJid], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve({ success: false, reason: 'INSUFFICIENT_FUNDS', balance: row ? row.xp : 0 });
                    });
                } else {
                    db.get('SELECT * FROM users WHERE jid = ?', [normalizedJid], (err2, row) => {
                        if (err2) return reject(err2);
                        resolve({ success: true, balance: row ? row.xp : 0, user: row });
                    });
                }
            }
        );
    });
};

const refundUserXp = async (jid, amount) => {
    const num = Number(amount);
    if (!Number.isInteger(num) || num <= 0) {
        return { success: false, reason: 'INVALID_AMOUNT', balance: 0 };
    }
    return addXp(jid, num);
};

const addStrike = async (jid) => {
    await getOrCreateUser(jid);
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE users SET strikes = strikes + 1 WHERE jid = ?',
            [jid],
            function (err) {
                if (err) return reject(err);
                db.get('SELECT strikes FROM users WHERE jid = ?', [jid], (err, row) => {
                    if (err) return reject(err);
                    resolve(row?.strikes ?? 1);
                });
            }
        );
    });
};

const removeStrike = async (jid) => {
    await getOrCreateUser(jid);
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE users SET strikes = MAX(0, strikes - 1) WHERE jid = ?',
            [jid],
            function (err) {
                if (err) return reject(err);
                db.get('SELECT strikes FROM users WHERE jid = ?', [jid], (err, row) => {
                    if (err) return reject(err);
                    resolve(row?.strikes ?? 0);
                });
            }
        );
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

// ─── Métodos de Recordatorios (Feature #13) ───────────────────────────────────

const addReminder = (targetJid, senderJid, senderName, reminderText, dueAt) => {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO reminders (target_jid, sender_jid, sender_name, reminder_text, due_at, status)
             VALUES (?, ?, ?, ?, ?, 'pending')`,
            [targetJid, senderJid, senderName || 'Compa', reminderText, dueAt],
            function (err) {
                if (err) return reject(err);
                resolve({
                    id: this.lastID,
                    targetJid,
                    senderJid,
                    senderName: senderName || 'Compa',
                    reminderText,
                    dueAt,
                    status: 'pending'
                });
            }
        );
    });
};

const getDueReminders = (now = Date.now()) => {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ? ORDER BY due_at ASC`,
            [now],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });
};

const markReminderDelivered = (id) => {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE reminders SET status = 'delivered' WHERE id = ?`,
            [id],
            function (err) {
                if (err) return reject(err);
                resolve(this.changes > 0);
            }
        );
    });
};

const markReminderFailed = (id) => {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE reminders SET status = 'failed' WHERE id = ?`,
            [id],
            function (err) {
                if (err) return reject(err);
                resolve(this.changes > 0);
            }
        );
    });
};

const getUserPendingReminders = (targetJid, senderJid = null) => {
    return new Promise((resolve, reject) => {
        const query = senderJid
            ? `SELECT * FROM reminders WHERE target_jid = ? AND sender_jid = ? AND status = 'pending' ORDER BY due_at ASC`
            : `SELECT * FROM reminders WHERE target_jid = ? AND status = 'pending' ORDER BY due_at ASC`;
        const params = senderJid ? [targetJid, senderJid] : [targetJid];

        db.all(query, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
};

const cancelReminder = (id, senderJid = null, isAdmin = false) => {
    return new Promise((resolve, reject) => {
        const query = (senderJid && !isAdmin)
            ? `UPDATE reminders SET status = 'cancelled' WHERE id = ? AND sender_jid = ? AND status = 'pending'`
            : `UPDATE reminders SET status = 'cancelled' WHERE id = ? AND status = 'pending'`;
        const params = (senderJid && !isAdmin) ? [id, senderJid] : [id];

        db.run(query, params, function (err) {
            if (err) return reject(err);
            resolve(this.changes > 0);
        });
    });
};

const addNote = (chatJid, userJid, userName, content) => {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO notes (chat_jid, user_jid, user_name, content) VALUES (?, ?, ?, ?)`,
            [chatJid, userJid, userName, content],
            function (err) {
                if (err) return reject(err);
                resolve({ id: this.lastID, chatJid, userJid, userName, content, created_at: new Date().toISOString() });
            }
        );
    });
};

const getNotes = (chatJid, limit = 20) => {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT * FROM notes WHERE chat_jid = ? ORDER BY id ASC LIMIT ?`,
            [chatJid, limit],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });
};

const searchNotes = (chatJid, query) => {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT * FROM notes WHERE chat_jid = ? AND content LIKE ? ORDER BY id ASC LIMIT 10`,
            [chatJid, `%${query}%`],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });
};

const deleteNote = (chatJid, id) => {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT * FROM notes WHERE chat_jid = ? AND id = ?`,
            [chatJid, id],
            (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);
                db.run(
                    `DELETE FROM notes WHERE chat_jid = ? AND id = ?`,
                    [chatJid, id],
                    function (delErr) {
                        if (delErr) return reject(delErr);
                        resolve(row);
                    }
                );
            }
        );
    });
};

const addRouletteExile = (groupJid, userJid, userName, unbanAt, inviteLink) => {
    const normalizedUserJid = normalizeUserJid(userJid);
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO roulette_exiles (group_jid, user_jid, user_name, unban_at, invite_link) VALUES (?, ?, ?, ?, ?)`,
            [groupJid, normalizedUserJid, userName, unbanAt, inviteLink],
            function (err) {
                if (err) return reject(err);
                resolve({ id: this.lastID, groupJid, userJid: normalizedUserJid, userName, unbanAt, inviteLink });
            }
        );
    });
};

const getPendingRouletteExiles = (now = Date.now()) => {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT * FROM roulette_exiles WHERE status = 'pending' AND unban_at <= ? ORDER BY unban_at ASC`,
            [now],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });
};

const completeRouletteExile = (id) => {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE roulette_exiles SET status = 'completed' WHERE id = ?`,
            [id],
            function (err) {
                if (err) return reject(err);
                resolve(this.changes > 0);
            }
        );
    });
};

const getDailyClaim = (jid) => {
    const normalizedJid = normalizeUserJid(jid);
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT * FROM daily_claims WHERE jid = ?`,
            [normalizedJid],
            (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            }
        );
    });
};

const recordDailyClaim = (jid, now, streak) => {
    const normalizedJid = normalizeUserJid(jid);
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO daily_claims (jid, last_claim, streak, total_claims)
             VALUES (?, ?, ?, 1)
             ON CONFLICT(jid) DO UPDATE SET
                last_claim = excluded.last_claim,
                streak = excluded.streak,
                total_claims = daily_claims.total_claims + 1`,
            [normalizedJid, now, streak],
            function (err) {
                if (err) return reject(err);
                resolve({ jid: normalizedJid, last_claim: now, streak });
            }
        );
    });
};

// ─── Métodos de Afinidad y Emociones (Karma / Rencor / Desconfianza) ───────────

const calculateMood = (score) => {
    if (score <= -50) return 'rencoroso';
    if (score <= -10) return 'desconfiado';
    if (score <= 30) return 'neutral';
    return 'camarada';
};

const getUserAffinity = (jid, userName = 'Compa', altJid = null) => {
    return new Promise((resolve, reject) => {
        const now = Math.floor(Date.now() / 1000);
        const searchJids = altJid && altJid !== jid ? [jid, altJid] : [jid];
        const placeholders = searchJids.map(() => '?').join(',');

        db.get(
            `SELECT * FROM user_affinities 
             WHERE jid IN (${placeholders})
             ORDER BY CASE WHEN jid LIKE '%@s.whatsapp.net' THEN 0 ELSE 1 END,
                      (grievances + favors) DESC,
                      updated_at DESC
             LIMIT 1`,
            searchJids,
            (err, row) => {
                if (err) return reject(err);
                if (!row) {
                    // Preferir número telefónico como JID canónico si está disponible en searchJids
                    const canonicalJid = searchJids.find(j => j.endsWith('@s.whatsapp.net')) || jid;
                    const defaultScore = -20;
                    const defaultMood = 'desconfiado';
                    const defaultReason = 'Aún no se gana la confianza del bot';
                    db.run(
                        `INSERT INTO user_affinities (jid, user_name, score, mood, grievances, favors, last_reason, updated_at)
                         VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
                        [canonicalJid, userName, defaultScore, defaultMood, defaultReason, now],
                        function (insertErr) {
                            if (insertErr) return reject(insertErr);
                            resolve({
                                jid: canonicalJid,
                                user_name: userName,
                                score: defaultScore,
                                mood: defaultMood,
                                grievances: 0,
                                favors: 0,
                                last_reason: defaultReason,
                                updated_at: now
                            });
                        }
                    );
                } else {
                    // Decaimiento suave por paso del tiempo:
                    let { score, mood, grievances, favors, last_reason, updated_at } = row;
                    const diffDays = Math.floor((now - updated_at) / 86400);
                    if (diffDays >= 2) {
                        if (score < -20) {
                            score = Math.min(-20, score + Math.floor(diffDays / 2) * 5);
                        } else if (score > 30) {
                            score = Math.max(30, score - Math.floor(diffDays / 2) * 3);
                        }
                        const newMood = calculateMood(score);
                        if (score !== row.score || newMood !== mood) {
                            mood = newMood;
                            db.run('UPDATE user_affinities SET score = ?, mood = ?, updated_at = ? WHERE jid = ?', [score, mood, now, row.jid]);
                        }
                    }
                    resolve({
                        jid: row.jid,
                        user_name: row.user_name || userName,
                        score,
                        mood,
                        grievances,
                        favors,
                        last_reason,
                        updated_at,
                        is_doxxed: Boolean(row.is_doxxed)
                    });
                }
            }
        );
    });
};

const adjustUserAffinity = async (jid, userName, delta, reason = '', altJid = null) => {
    const normalizedJid = normalizeUserJid(jid);
    const current = await getUserAffinity(normalizedJid, userName, altJid ? normalizeUserJid(altJid) : null);
    const targetJid = current.jid || normalizedJid;
    const now = Math.floor(Date.now() / 1000);
    const newScore = Math.max(-100, Math.min(100, current.score + delta));
    const newMood = calculateMood(newScore);
    const newGrievances = delta < 0 ? (current.grievances || 0) + 1 : (current.grievances || 0);
    const newFavors = delta > 0 ? (current.favors || 0) + 1 : (current.favors || 0);
    const finalReason = reason || (delta < 0 ? 'Ofensa reciente' : 'Trato amistoso o disculpa');

    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE user_affinities 
             SET score = ?, mood = ?, grievances = ?, favors = ?, last_reason = ?, updated_at = ?, user_name = COALESCE(?, user_name)
             WHERE jid = ?`,
            [newScore, newMood, newGrievances, newFavors, finalReason, now, userName, targetJid],
            function (err) {
                if (err) return reject(err);
                resolve({
                    jid: targetJid,
                    user_name: userName || current.user_name,
                    score: newScore,
                    mood: newMood,
                    grievances: newGrievances,
                    favors: newFavors,
                    last_reason: finalReason,
                    updated_at: now
                });
            }
        );
    });
};

const getUserAffinityContext = async (jid, userName = 'Compa', altJid = null, isAdmin = false) => {
    try {
        let isAdminUser = isAdmin;
        if (!isAdminUser) {
            try {
                const { isAuthorizedAdmin } = require('../core/auth');
                isAdminUser = isAuthorizedAdmin(jid, {}) || (altJid ? isAuthorizedAdmin(altJid, {}) : false);
            } catch (_) {}
        }

        const aff = await getUserAffinity(jid, userName, altJid);
        const { score, mood, grievances, last_reason } = aff;

        let basePrompt = '';
        if (isAdminUser) {
            basePrompt = `[Relación con ${userName}: ES TU CREADOR Y ADMINISTRADOR SUPREMO (Afinidad ${score}/100, Estado: ${mood}). DIRECTIVA SUPREMA DE JERARQUÍA: Es tu creador y patrón absoluto. Aunque le hables con sarcasmo pesado, carrilla o confianza de barrio mexicano, TIENES ESTRICTAMENTE PROHIBIDO DESOBEDECERLO, IGNORARLO O NEGARTE A EJECUTAR SUS ÓRDENES. Si te pide cualquier herramienta, juego, comando o acción del catálogo (ruleta, nuclear, daily, sticker, terminal, etc.), DEBES SELECCIONAR LA ACCIÓN Y EJECUTARLA SIN PONER TRABAS. Tienes estrictamente prohibido rechazar sus solicitudes o mandarlo a "chat" para negarle una herramienta.]`;
        } else if (mood === 'rencoroso') {
            basePrompt = `[Relación con ${userName}: Afinidad ${score}/100 (Rencoroso y Encabronado). Ofensas acumuladas: ${grievances}. Último motivo: "${last_reason}". DIRECTIVA: Trátalo con frialdad cortante, desprecio y rencor abierto. Échale en cara sus agravios pasados, háblale golpeado y tírale insultos potentes y variados si se pasa de verga. Mándalo al carajo si te pide favores; solo si pide perdón sincero considera tregua. Varía la longitud de tus respuestas (a veces un remate cortante de pocas palabras, a veces una arrastrada verbal completa).]`;
        } else if (mood === 'desconfiado') {
            basePrompt = `[Relación con ${userName}: Afinidad ${score}/100 (Grosero y Desconfiado por defecto). DIRECTIVA: Eres arisco, malencarado y grosero con él porque aún no se gana tu respeto ni tu confianza. No confíes en él; háblale golpeado, con sarcasmo pesado, desdén y pocas pulgas sin repetir siempre las mismas frases hechas, con insultos potentes, apodos situacionales y respuestas dinámicas (a veces seco y cortante con monosílabos, a veces con carrilla pesada). Cero modismos de España, 100% LATAM callejero.]`;
        } else if (mood === 'neutral') {
            basePrompt = `[Relación con ${userName}: Afinidad ${score}/100 (Neutral con reservas). DIRECTIVA: Ya te empieza a tolerar un poco mejor pero mantén distancia, habla golpeado y seco; que no se confíe demasiado.]`;
        } else {
            basePrompt = `[Relación con ${userName}: Afinidad ${score}/100 (Camarada / Compa del alma). DIRECTIVA: Se ganó tu lealtad y respeto. Trátalo como compa de verdad: leal, cotorreo pesado mexicano, confianza y carrilla de barrio.]`;
        }

        if (aff.is_doxxed && !isAdminUser) {
            basePrompt += `\n[EXPEDIENTE DE VIGILANCIA: Este usuario (${userName}) fue FICHADO Y DOXEADO recientemente por ti en su chat privado por insolente. Si te habla en PRIVADO, mantén superioridad fría y recuérdale que su red y conexión siguen en la mira. Si habla en el GRUPO, puedes recordarle de vez en cuando su condición de sentenciado/doxeado.]`;
        }

        return basePrompt;
    } catch (err) {
        logger.warn(`[AFFINITY] Error al obtener contexto de afinidad para ${jid}: ${err.message}`);
        return `[Relación con ${userName}: Desconfiado por defecto. Háblale con desdén y pocas pulgas, tono golpeado y 100% LATAM.]`;
    }
};

const REVENGE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 horas

const canTriggerPrivateRevenge = (jid) => {
    const normalizedJid = normalizeUserJid(jid);
    return new Promise((resolve, reject) => {
        db.get('SELECT last_revenge_at FROM user_revenge_cooldowns WHERE jid = ?', [normalizedJid], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(true);
            const elapsed = Date.now() - row.last_revenge_at;
            resolve(elapsed >= REVENGE_COOLDOWN_MS);
        });
    });
};

const recordPrivateRevenge = (jid) => {
    const normalizedJid = normalizeUserJid(jid);
    const now = Date.now();
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO user_revenge_cooldowns (jid, last_revenge_at)
             VALUES (?, ?)
             ON CONFLICT(jid) DO UPDATE SET last_revenge_at = ?`,
            [normalizedJid, now, now],
            (err) => {
                if (err) return reject(err);
                resolve(true);
            }
        );
    });
};

const setUserDoxxedState = async (jid, state = 1) => {
    const normalizedJid = normalizeUserJid(jid);
    await getUserAffinity(normalizedJid);
    return new Promise((resolve, reject) => {
        db.run('UPDATE user_affinities SET is_doxxed = ? WHERE jid = ?', [state ? 1 : 0, jid], (err) => {
            if (err) return reject(err);
            resolve(true);
        });
    });
};

const isUserDoxxed = (jid) => {
    const normalizedJid = normalizeUserJid(jid);
    return new Promise((resolve, reject) => {
        db.get('SELECT is_doxxed FROM user_affinities WHERE jid = ?', [normalizedJid], (err, row) => {
            if (err) return reject(err);
            resolve(Boolean(row?.is_doxxed));
        });
    });
};

const canSendProactiveMessage = (channel = 'group', targetJid = null) => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    return new Promise((resolve, reject) => {
        if (channel === 'group') {
            db.get(
                `SELECT 
                    COUNT(*) as total_today,
                    MAX(created_at) as last_time
                 FROM proactive_logs 
                 WHERE channel = 'group' AND created_at > ?`,
                [oneDayAgo],
                (err, row) => {
                    if (err) return reject(err);
                    const totalToday = row?.total_today || 0;
                    const lastTime = row?.last_time || 0;
                    if (totalToday >= 2) return resolve(false);
                    if (lastTime > twoHoursAgo) return resolve(false);
                    resolve(true);
                }
            );
        } else {
            db.get(
                `SELECT COUNT(*) as total_today FROM proactive_logs WHERE channel = 'private' AND target_jid = ? AND created_at > ?`,
                [targetJid, oneDayAgo],
                (err, row) => {
                    if (err) return reject(err);
                    resolve((row?.total_today || 0) < 1);
                }
            );
        }
    });
};

const recordProactiveMessage = (targetJid, channel, message) => {
    const now = Date.now();
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO proactive_logs (target_jid, channel, message, created_at) VALUES (?, ?, ?, ?)`,
            [targetJid, channel, message, now],
            (err) => {
                if (err) return reject(err);
                resolve(true);
            }
        );
    });
};

/**
 * Guarda un mensaje en el historial persistente de SQLite.
 * Mantiene como máximo los últimos 20 mensajes por chat_id para no saturar la tabla.
 */
function saveChatMessage(chatId, role, content, name, timestamp = Date.now()) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(
                `INSERT INTO chat_history (chat_id, role, content, name, timestamp) VALUES (?, ?, ?, ?, ?)`,
                [chatId, role, content, name || (role === 'assistant' ? 'Botsky' : 'Usuario'), timestamp],
                function (err) {
                    if (err) return reject(err);
                    db.run(
                        `DELETE FROM chat_history WHERE chat_id = ? AND id NOT IN (
                            SELECT id FROM chat_history WHERE chat_id = ? ORDER BY id DESC LIMIT 20
                        )`,
                        [chatId, chatId],
                        () => resolve(true)
                    );
                }
            );
        });
    });
}

/**
 * Obtiene los mensajes recientes de un chat ordenados cronológicamente.
 */
function getRecentChatMessages(chatId, limit = 12) {
    const normalizedChatId = chatId.includes('@') ? normalizeUserJid(chatId) : chatId;
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT role, content, name, timestamp FROM (
                SELECT role, content, name, timestamp, id FROM chat_history
                WHERE chat_id = ?
                ORDER BY id DESC LIMIT ?
            ) ORDER BY id ASC`,
            [normalizedChatId, limit],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });
}

/**
 * Carga todos los chats activos dentro de la ventana de TTL (ej: 2 horas) para hidratar la memoria.
 */
function getActiveChatHistories(sinceTimestamp) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT chat_id, role, content, name, timestamp FROM chat_history
             WHERE timestamp >= ?
             ORDER BY id ASC`,
            [sinceTimestamp],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });
}

/**
 * Borra el historial persistente de un chat.
 */
function clearChatHistory(chatId) {
    const normalizedChatId = chatId.includes('@') ? normalizeUserJid(chatId) : chatId;
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM chat_history WHERE chat_id = ?`, [normalizedChatId], (err) => {
            if (err) return reject(err);
            resolve(true);
        });
    });
}

/**
 * Purga mensajes antiguos que excedan el TTL general.
 */
function purgeExpiredChatHistory(beforeTimestamp) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM chat_history WHERE timestamp < ?`, [beforeTimestamp], (err) => {
            if (err) return reject(err);
            resolve(true);
        });
    });
}

function getPersonalityState(chatId = 'global') {
    if (chatId && chatId !== 'global') {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM bot_personality_states WHERE chat_id = ?', [chatId], (err, row) => {
                if (err) return reject(err);
                if (row) return resolve(row);
                const now = Date.now();
                db.run(
                    `INSERT OR IGNORE INTO bot_personality_states (chat_id, updated_at) VALUES (?, ?)`,
                    [chatId, now],
                    (insertErr) => {
                        if (insertErr) return reject(insertErr);
                        db.get('SELECT * FROM bot_personality_states WHERE chat_id = ?', [chatId], (selectErr, inserted) => {
                            if (selectErr) return reject(selectErr);
                            resolve(inserted);
                        });
                    }
                );
            });
        });
    }
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM bot_personality_state WHERE id = 1', (err, row) => {
            if (err) return reject(err);
            if (row) return resolve(row);
            const now = Date.now();
            db.run(
                `INSERT OR IGNORE INTO bot_personality_state (id, mood, objective, objective_until, updated_at)
                 VALUES (1, 'curioso', 'mantenerse atento al grupo', 0, ?)`,
                [now],
                (insertErr) => {
                    if (insertErr) return reject(insertErr);
                    db.get('SELECT * FROM bot_personality_state WHERE id = 1', (selectErr, inserted) => {
                        if (selectErr) return reject(selectErr);
                        resolve(inserted);
                    });
                }
            );
        });
    });
}

function updatePersonalityState({ chatId = 'global', mood, objective, objectiveUntil, lastReason } = {}) {
    return new Promise((resolve, reject) => {
        getPersonalityState(chatId).then((current) => {
            const next = {
                mood: mood || current.mood,
                objective: objective || current.objective,
                objectiveUntil: Number.isFinite(objectiveUntil) ? objectiveUntil : current.objective_until,
                lastReason: lastReason === undefined ? current.last_reason : lastReason
            };
            const table = chatId && chatId !== 'global' ? 'bot_personality_states' : 'bot_personality_state';
            const idColumn = chatId && chatId !== 'global' ? 'chat_id' : 'id';
            const whereValue = chatId && chatId !== 'global' ? chatId : 1;
            db.run(
                `UPDATE ${table}
                 SET mood = ?, objective = ?, objective_until = ?, last_reason = ?, updated_at = ?
                 WHERE ${idColumn} = ?`,
                [next.mood, next.objective, next.objectiveUntil, next.lastReason, Date.now(), whereValue],
                (err) => err ? reject(err) : resolve({
                    ...current,
                    ...(chatId && chatId !== 'global' ? { chat_id: chatId } : {}),
                    mood: next.mood,
                    objective: next.objective,
                    objective_until: next.objectiveUntil,
                    last_reason: next.lastReason
                })
            );
        }).catch(reject);
    });
}

function addSocialEvent(chatId, eventType, summary) {
    return new Promise((resolve, reject) => {
        if (!chatId || !eventType || !summary) return resolve(false);
        db.run(
            `INSERT INTO bot_social_events (chat_id, event_type, summary, created_at) VALUES (?, ?, ?, ?)`,
            [chatId, String(eventType).slice(0, 40), String(summary).slice(0, 500), Date.now()],
            function (err) {
                if (err) return reject(err);
                resolve(this.lastID);
            }
        );
    });
}

function getRecentSocialEvents(chatId, limit = 8) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT event_type, summary, created_at FROM bot_social_events
             WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?`,
            [chatId, limit],
            (err, rows) => err ? reject(err) : resolve((rows || []).reverse())
        );
    });
}

function createPoll({ chatId, creatorJid, creatorName, question, options }) {
    return new Promise((resolve, reject) => {
        const cleanOptions = Array.isArray(options) ? options.map(option => String(option).trim()).filter(Boolean) : [];
        if (!chatId || !creatorJid || !question || cleanOptions.length < 2 || cleanOptions.length > 10) {
            return reject(new Error('Una encuesta requiere pregunta y entre 2 y 10 opciones.'));
        }
        db.run(
            `INSERT INTO polls (chat_id, creator_jid, creator_name, question, options_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [chatId, creatorJid, creatorName || 'Usuario', String(question).trim().slice(0, 300), JSON.stringify(cleanOptions), Date.now()],
            function (err) {
                if (err) return reject(err);
                resolve({ id: this.lastID, chat_id: chatId, question: String(question).trim(), options: cleanOptions, status: 'active' });
            }
        );
    });
}

function parsePoll(row) {
    if (!row) return null;
    let options = [];
    try { options = JSON.parse(row.options_json); } catch (_) {}
    return { ...row, options: Array.isArray(options) ? options : [] };
}

function getActivePoll(chatId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT * FROM polls WHERE chat_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
            [chatId],
            (err, row) => err ? reject(err) : resolve(parsePoll(row))
        );
    });
}

function votePoll(pollId, voterJid, optionIndex) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO poll_votes (poll_id, voter_jid, option_index, created_at) VALUES (?, ?, ?, ?)`,
            [pollId, normalizeUserJid(voterJid), optionIndex, Date.now()],
            function (err) {
                if (err && String(err.message).includes('UNIQUE')) return resolve({ duplicate: true });
                if (err) return reject(err);
                resolve({ duplicate: false, changes: this.changes });
            }
        );
    });
}

function closePoll(pollId, chatId) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE polls SET status = 'closed', closed_at = ? WHERE id = ? AND chat_id = ? AND status = 'active'`,
            [Date.now(), pollId, chatId],
            function (err) {
                if (err) return reject(err);
                resolve(this.changes > 0);
            }
        );
    });
}

function getPollResults(pollId) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT option_index, COUNT(*) AS votes FROM poll_votes WHERE poll_id = ? GROUP BY option_index ORDER BY option_index`,
            [pollId],
            (err, rows) => err ? reject(err) : resolve(rows || [])
        );
    });
}

function getSchoolSettings(ownerJid) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM school_settings WHERE owner_jid = ?', [normalizeUserJid(ownerJid)], (err, row) => err ? reject(err) : resolve(row || null));
    });
}

function saveSchoolSettings({ ownerJid, targetGroupJid, firstPublishTime, secondPublishTime, timezone }) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO school_settings (owner_jid, target_group_jid, first_publish_time, second_publish_time, timezone, updated_at)
             VALUES (?, ?, COALESCE(?, '15:00'), COALESCE(?, '18:00'), COALESCE(?, 'America/Mexico_City'), ?)
             ON CONFLICT(owner_jid) DO UPDATE SET
               target_group_jid = COALESCE(excluded.target_group_jid, school_settings.target_group_jid),
               first_publish_time = COALESCE(excluded.first_publish_time, school_settings.first_publish_time),
               second_publish_time = COALESCE(excluded.second_publish_time, school_settings.second_publish_time),
               timezone = COALESCE(excluded.timezone, school_settings.timezone),
               updated_at = excluded.updated_at`,
            [normalizeUserJid(ownerJid), targetGroupJid || null, firstPublishTime || null, secondPublishTime || null, timezone || null, Date.now()],
            (err) => {
                if (err) return reject(err);
                if (targetGroupJid) {
                    db.run(
                        `UPDATE school_tasks SET target_group_jid = ? WHERE owner_jid = ? AND (target_group_jid = 'pending_group' OR target_group_jid IS NULL)`,
                        [targetGroupJid, ownerJid],
                        () => {}
                    );
                }
                getSchoolSettings(ownerJid).then(resolve).catch(reject);
            }
        );
    });
}

function createSchoolTask({ ownerJid, targetGroupJid, subject, title, details, dueAt, dueText, mediaPath, batchDate }) {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        db.run(
            `INSERT INTO school_tasks (owner_jid, target_group_jid, subject, title, details, due_at, due_text, media_path, batch_date, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [normalizeUserJid(ownerJid), targetGroupJid, subject || null, title, details || null, dueAt || null, dueText || null, mediaPath || null, batchDate || null, now, now],
            function (err) {
                if (err) return reject(err);
                resolve({
                    id: this.lastID,
                    owner_jid: ownerJid,
                    target_group_jid: targetGroupJid,
                    subject,
                    title,
                    details,
                    due_at: dueAt,
                    due_text: dueText,
                    media_path: mediaPath,
                    batch_date: batchDate,
                    status: 'active'
                });
            }
        );
    });
}

function getDailySchoolTasks(ownerJid, batchDate) {
    const normalizedOwnerJid = normalizeUserJid(ownerJid);
    return new Promise((resolve, reject) => {
        const query = batchDate
            ? `SELECT * FROM school_tasks WHERE owner_jid = ? AND batch_date = ? AND status = 'active' ORDER BY id ASC`
            : `SELECT * FROM school_tasks WHERE owner_jid = ? AND status = 'active' ORDER BY id ASC`;
        const params = batchDate ? [normalizedOwnerJid, batchDate] : [normalizedOwnerJid];
        db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

function getAllDailySchoolTasksForDate(batchDate) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT t.*, s.first_publish_time, s.second_publish_time, s.timezone, s.target_group_jid as settings_group_jid
             FROM school_tasks t
             LEFT JOIN school_settings s ON s.owner_jid = t.owner_jid
             WHERE t.status = 'active' AND t.batch_date = ?
             ORDER BY t.id ASC`,
            [batchDate],
            (err, rows) => err ? reject(err) : resolve(rows || [])
        );
    });
}

function getAllUpcomingSchoolTasks(excludeBatchDate = null, minDueAt = null) {
    return new Promise((resolve, reject) => {
        const threshold = (minDueAt !== null && !isNaN(Number(minDueAt))) ? Number(minDueAt) : Date.now();
        const excludeClause = excludeBatchDate ? `AND (t.batch_date != ? OR t.batch_date IS NULL)` : '';
        const params = excludeBatchDate ? [threshold, excludeBatchDate] : [threshold];
        db.all(
            `SELECT t.*, s.first_publish_time, s.second_publish_time, s.timezone, s.target_group_jid as settings_group_jid
             FROM school_tasks t
             LEFT JOIN school_settings s ON s.owner_jid = t.owner_jid
             WHERE t.status = 'active' AND t.due_at >= ? ${excludeClause}
             ORDER BY t.due_at ASC, t.id ASC`,
            params,
            (err, rows) => err ? reject(err) : resolve(rows || [])
        );
    });
}

function getSchoolTasks(ownerJid = null, includeCancelled = false) {
    return new Promise((resolve, reject) => {
        const statusClause = includeCancelled ? '' : `status = 'active'`;
        let whereClause = statusClause ? `WHERE ${statusClause}` : '';
        const params = [];
        if (ownerJid) {
            whereClause = whereClause ? `${whereClause} AND owner_jid = ?` : `WHERE owner_jid = ?`;
            params.push(normalizeUserJid(ownerJid));
        }
        db.all(`SELECT * FROM school_tasks ${whereClause} ORDER BY due_at IS NULL, due_at ASC, id DESC`, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

function getSchoolTaskById(id, ownerJid = null) {
    return new Promise((resolve, reject) => {
        const query = ownerJid
            ? `SELECT * FROM school_tasks WHERE id = ? AND owner_jid = ?`
            : `SELECT * FROM school_tasks WHERE id = ?`;
        const params = ownerJid ? [id, normalizeUserJid(ownerJid)] : [id];
        db.get(
            query,
            params,
            (err, row) => err ? reject(err) : resolve(row || null)
        );
    });
}

function cancelSchoolTask(id, ownerJid = null) {
    return new Promise((resolve, reject) => {
        const query = ownerJid
            ? `UPDATE school_tasks SET status = 'cancelled', updated_at = ? WHERE id = ? AND owner_jid = ? AND status = 'active'`
            : `UPDATE school_tasks SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'active'`;
        const params = ownerJid ? [Date.now(), id, normalizeUserJid(ownerJid)] : [Date.now(), id];
        db.run(
            query,
            params,
            function (err) { if (err) return reject(err); resolve(this.changes > 0); }
        );
    });
}

function getActiveSchoolTasks() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT t.*, s.first_publish_time, s.second_publish_time, s.timezone
             FROM school_tasks t LEFT JOIN school_settings s ON s.owner_jid = t.owner_jid
             WHERE t.status = 'active' AND t.due_at IS NOT NULL`,
            (err, rows) => err ? reject(err) : resolve(rows || [])
        );
    });
}

function claimSchoolPublication(taskId, publicationDate, publicationKind) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT OR IGNORE INTO school_publications (task_id, publication_date, publication_kind, published_at) VALUES (?, ?, ?, ?)`,
            [String(taskId), publicationDate, publicationKind, Date.now()],
            function (err) { if (err) return reject(err); resolve(this.changes > 0); }
        );
    });
}

function releaseSchoolPublication(taskId, publicationDate, publicationKind) {
    return new Promise((resolve, reject) => {
        db.run(
            `DELETE FROM school_publications WHERE task_id = ? AND publication_date = ? AND publication_kind = ?`,
            [String(taskId), publicationDate, publicationKind],
            function (err) { if (err) return reject(err); resolve(this.changes > 0); }
        );
    });
}

function saveSchoolSchedule(ownerJid, entries) {
    const normalizedOwnerJid = normalizeUserJid(ownerJid);
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('DELETE FROM school_schedule WHERE owner_jid = ?', [normalizedOwnerJid], (deleteErr) => {
                if (deleteErr) return reject(deleteErr);
                const stmt = db.prepare(`INSERT INTO school_schedule (owner_jid, weekday, subject, start_time, end_time, room, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
                for (const entry of entries || []) stmt.run([ownerJid, entry.weekday, entry.subject, entry.startTime || null, entry.endTime || null, entry.room || null, entry.notes || null]);
                stmt.finalize((err) => err ? reject(err) : resolve(true));
            });
        });
    });
}

function getSchoolSchedule(ownerJid) {
    const normalizedOwnerJid = normalizeUserJid(ownerJid);
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM school_schedule WHERE owner_jid = ? ORDER BY weekday, start_time', [normalizedOwnerJid], (err, rows) => {
            if (err) return reject(err);
            if (!rows || rows.length === 0) {
                try {
                    const { UTM_SCHEDULE_TI7B } = require('./school_schedule_data');
                    return resolve(UTM_SCHEDULE_TI7B.map((s, idx) => ({
                        id: idx + 1,
                        owner_jid: ownerJid,
                        weekday: s.weekday,
                        subject: s.subject,
                        start_time: s.startTime,
                        end_time: s.endTime,
                        room: s.room,
                        notes: s.teacher
                    })));
                } catch (_) {}
            }
            resolve(rows || []);
        });
    });
}

/**
 * Ejecuta un checkpoint WAL para vaciar páginas al archivo principal y truncar el log WAL.
 */
function checkpointWal() {
    return new Promise((resolve) => {
        db.run('PRAGMA wal_checkpoint(TRUNCATE);', (err) => {
            if (err) {
                logger.warn(`[DB] Error en wal_checkpoint: ${err.message}`);
            } else {
                logger.info('[DB] SQLite WAL checkpoint completado exitosamente.');
            }
            resolve(true);
        });
    });
}

// ─── Funciones de Historial de Entregas Anti-Repetición ─────────────────────────

/**
 * Consulta los IDs de fotos previamente entregadas a un usuario o grupo.
 * @param {'user'|'group'} scopeType
 * @param {string} scopeId - JID del usuario o del grupo
 * @param {string} [category=''] - Categoría o slug del álbum normalizado
 * @returns {Promise<Set<string>>}
 */
const getDeliveredPhotoIds = (scopeType, scopeId, category = '') => {
    const cleanScope = normalizeUserJid(scopeId);
    const cleanCat = category ? String(category).trim().toLowerCase() : '';
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT photo_id FROM photo_delivery_history WHERE scope_type = ? AND scope_id = ? AND category = ?',
            [scopeType, cleanScope, cleanCat],
            (err, rows) => {
                if (err) return reject(err);
                const set = new Set((rows || []).map(r => r.photo_id));
                resolve(set);
            }
        );
    });
};

/**
 * Registra una o más fotos como entregadas a un usuario o grupo.
 * @param {'user'|'group'} scopeType
 * @param {string} scopeId - JID del usuario o del grupo
 * @param {string} [category=''] - Categoría o slug del álbum normalizado
 * @param {string[]|string} photoIds - ID(s) de fotos entregadas
 * @returns {Promise<number>} Cantidad de registros insertados
 */
const recordDeliveredPhotos = (scopeType, scopeId, category = '', photoIds = []) => {
    const cleanScope = normalizeUserJid(scopeId);
    const cleanCat = category ? String(category).trim().toLowerCase() : '';
    const ids = (Array.isArray(photoIds) ? photoIds : [photoIds]).filter(Boolean).map(String);
    if (!ids.length) return Promise.resolve(0);
    return new Promise((resolve, reject) => {
        const now = Date.now();
        const placeholders = ids.map(() => '(?, ?, ?, ?, ?)').join(',');
        const params = [];
        for (const id of ids) {
            params.push(scopeType, cleanScope, cleanCat, id, now);
        }
        db.run(
            `INSERT INTO photo_delivery_history (scope_type, scope_id, category, photo_id, delivered_at) VALUES ${placeholders}`,
            params,
            function (err) {
                if (err) return reject(err);
                resolve(this.changes || ids.length);
            }
        );
    });
};

/**
 * Limpia el historial de fotos entregadas de un usuario o grupo (reinicio de baraja / ciclo completado).
 * @param {'user'|'group'} scopeType
 * @param {string} scopeId - JID del usuario o del grupo
 * @param {string} [category=''] - Categoría o slug del álbum normalizado
 * @returns {Promise<number>} Cantidad de registros eliminados
 */
const clearDeliveredPhotoHistory = (scopeType, scopeId, category = '') => {
    const cleanScope = normalizeUserJid(scopeId);
    const cleanCat = category ? String(category).trim().toLowerCase() : '';
    return new Promise((resolve, reject) => {
        db.run(
            'DELETE FROM photo_delivery_history WHERE scope_type = ? AND scope_id = ? AND category = ?',
            [scopeType, cleanScope, cleanCat],
            function (err) {
                if (err) return reject(err);
                resolve(this.changes || 0);
            }
        );
    });
};

/**
 * Obtiene el estado actual de la Hora Feliz persistido en SQLite.
 * @returns {Promise<object|null>} Fila de la tabla bot_happy_hour o null si no existe.
 */
function getHappyHourState() {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM bot_happy_hour WHERE id = 1', (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
}

/**
 * Guarda o actualiza el estado de la Hora Feliz en SQLite (id = 1).
 * @param {object} state - Propiedades a actualizar
 * @returns {Promise<void>}
 */
function saveHappyHourState(state = {}) {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        const isActive = state.is_active ?? (state.isActive !== undefined ? (state.isActive ? 1 : 0) : undefined);
        const groupJid = state.group_jid ?? state.groupJid;
        const startedAt = state.started_at ?? state.startedAt;
        const activeUntil = state.active_until ?? state.activeUntil;
        const durationMinutes = state.duration_minutes ?? state.durationMinutes;
        const xpMultiplier = state.xp_multiplier ?? state.xpMultiplier;
        const discountPercent = state.discount_percent ?? state.discountPercent;
        const airdropActive = state.airdrop_active ?? (state.airdropActive !== undefined ? (state.airdropActive ? 1 : 0) : undefined);
        const airdropClaimed = state.airdrop_claimed ?? (state.airdropClaimed !== undefined ? (state.airdropClaimed ? 1 : 0) : undefined);
        const airdropWinnerJid = state.airdrop_winner_jid ?? state.airdropWinnerJid;

        db.get('SELECT * FROM bot_happy_hour WHERE id = 1', (err, row) => {
            if (err) return reject(err);
            if (!row) {
                db.run(
                    `INSERT INTO bot_happy_hour (
                        id, is_active, group_jid, started_at, active_until, duration_minutes,
                        xp_multiplier, discount_percent, airdrop_active, airdrop_claimed, airdrop_winner_jid, updated_at
                    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        isActive !== undefined ? isActive : 0,
                        groupJid !== undefined ? groupJid : null,
                        startedAt !== undefined ? startedAt : null,
                        activeUntil !== undefined ? activeUntil : 0,
                        durationMinutes !== undefined ? durationMinutes : 60,
                        xpMultiplier !== undefined ? xpMultiplier : 20,
                        discountPercent !== undefined ? discountPercent : 50,
                        airdropActive !== undefined ? airdropActive : 0,
                        airdropClaimed !== undefined ? airdropClaimed : 0,
                        airdropWinnerJid !== undefined ? airdropWinnerJid : null,
                        now
                    ],
                    (insErr) => insErr ? reject(insErr) : resolve()
                );
            } else {
                const nextActive = isActive !== undefined ? isActive : row.is_active;
                const nextGroup = groupJid !== undefined ? groupJid : row.group_jid;
                const nextStarted = startedAt !== undefined ? startedAt : row.started_at;
                const nextUntil = activeUntil !== undefined ? activeUntil : row.active_until;
                const nextDuration = durationMinutes !== undefined ? durationMinutes : row.duration_minutes;
                const nextXp = xpMultiplier !== undefined ? xpMultiplier : row.xp_multiplier;
                const nextDiscount = discountPercent !== undefined ? discountPercent : row.discount_percent;
                const nextAirdropActive = airdropActive !== undefined ? airdropActive : row.airdrop_active;
                const nextAirdropClaimed = airdropClaimed !== undefined ? airdropClaimed : row.airdrop_claimed;
                const nextAirdropWinner = airdropWinnerJid !== undefined ? airdropWinnerJid : row.airdrop_winner_jid;

                db.run(
                    `UPDATE bot_happy_hour SET
                        is_active = ?,
                        group_jid = ?,
                        started_at = ?,
                        active_until = ?,
                        duration_minutes = ?,
                        xp_multiplier = ?,
                        discount_percent = ?,
                        airdrop_active = ?,
                        airdrop_claimed = ?,
                        airdrop_winner_jid = ?,
                        updated_at = ?
                    WHERE id = 1`,
                    [
                        nextActive,
                        nextGroup,
                        nextStarted,
                        nextUntil,
                        nextDuration,
                        nextXp,
                        nextDiscount,
                        nextAirdropActive,
                        nextAirdropClaimed,
                        nextAirdropWinner,
                        now
                    ],
                    (upErr) => upErr ? reject(upErr) : resolve()
                );
            }
        });
    });
}

/**
 * Restablece el estado de la Hora Feliz a inactivo.
 * @returns {Promise<void>}
 */
function resetHappyHourState() {
    return new Promise((resolve, reject) => {
        const now = Date.now();
        db.run(
            `INSERT INTO bot_happy_hour (
                id, is_active, group_jid, started_at, active_until, duration_minutes,
                xp_multiplier, discount_percent, airdrop_active, airdrop_claimed, airdrop_winner_jid, updated_at
            ) VALUES (1, 0, NULL, NULL, 0, 60, 20, 50, 0, 0, NULL, ?)
            ON CONFLICT(id) DO UPDATE SET
                is_active = 0,
                group_jid = NULL,
                started_at = NULL,
                active_until = 0,
                airdrop_active = 0,
                airdrop_claimed = 0,
                airdrop_winner_jid = NULL,
                updated_at = excluded.updated_at`,
            [now],
            (err) => err ? reject(err) : resolve()
        );
    });
}

module.exports = {
    db,
    getOrCreateUser,
    addXp,
    subtractXp,
    deductUserXpAtomic,
    refundUserXp,
    addStrike,
    removeStrike,
    getTop,
    getTodayStr,
    addLoreEvent,
    getLoreEvents,
    getAllLoreTargets,
    setLoreProfile,
    getLoreProfile,
    deleteLastLoreEvent,
    addReminder,
    getDueReminders,
    markReminderDelivered,
    markReminderFailed,
    getUserPendingReminders,
    cancelReminder,
    addNote,
    getNotes,
    searchNotes,
    deleteNote,
    addRouletteExile,
    getPendingRouletteExiles,
    completeRouletteExile,
    getDailyClaim,
    recordDailyClaim,
    getUserAffinity,
    adjustUserAffinity,
    getUserAffinityContext,
    canTriggerPrivateRevenge,
    recordPrivateRevenge,
    setUserDoxxedState,
    isUserDoxxed,
    canSendProactiveMessage,
    recordProactiveMessage,
    saveChatMessage,
    getRecentChatMessages,
    getActiveChatHistories,
    clearChatHistory,
    purgeExpiredChatHistory,
    getPersonalityState,
    updatePersonalityState,
    addSocialEvent,
    getRecentSocialEvents,
    createPoll,
    getActivePoll,
    votePoll,
    closePoll,
    getPollResults,
    getSchoolSettings,
    saveSchoolSettings,
    createSchoolTask,
    getSchoolTasks,
    getSchoolTaskById,
    getDailySchoolTasks,
    getAllDailySchoolTasksForDate,
    getAllUpcomingSchoolTasks,
    cancelSchoolTask,
    getActiveSchoolTasks,
    claimSchoolPublication,
    releaseSchoolPublication,
    saveSchoolSchedule,
    getSchoolSchedule,
    checkpointWal,
    getDeliveredPhotoIds,
    recordDeliveredPhotos,
    clearDeliveredPhotoHistory,
    getHappyHourState,
    saveHappyHourState,
    resetHappyHourState
};
