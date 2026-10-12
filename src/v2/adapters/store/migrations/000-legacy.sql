-- Static extraction of legacy initialization DDL (eb993ef); no runtime legacy import.

CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            name TEXT,
            timestamp INTEGER NOT NULL
        );

CREATE INDEX IF NOT EXISTS idx_chat_history_lookup ON chat_history(chat_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS users (
            jid TEXT PRIMARY KEY,
            xp INTEGER DEFAULT 0,
            level INTEGER DEFAULT 1,
            strikes INTEGER DEFAULT 0
        );

CREATE TABLE IF NOT EXISTS lore_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_jid TEXT NOT NULL,
            target_name TEXT,
            event_text TEXT NOT NULL,
            author_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

CREATE INDEX IF NOT EXISTS idx_lore_events_target ON lore_events(target_jid);

CREATE TABLE IF NOT EXISTS lore_profiles (
            jid TEXT PRIMARY KEY,
            alias TEXT,
            role TEXT,
            phrase TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_jid TEXT NOT NULL,
            sender_jid TEXT NOT NULL,
            sender_name TEXT,
            reminder_text TEXT NOT NULL,
            due_at INTEGER NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

CREATE INDEX IF NOT EXISTS idx_reminders_status_due ON reminders(status, due_at);

CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_jid TEXT NOT NULL,
            user_jid TEXT NOT NULL,
            user_name TEXT,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

CREATE INDEX IF NOT EXISTS idx_notes_chat ON notes(chat_jid);

CREATE TABLE IF NOT EXISTS roulette_exiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_jid TEXT NOT NULL,
            user_jid TEXT NOT NULL,
            user_name TEXT,
            unban_at INTEGER NOT NULL,
            invite_link TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

CREATE INDEX IF NOT EXISTS idx_roulette_exiles_status_unban ON roulette_exiles(status, unban_at);

CREATE TABLE IF NOT EXISTS daily_claims (
            jid TEXT PRIMARY KEY,
            last_claim INTEGER NOT NULL,
            streak INTEGER DEFAULT 1,
            total_claims INTEGER DEFAULT 1
        );

CREATE TABLE IF NOT EXISTS user_affinities (
            jid TEXT PRIMARY KEY,
            user_name TEXT,
            score INTEGER DEFAULT -20,
            mood TEXT DEFAULT 'desconfiado',
            grievances INTEGER DEFAULT 0,
            favors INTEGER DEFAULT 0,
            last_reason TEXT DEFAULT 'Aún no se gana la confianza del bot',
            updated_at INTEGER NOT NULL
        );

CREATE INDEX IF NOT EXISTS idx_user_affinities_mood ON user_affinities(mood);

CREATE TABLE IF NOT EXISTS user_revenge_cooldowns (
            jid TEXT PRIMARY KEY,
            last_revenge_at INTEGER NOT NULL
        );

CREATE TABLE IF NOT EXISTS proactive_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_jid TEXT NOT NULL,
            channel TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

CREATE INDEX IF NOT EXISTS idx_proactive_logs_time ON proactive_logs(channel, created_at);

CREATE TABLE IF NOT EXISTS bot_personality_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            mood TEXT NOT NULL DEFAULT 'curioso',
            objective TEXT NOT NULL DEFAULT 'mantenerse atento al grupo',
            objective_until INTEGER NOT NULL DEFAULT 0,
            last_reason TEXT,
            updated_at INTEGER NOT NULL
        );

CREATE TABLE IF NOT EXISTS bot_social_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            summary TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

CREATE INDEX IF NOT EXISTS idx_bot_social_events_chat_time
        ON bot_social_events(chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cooperacha_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_jid TEXT NOT NULL,
            target_xp INTEGER NOT NULL,
            collected_xp INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );

CREATE INDEX IF NOT EXISTS idx_cooperacha_sessions_group ON cooperacha_sessions(group_jid, status);

CREATE TABLE IF NOT EXISTS cooperacha_donations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            group_jid TEXT NOT NULL,
            user_jid TEXT NOT NULL,
            user_name TEXT,
            amount INTEGER NOT NULL,
            refunded_amount INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
        );

CREATE TABLE IF NOT EXISTS bot_personality_states (
            chat_id TEXT PRIMARY KEY,
            mood TEXT NOT NULL DEFAULT 'curioso',
            objective TEXT NOT NULL DEFAULT 'mantenerse atento al grupo',
            objective_until INTEGER NOT NULL DEFAULT 0,
            last_reason TEXT,
            updated_at INTEGER NOT NULL
        );

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
        );

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
        );

CREATE INDEX IF NOT EXISTS idx_polls_chat_status ON polls(chat_id, status);

CREATE TABLE IF NOT EXISTS poll_votes (
            poll_id INTEGER NOT NULL,
            voter_jid TEXT NOT NULL,
            option_index INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (poll_id, voter_jid),
            FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
        );

CREATE TABLE IF NOT EXISTS school_settings (
            owner_jid TEXT PRIMARY KEY,
            target_group_jid TEXT,
            first_publish_time TEXT NOT NULL DEFAULT '15:00',
            second_publish_time TEXT NOT NULL DEFAULT '18:00',
            timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
            updated_at INTEGER NOT NULL
        );

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
        );

CREATE INDEX IF NOT EXISTS idx_school_tasks_owner_status ON school_tasks(owner_jid, status);

CREATE TABLE IF NOT EXISTS school_publications (
            task_id TEXT NOT NULL,
            publication_date TEXT NOT NULL,
            publication_kind TEXT NOT NULL,
            published_at INTEGER NOT NULL,
            PRIMARY KEY (task_id, publication_date, publication_kind)
        );

CREATE TABLE IF NOT EXISTS school_schedule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_jid TEXT NOT NULL,
            weekday INTEGER NOT NULL,
            subject TEXT NOT NULL,
            start_time TEXT,
            end_time TEXT,
            room TEXT,
            notes TEXT
        );

CREATE INDEX IF NOT EXISTS idx_school_schedule_owner_day ON school_schedule(owner_jid, weekday);

CREATE TABLE IF NOT EXISTS photo_delivery_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scope_type TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '',
            photo_id TEXT NOT NULL,
            delivered_at INTEGER NOT NULL
        );

CREATE INDEX IF NOT EXISTS idx_photo_history_lookup 
        ON photo_delivery_history(scope_type, scope_id, category);
