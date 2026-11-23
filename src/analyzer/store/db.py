from pathlib import Path

import sqlcipher3

from .schema import migrate


class DatabaseKeyError(Exception):
    """Missing or wrong database key."""


def open_db(path: Path, key: str, *, migrator=migrate):
    """Open (or create) the encrypted DB. Fails closed; never creates a plaintext file."""
    if not key:
        raise DatabaseKeyError("DB_KEY is missing")
    conn = sqlcipher3.connect(str(path), check_same_thread=False)
    try:
        conn.execute("PRAGMA key = '" + key.replace("'", "''") + "'")
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
    except sqlcipher3.Error as e:
        conn.close()
        raise DatabaseKeyError("wrong DB key or not an encrypted database") from e
    conn.execute("PRAGMA foreign_keys = ON")
    migrator(conn)
    return conn
