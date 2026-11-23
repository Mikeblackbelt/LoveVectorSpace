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
]

SCHEMA_VERSION = len(STEPS)


def migrate(conn) -> None:
    """Apply any steps not yet applied; version tracked in PRAGMA user_version."""
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for i in range(current, len(STEPS)):
        conn.executescript("BEGIN;\n" + STEPS[i] + f"\nPRAGMA user_version = {i + 1};\nCOMMIT;")
