from datetime import datetime, timedelta, timezone

import pytest

from analyzer.parsers.model import Message
from analyzer.store.db import open_db
from analyzer.store.messages import MessageStore

T0 = datetime(2024, 3, 1, 12, 0, 5, tzinfo=timezone.utc)


def insert_person(conn, pseudonym="Sam", mode="potential", timezone_name="UTC") -> int:
    cur = conn.execute(
        "INSERT INTO people(pseudonym, mode, timezone, created_at) VALUES (?,?,?,?)",
        (pseudonym, mode, timezone_name, "2024-01-01T00:00:00Z"),
    )
    conn.commit()
    return cur.lastrowid


def mk(text, minutes=0, role="me", source="whatsapp_import", pid=None,
       precision="minute", seconds=0, speaker=None):
    return Message(
        ts=T0 + timedelta(minutes=minutes, seconds=seconds - 5),
        role=role,
        speaker_raw=speaker or ("Me" if role == "me" else "Sam"),
        text=text,
        ts_precision=precision,
        platform_msg_id=pid,
        source=source,
    )


@pytest.fixture
def conn(tmp_path):
    c = open_db(tmp_path / "t.db", "testkey")
    yield c
    c.close()


@pytest.fixture
def store(conn):
    return MessageStore(conn)


@pytest.fixture
def person(conn):
    return insert_person(conn)
