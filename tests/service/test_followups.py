from pathlib import Path

import pytest

from analyzer.agent.prompts import system_prompt
from analyzer.service.facade import InvalidInput
from test_facade import batch

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "chats"


def fx(name: str) -> bytes:
    return (FIX / name).read_bytes()


def test_preview_dating_formats(svc):
    for name, fmt in (("tinder.json", "tinder"), ("hinge.json", "hinge"), ("grindr.json", "grindr"),
                      ("bumble.json", "bumble")):
        pv = svc.preview_import(name, fx(name))
        assert pv["format"] == fmt and pv["matches"] and "speakers" not in pv
        assert set(pv["matches"][0]) == {"match_id", "label", "first_ts", "last_ts", "message_count",
                                         "one_sided"}
    tinder = svc.preview_import("tinder.json", fx("tinder.json"))
    assert [m["match_id"] for m in tinder["matches"]] == ["Match 1", "Match 2", "Match 3"]
    assert tinder["one_sided"] is True and tinder["matches"][0]["first_ts"].endswith("Z")
    assert svc.preview_import("c.txt", fx("wa_us.txt"))["speakers"]  # chat formats unchanged


def test_import_dating_match_one_unit_per_match(svc, factory, person):
    pid = person["id"]
    with pytest.raises(InvalidInput) as e:
        svc.import_file(pid, "tinder.json", fx("tinder.json"), "UTC", ["Alex"])
    assert e.value.field == "match_id"
    with pytest.raises(InvalidInput) as e:
        svc.import_file(pid, "tinder.json", fx("tinder.json"), "UTC", ["Alex"], match_id="Nope")
    assert e.value.field == "match_id"
    r1 = svc.import_file(pid, "tinder.json", fx("tinder.json"), "UTC", ["Alex"], match_id="Match 1")
    r2 = svc.import_file(pid, "tinder.json", fx("tinder.json"), "UTC", [], match_id="Match 2")
    assert r1["added"] == 2 and r1["one_sided"] is True and r1["unit_id"] != r2["unit_id"]
    assert {u["source"] for u in svc.list_units(pid)} == {"tinder_import"} and len(svc.list_units(pid)) == 2
    assert factory.wait_idle(20)


def test_parse_errors_map_to_invalid_input(svc, person):
    with pytest.raises(InvalidInput) as e:
        svc.import_file(person["id"], "x.json", b'{"nothing": 1}', "UTC", ["Alex"])
    assert e.value.field == "file" and "expected" in str(e.value)
    with pytest.raises(InvalidInput):
        svc.preview_import("x.json", b"not json at all {")


MSGS = [{"ts_utc": "2025-04-01T10:00:00Z", "ts_precision": "approx", "role": "them", "text": "see you at six"},
        {"ts_local": "2025-04-01T06:05:00", "ts_precision": "approx", "role": "me", "text": "sounds good to me"}]


def test_import_messages(svc, factory, person):
    pid = person["id"]
    r = svc.import_messages(pid, "screenshot_import", "America/New_York", MSGS)
    assert r["added"] == 2 and r["unit_id"].startswith("import:screenshot_import:") and r["one_sided"] is False
    units = svc.list_units(pid)
    assert units[0]["source"] == "screenshot_import"
    assert units[0]["start_ts"].startswith("2025-04-01T10:00")  # 06:05 NY (EDT) = 10:05 UTC
    assert factory.wait_idle(20)
    assert svc.import_messages(pid, "android_sms", "America/New_York", MSGS)["merged"] == 2  # same messages merge across sources


def test_import_messages_validation_and_notify_one_sided(svc, person):
    pid = person["id"]
    for bad in ("whatsapp_ext", "android_notify_", "android_foo_x", "", "screenshot_import; drop"):
        with pytest.raises(InvalidInput) as e:
            svc.import_messages(pid, bad, "UTC", MSGS)
        assert e.value.field == "source"
    with pytest.raises(InvalidInput):
        svc.import_messages(pid, "screenshot_import", "UTC", [{"text": "x"}])
    with pytest.raises(InvalidInput):
        svc.import_messages(pid, "screenshot_import", "UTC", [])
    r = svc.import_messages(pid, "android_notify_whatsapp", "UTC", MSGS)
    assert r["one_sided"] is True  # them only, no other sources
    assert {m["role"] for m in svc.get_speakers(pid)} == {"them"}
    svc.import_messages(pid, "android_sms", "UTC", [{**MSGS[0], "text": "another one entirely"}, MSGS[1]])
    r2 = svc.import_messages(pid, "android_notify_instagram", "UTC",
                             [{**MSGS[0], "text": "third different message"}])
    assert r2["one_sided"] is False  # other sources exist


def test_capture_new_platforms_and_unit_id(svc, person):
    pid = person["id"]
    for plat in ("tinder", "grindr", "bumble"):
        svc.ext_link(pid, plat, f"{plat}-chat")
    b = batch(f"tinder-chat", n=3, platform="tinder", unit_id="capture:tinder:abc:2025-03-09")
    r = svc.ingest_capture(b)
    assert r["added"] == 3
    units = svc.list_units(pid)
    assert [u["unit_id"] for u in units] == ["capture:tinder:abc:2025-03-09"]
    for plat, word in (("grindr", "alpha"), ("bumble", "beta")):
        g = batch(f"{plat}-chat", n=2, platform=plat)
        for m in g["messages"]:
            m["text"] = f"{word} " + m["text"]
        assert svc.ingest_capture(g)["added"] == 2
    with pytest.raises(InvalidInput):
        svc.ingest_capture(batch("tinder-chat", platform="tinder", unit_id=""))
    with pytest.raises(InvalidInput):
        svc.ingest_capture(batch("tinder-chat", platform="signal"))


def test_nine_themes(svc):
    for t in ("signal", "pulse", "riso", "blueprint", "journal", "matcha", "midnight", "inkwell", "crt", "auto"):
        assert svc.update_settings({"theme": t})["theme"] == t
    out = svc.update_settings({"auto_theme": {"day": "matcha", "night": "inkwell"}})["auto_theme"]
    assert out["day"] == "matcha" and out["night"] == "inkwell"
    for bad in ({"theme": "neon"}, {"auto_theme": {"day": "auto"}}):
        with pytest.raises(InvalidInput):
            svc.update_settings(bad)
    assert svc.get_settings()["auto_theme"]["day_start"] == "07:00"


def test_prompt_neutrality():
    p = system_prompt("chat")
    assert "gender or sexual orientation" in p and "Same-gender" in p and "equally valid" in p
