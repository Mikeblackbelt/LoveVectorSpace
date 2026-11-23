import pytest

from analyzer.store.db import open_db


@pytest.fixture
def conn(tmp_path):
    c = open_db(tmp_path / "t.db", "testkey")
    yield c
    c.close()
