"""Ordered, idempotent schema migrations.

To add tables later, append a DDL string (statements separated by semicolons)
to STEPS. Never edit or reorder existing steps.
"""

STEPS: list[str] = [
    """
    CREATE TABLE people (
        id INTEGER PRIMARY KEY,
        pseudonym TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('potential','established')),
        timezone TEXT NOT NULL DEFAULT 'UTC',
        created_at TEXT NOT NULL
    );
    CREATE TABLE units (
        unit_id TEXT PRIMARY KEY,
        person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        ts TEXT NOT NULL,
        minute TEXT NOT NULL,
        role TEXT CHECK (role IN ('me','them')),
        speaker_raw TEXT NOT NULL,
        text TEXT NOT NULL,
        norm_text TEXT NOT NULL,
        ts_precision TEXT NOT NULL CHECK (ts_precision IN ('second','minute','approx')),
        occ INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_messages_key2 ON messages(person_id, role, minute, norm_text);
    CREATE TABLE message_sources (
        id INTEGER PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        platform TEXT NOT NULL,
        unit_id TEXT NOT NULL REFERENCES units(unit_id) ON DELETE CASCADE,
        platform_msg_id TEXT
    );
    CREATE INDEX idx_sources_message ON message_sources(message_id);
    CREATE INDEX idx_sources_unit ON message_sources(unit_id);
    CREATE INDEX idx_sources_key1 ON message_sources(platform, platform_msg_id);
    """,
    """
    CREATE INDEX idx_messages_fuzzy ON messages(person_id, role, norm_text, ts);
    CREATE INDEX idx_messages_key2_occ ON messages(person_id, role, norm_text, minute, occ);
    """,
    """
    CREATE TABLE speaker_map (
        person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        speaker_raw TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('me','them')),
        PRIMARY KEY (person_id, source, speaker_raw)
    );
    CREATE TABLE tokens (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('api','extension')),
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        revoked_at TEXT
    );
    CREATE TABLE chat_links (
        person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        chat_key TEXT NOT NULL,
        PRIMARY KEY (platform, chat_key)
    );
    CREATE INDEX idx_chat_links_person ON chat_links(person_id);
    CREATE TABLE facts (
        id INTEGER PRIMARY KEY,
        person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('interview','checkin','owner_edit')),
        confidence TEXT NOT NULL CHECK (confidence IN ('owner_sure','owner_unsure')),
        updated_at TEXT NOT NULL,
        UNIQUE (person_id, key)
    );
    CREATE TABLE interactions (
        id INTEGER PRIMARY KEY,
        person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        ts TEXT NOT NULL,
        fields TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_interactions_person_ts ON interactions(person_id, ts);
    CREATE TABLE agent_threads (
        id INTEGER PRIMARY KEY,
        person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE agent_messages (
        id INTEGER PRIMARY KEY,
        thread_id INTEGER NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
        content TEXT NOT NULL,
        tool_calls TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX idx_agent_messages_thread ON agent_messages(thread_id, id);
    CREATE TABLE next_steps (
        id INTEGER PRIMARY KEY,
        person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        why TEXT NOT NULL,
        evidence_refs TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
        created_at TEXT NOT NULL
    );
    CREATE INDEX idx_next_steps_person ON next_steps(person_id, kind);
    CREATE TABLE jobs (
        id INTEGER PRIMARY KEY,
        person_id INTEGER REFERENCES people(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued','running','done','error')),
        error TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
    );
    CREATE TABLE message_scores (
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        score REAL NOT NULL,
        PRIMARY KEY (message_id, model)
    );
    CREATE TABLE snapshots (
        id INTEGER PRIMARY KEY,
        person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        data TEXT NOT NULL
    );
    CREATE INDEX idx_snapshots_person ON snapshots(person_id, id);
    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """,
    """
    -- message_scores is a pure cache: recreate it to hold a JSON vector per message.
    DROP TABLE message_scores;
    CREATE TABLE message_scores (
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        scores_json TEXT NOT NULL,
        PRIMARY KEY (message_id, model)
    );
    """,
]

SCHEMA_VERSION = len(STEPS)


def migrate(conn) -> None:
    """Apply any steps not yet applied; version tracked in PRAGMA user_version."""
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for i in range(current, len(STEPS)):
        conn.executescript("BEGIN;\n" + STEPS[i] + f"\nPRAGMA user_version = {i + 1};\nCOMMIT;")
