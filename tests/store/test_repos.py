from datetime import datetime, timedelta, timezone

import pytest

from conftest import mk
from analyzer.store.agent import AgentStore
from analyzer.store.facts import Facts
from analyzer.store.interactions import InteractionFields, Interactions
from analyzer.store.jobs import Jobs
from analyzer.store.links import ChatLinks, SpeakerMap
from analyzer.store.messages import MessageStore
from analyzer.store.next_steps import NextSteps
from analyzer.store.people import People
from analyzer.store.scores import Scores
from analyzer.store.settings import Settings
from analyzer.store.snapshots import Snapshots
from analyzer.store.tokens import Tokens

UTC = timezone.utc


@pytest.fixture
def pid(conn):
    return People(conn).add("Sam", "potential", "America/New_York").id


def test_people_round_trip(conn):
    p = People(conn)
    a = p.add("Alex", "established", "UTC")
    assert p.get(a.id).pseudonym == "Alex"
    assert p.get(a.id).mode == "established"
    assert [x.id for x in p.list()] == [a.id]
    assert p.get(999) is None
    with pytest.raises(ValueError):
        p.add("Bad", "nope", "UTC")
    assert len(p.list()) == 1


def test_speaker_map_round_trip(conn, pid):
    sm = SpeakerMap(conn)
    sm.set(pid, "whatsapp_import", "Me", "me")
    sm.set(pid, "whatsapp_import", "Sam", "them")
    sm.set(pid, "whatsapp_import", "Sam", "me")  # overwrite
    got = {m.speaker_raw: m.role for m in sm.get(pid)}
    assert got == {"Me": "me", "Sam": "me"}
    with pytest.raises(ValueError):
        sm.set(pid, "x", "y", "bogus")


def test_token_shown_once_and_hashed(conn):
    t = Tokens(conn)
    plain = t.create("extension")
    assert len(plain) >= 32
    stored = [r[0] for r in conn.execute("SELECT token_hash FROM tokens")]
    assert len(stored) == 1 and stored[0] != plain and plain not in stored[0]
    assert len(stored[0]) == 64
    assert t.verify("extension", plain)
    assert not t.verify("api", plain)
    assert not t.verify("extension", plain + "x")
    infos = t.list()
    assert len(infos) == 1 and infos[0].kind == "extension" and infos[0].revoked_at is None
    assert not hasattr(infos[0], "token_hash")
    assert plain not in repr(infos[0])


def test_revoked_token_fails(conn):
    t = Tokens(conn)
    plain = t.create("api")
    tid = t.list()[0].id
    t.revoke(tid)
    assert not t.verify("api", plain)
    assert t.list()[0].revoked_at is not None


def test_chat_links_round_trip(conn, pid):
    cl = ChatLinks(conn)
    cl.link(pid, "whatsapp", "chat-1")
    assert cl.person_for("whatsapp", "chat-1") == pid
    assert cl.person_for("whatsapp", "nope") is None
    pid2 = People(conn).add("Jo", "potential", "UTC").id
    cl.link(pid2, "whatsapp", "chat-1")  # relink moves it
    assert cl.person_for("whatsapp", "chat-1") == pid2
    assert [x.chat_key for x in cl.list(pid2)] == ["chat-1"]
    cl.unlink("whatsapp", "chat-1")
    assert cl.person_for("whatsapp", "chat-1") is None


def test_facts_round_trip(conn, pid):
    f = Facts(conn)
    a = f.upsert(pid, "pet", "dog", "interview", "owner_sure")
    b = f.upsert(pid, "pet", "cat", "owner_edit", "owner_unsure")
    assert a.id == b.id
    got = f.list(pid)
    assert len(got) == 1 and got[0].value == "cat" and got[0].confidence == "owner_unsure"
    u = f.update(a.id, value="fish", confidence="owner_sure")
    assert u.value == "fish" and u.confidence == "owner_sure" and u.source == "owner_edit"
    with pytest.raises(ValueError):
        f.upsert(pid, "k", "v", "bogus", "owner_sure")
    f.delete(a.id)
    assert f.list(pid) == []


def _fields(ts, **kw):
    base = dict(ts=ts, place="cafe", duration_min=60, initiated_by="me", activity="coffee",
                closeness_1_7=5, comfort_1_7=6, responsiveness=["listened"],
                tension=None, affection="hug", next_plan_proposed_by="them",
                followed_through_prev=True)
    base.update(kw)
    return InteractionFields(**base)


def test_interactions_round_trip(conn, pid):
    i = Interactions(conn)
    t1 = datetime(2024, 3, 1, 12, tzinfo=UTC)
    t2 = datetime(2024, 3, 5, 12, tzinfo=UTC)
    a = i.add(pid, _fields(t1), "n1")
    i.add(pid, _fields(t2, followed_through_prev=None), "n2")
    allv = i.list(pid)
    assert [x.fields.ts for x in allv] == [t1, t2]
    assert allv[0].fields.responsiveness == ["listened"] and allv[0].notes == "n1"
    assert allv[1].fields.followed_through_prev is None
    assert len(i.list(pid, since=datetime(2024, 3, 3, tzinfo=UTC))) == 1
    u = i.update(a.id, fields=_fields(t1, closeness_1_7=2), notes="edited")
    assert u.fields.closeness_1_7 == 2 and u.notes == "edited"
    i.delete(a.id)
    assert len(i.list(pid)) == 1
    with pytest.raises(ValueError):
        _fields(t1, closeness_1_7=8)


def test_agent_store_round_trip(conn, pid):
    a = AgentStore(conn)
    th = a.new_thread(pid, "interview")
    a.add_message(th.id, "user", "hello")
    a.add_message(th.id, "assistant", "calling", tool_calls=[{"name": "x", "args": {"a": 1}}])
    got = a.thread(th.id)
    assert [m.role for m in got.messages] == ["user", "assistant"]
    assert got.messages[0].tool_calls is None
    assert got.messages[1].tool_calls == [{"name": "x", "args": {"a": 1}}]
    assert [t.id for t in a.threads(pid)] == [th.id]
    with pytest.raises(ValueError):
        a.add_message(th.id, "bogus", "x")
    assert a.thread(999) is None


def test_next_steps_round_trip(conn, pid):
    n = NextSteps(conn)
    s = n.add(pid, "reach_out", "Text them", "been a while", ["m1", "m2"])
    assert s.status == "open" and s.evidence_refs == ["m1", "m2"]
    assert len(n.list(pid)) == 1 and n.list(pid, status="done") == []
    n.set_status(s.id, "done")
    assert n.list(pid, status="done")[0].id == s.id
    with pytest.raises(ValueError):
        n.set_status(s.id, "bogus")


def test_recent_similar_next_step(conn, pid):
    n = NextSteps(conn)
    s = n.add(pid, "reach_out", "t", "w", ["a", "b"])
    assert n.recent_similar(pid, "reach_out", ["b", "a"])
    assert not n.recent_similar(pid, "reach_out", ["a"])
    assert not n.recent_similar(pid, "other", ["a", "b"])
    n.set_status(s.id, "dismissed")
    assert n.recent_similar(pid, "reach_out", ["a", "b"])  # any status
    old = (datetime.now(UTC) - timedelta(days=20)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    conn.execute("UPDATE next_steps SET created_at=?", (old,))
    conn.commit()
    assert not n.recent_similar(pid, "reach_out", ["a", "b"])
    assert n.recent_similar(pid, "reach_out", ["a", "b"], days=30)


def test_jobs_round_trip(conn, pid):
    j = Jobs(conn)
    jid = j.create(pid, "analyze")
    assert j.get(jid).status == "queued" and j.get(jid).finished_at is None
    j.update(jid, "running")
    assert j.get(jid).finished_at is None
    j.update(jid, "error", error="boom")
    got = j.get(jid)
    assert got.status == "error" and got.error == "boom" and got.finished_at is not None
    with pytest.raises(ValueError):
        j.update(jid, "bogus")
    assert j.get(999) is None


def test_scores_round_trip(conn, pid):
    ms = MessageStore(conn)
    ms.ingest(pid, [mk("a", 0), mk("b", 1)], "u1")
    ids = [m.id for m in ms.messages(pid)]
    s = Scores(conn)
    s.put("m1", {ids[0]: 0.5, ids[1]: -0.25})
    s.put("m1", {ids[0]: 0.75})
    assert s.get(ids, "m1") == {ids[0]: 0.75, ids[1]: -0.25}
    assert s.get(ids, "other") == {}
    assert s.get([], "m1") == {}


def test_snapshots_round_trip(conn, pid):
    s = Snapshots(conn)
    assert s.latest(pid) is None
    s.save(pid, {"v": 1})
    b = s.save(pid, {"v": 2, "nested": [1, 2]})
    assert s.latest(pid).id == b.id and s.latest(pid).data == {"v": 2, "nested": [1, 2]}
    assert [x.data["v"] for x in s.list(pid)] == [2, 1]


def test_settings_round_trip(conn):
    s = Settings(conn)
    assert s.get("owner_timezone") is None
    assert s.get("agent_reads_text") is True
    assert s.get("agent_enabled") is True
    assert s.get("catchup_enabled") is True
    assert s.get("unknown", 7) == 7
    s.set("owner_timezone", "America/New_York")
    s.set("agent_enabled", False)
    s.set("agent_enabled", False)
    assert s.get("owner_timezone") == "America/New_York"
    assert s.get("agent_enabled") is False


def test_delete_person_cascades_everything(conn, pid):
    other = People(conn).add("Keep", "potential", "UTC").id
    for p in (pid, other):
        MessageStore(conn).ingest(p, [mk("a", 0), mk("b", 1, "them")], f"u{p}")
        ids = [m.id for m in MessageStore(conn).messages(p)]
        Scores(conn).put("m", {i: 1.0 for i in ids})
        SpeakerMap(conn).set(p, "s", "x", "me")
        ChatLinks(conn).link(p, "wa", f"c{p}")
        Facts(conn).upsert(p, "k", "v", "interview", "owner_sure")
        Interactions(conn).add(p, _fields(datetime(2024, 1, 1, tzinfo=UTC)), "n")
        th = AgentStore(conn).new_thread(p, "chat")
        AgentStore(conn).add_message(th.id, "user", "hi")
        NextSteps(conn).add(p, "k", "t", "w", ["e"])
        Jobs(conn).create(p, "analyze")
        Snapshots(conn).save(p, {"a": 1})
    People(conn).delete(pid)
    assert People(conn).get(pid) is None
    for table in ("units", "messages", "speaker_map", "chat_links", "facts", "interactions",
                  "agent_threads", "next_steps", "jobs", "snapshots"):
        n_gone = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE person_id=?", (pid,)).fetchone()[0]
        n_kept = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE person_id=?", (other,)).fetchone()[0]
        assert n_gone == 0, table
        assert n_kept > 0, table
    kept_msgs = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
    assert conn.execute("SELECT COUNT(*) FROM message_sources").fetchone()[0] == kept_msgs
    assert conn.execute("SELECT COUNT(*) FROM message_scores").fetchone()[0] == kept_msgs
    assert conn.execute("SELECT COUNT(*) FROM agent_messages").fetchone()[0] == 1
