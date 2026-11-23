from datetime import datetime, timezone

from conftest import T0, insert_person, mk


def test_capture_then_export_merges(store, person):
    ext = [mk("Hello there", 0, "me", "whatsapp_ext", pid="id1", precision="second"),
           mk("hi!", 1, "them", "whatsapp_ext", pid="id2", precision="second")]
    exp = [mk("hello  there", 0, "me", "whatsapp_import"),
           mk("Hi!", 1, "them", "whatsapp_import")]
    store.ingest(person, ext, "capture:whatsapp:2024-03-01")
    r = store.ingest(person, exp, "upload-1")
    assert (r.added, r.merged) == (0, 2)
    ms = store.messages(person)
    assert len(ms) == 2
    assert all(sorted(m.sources) == ["whatsapp_ext", "whatsapp_import"] for m in ms)


def test_key1_platform_id_merge(store, person):
    a = mk("x", 0, pid="p1", source="discord_ext")
    b = mk("x edited", 0, pid="p1", source="discord_ext")
    store.ingest(person, [a], "u1")
    r = store.ingest(person, [b], "u2")
    assert (r.added, r.merged) == (0, 1)


def test_same_minute_duplicates_survive(store, person):
    m = mk("ok")
    assert store.ingest(person, [m, m], "u1").added == 2
    assert store.ingest(person, [m, m], "u2").added == 0
    assert len(store.messages(person)) == 2
    # re-ingesting the same unit is a no-op
    r = store.ingest(person, [m, m], "u1")
    assert (r.added, r.merged, r.skipped) == (0, 0, 2)


def test_approx_fuzzy_merge_within_10min(store, person):
    store.ingest(person, [mk("see you", 0, "me", "instagram_ext", precision="second")], "u1")
    r = store.ingest(person, [mk("See you", 9, "me", "instagram_import", precision="approx")], "u2")
    assert (r.added, r.merged) == (0, 1)
    assert len(store.messages(person)) == 1


def test_approx_no_merge_beyond_10min(store, person):
    store.ingest(person, [mk("see you", 0, "me", "instagram_ext", precision="second")], "u1")
    r = store.ingest(person, [mk("see you", 11, "me", "instagram_import", precision="approx")], "u2")
    assert (r.added, r.merged) == (1, 0)


def test_approx_identical_in_batch_not_self_merged(store, person):
    r = store.ingest(person, [mk("ok", 0, precision="approx"), mk("ok", 3, precision="approx")], "u1")
    assert r.added == 2


def test_delete_unit_keeps_messages_with_other_sources(store, person):
    store.ingest(person, [mk("a", 0, "me", "whatsapp_ext", pid="1")], "capture:x")
    store.ingest(person, [mk("a", 0, "me", "whatsapp_import")], "up1")
    assert store.delete_unit("up1") == 0
    ms = store.messages(person)
    assert len(ms) == 1 and ms[0].sources == ["whatsapp_ext"]


def test_delete_last_source_deletes_message(store, person):
    store.ingest(person, [mk("a", 0), mk("b", 1)], "up1")
    assert store.delete_unit("up1") == 2
    assert store.messages(person) == []
    assert store.units(person) == []


def test_unmapped_roles_excluded_until_assigned(store, person):
    store.ingest(person, [mk("hey", 0, "me", "whatsapp_ext", pid="1")], "cap")
    unmapped = [mk("hey", 0, None, "whatsapp_import", speaker="Alex"),
                mk("yo", 1, None, "whatsapp_import", speaker="Sam")]
    r = store.ingest(person, unmapped, "up1")
    assert r.added == 2
    assert len(store.messages(person)) == 1
    assert len(store.messages(person, roles_required=False)) == 3
    n = store.set_roles(person, "whatsapp_import", {"Alex": "me", "Sam": "them"})
    assert n == 2
    ms = store.messages(person)
    assert len(ms) == 2  # "hey" merged with the extension copy
    hey = next(m for m in ms if m.text == "hey")
    assert sorted(hey.sources) == ["whatsapp_ext", "whatsapp_import"]


def test_recompute_dedupe_returns_merged_count(store, person):
    store.ingest(person, [mk("a", 0, "me", "whatsapp_ext", pid="1")], "cap")
    store.ingest(person, [mk("a", 0, None, "whatsapp_import", speaker="Alex")], "up1")
    store.conn.execute("UPDATE messages SET role='me' WHERE role IS NULL")
    assert store.recompute_dedupe(person) == 1
    assert store.recompute_dedupe(person) == 0


def test_coverage_intervals_and_units(store, person):
    store.ingest(person, [mk("a", 0), mk("b", 30)], "up1")
    store.ingest(person, [mk("c", 100, "them", "discord_ext", pid="9", precision="second")], "capture:discord:2024-03-01")
    cov = store.coverage(person)
    assert len(cov) == 2
    s, e, src = cov[0]
    assert src == "whatsapp_import" and (e - s).total_seconds() == 30 * 60
    assert cov[1][2] == "discord_ext"
    us = {u.unit_id: u for u in store.units(person)}
    assert us["up1"].message_count == 2 and us["up1"].source == "whatsapp_import"
    assert us["up1"].start_ts == s and us["up1"].end_ts == e
    assert s.tzinfo is not None


def test_messages_utc_order(store, person):
    store.ingest(person, [mk("late", 50), mk("early", 1, "them")], "u")
    assert [m.text for m in store.messages(person)] == ["early", "late"]
