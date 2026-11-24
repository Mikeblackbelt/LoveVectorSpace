import pytest

from analyzer.store.db import DatabaseKeyError, open_db


def test_wrong_key_fails_closed(tmp_path):
    p = tmp_path / "a.db"
    open_db(p, "k1").close()
    with pytest.raises(DatabaseKeyError):
        open_db(p, "k2")


def test_empty_key_creates_nothing(tmp_path):
    with pytest.raises(DatabaseKeyError):
        open_db(tmp_path / "b.db", "")
    assert not (tmp_path / "b.db").exists()


def test_file_is_not_plaintext_sqlite(tmp_path):
    p = tmp_path / "c.db"
    open_db(p, "k").close()
    assert not p.read_bytes().startswith(b"SQLite format 3")


def test_reopen_with_right_key_and_migrate_idempotent(tmp_path):
    from analyzer.store.schema import SCHEMA_VERSION, migrate
    p = tmp_path / "d.db"
    c = open_db(p, "k"); c.close()
    c = open_db(p, "k")
    migrate(c)
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    c.close()
