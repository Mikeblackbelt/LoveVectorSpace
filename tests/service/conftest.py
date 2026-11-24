from pathlib import Path

import pytest

from analyzer.service.impl import ServiceFactoryImpl
from analyzer.store.db import open_db
from lvs_fakes import SCALES, Events, FakeGroq, wa_export  # noqa: F401

@pytest.fixture
def events():
    return Events()


@pytest.fixture
def make_factory(conn):
    made = []

    def make(groq=None, debounce_s=0.05):
        f = ServiceFactoryImpl(SCALES, None, Path("no-models"),
                               (lambda: groq) if groq is not None else None, debounce_s=debounce_s)
        made.append(f)
        return f
    yield make
    for f in made:
        f.shutdown(10)


@pytest.fixture
def conn(tmp_path):
    c = open_db(tmp_path / "u.db", "k")
    yield c
    c.close()


@pytest.fixture
def factory(make_factory, conn):  # depends on conn so it is torn down (timers cancelled) before conn closes
    f = make_factory()
    yield f
    f.shutdown(10)


@pytest.fixture
def svc(factory, conn, events):
    return factory.for_user("u1", conn, events)


@pytest.fixture
def person(svc):
    return svc.create_person("Sam", "potential", "UTC")


@pytest.fixture
def loaded(svc, factory, person):
    """A person with imported chat and a finished analysis."""
    r = svc.import_file(person["id"], "chat.txt", wa_export(), "UTC", ["Alex"])
    assert factory.wait_idle(20)
    return person["id"], r
