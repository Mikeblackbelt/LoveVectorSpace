"""accounts.db schema: ordered, idempotent migrations (separate from the per-user store schema).

Append new steps; never edit or reorder existing ones. Version is tracked in PRAGMA user_version.
"""

STEPS: list[str] = [
    """
    CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        email_verified INTEGER NOT NULL DEFAULT 0,
        display_name TEXT,
        password_hash TEXT,
        google_sub TEXT UNIQUE,
        apple_sub TEXT UNIQUE,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
        wrapped_dek BLOB NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE TABLE invites (
        code TEXT PRIMARY KEY,
        created_by TEXT,
        email TEXT,
        used_by TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    );
    CREATE TABLE refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        family_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        device TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        replaced_by TEXT
    );
    CREATE INDEX idx_refresh_family ON refresh_tokens(family_id);
    CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);
    CREATE TABLE email_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('verify','reset')),
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT
    );
    CREATE TABLE api_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('api','extension')),
        label TEXT,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        last_used_at TEXT
    );
    CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);
    CREATE TABLE audit (
        id INTEGER PRIMARY KEY,
        user_id TEXT,
        event TEXT NOT NULL,
        at TEXT NOT NULL,
        ip_hash TEXT
    );
    """,
    """
    CREATE TABLE quarantine (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL,
        path TEXT NOT NULL,
        wrapped_dek BLOB NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX idx_quarantine_user ON quarantine(user_id);
    """,
]


def migrate_accounts(conn) -> None:
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for i in range(current, len(STEPS)):
        conn.executescript("BEGIN;\n" + STEPS[i] + f"\nPRAGMA user_version = {i + 1};\nCOMMIT;")
