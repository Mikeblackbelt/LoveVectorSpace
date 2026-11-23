import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from analyzer.parsers import (
    Message, ParseError, assign_roles, filter_english, is_english,
    parse_discord_json, parse_instagram_json, parse_plaintext,
    parse_whatsapp, to_utc,
)

FIXTURES = Path(__file__).parent.parent / "fixtures" / "chats"
NY = "America/New_York"


def read(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_us_format_multiline_and_system_lines():
    msgs = parse_whatsapp(read("wa_us.txt"), NY)
    assert [m.speaker_raw for m in msgs[:2]] == ["Alex", "Sam"]
    assert msgs[1].text == "line one\nline two"
    assert not any("end-to-end encrypted" in m.text for m in msgs)
    assert not any(m.text == "<Media omitted>" for m in msgs)
    assert len(msgs) == 4  # duplicate "ok" lines stay two messages
    assert all(m.role is None and m.ts_precision == "minute" and m.source == "whatsapp_import" for m in msgs)


def test_eu_24h_format():
    msgs = parse_whatsapp(read("wa_eu.txt"), "UTC")
    assert msgs[0].ts == datetime(2024, 2, 13, 21, 5, tzinfo=timezone.utc)
    assert msgs[1].ts == datetime(2024, 2, 14, 8, 30, tzinfo=timezone.utc)


def test_ios_bracket_format():
    msgs = parse_whatsapp(read("wa_ios.txt"), "UTC")
    assert msgs[0].ts == datetime(2024, 2, 3, 21, 5, 11, tzinfo=timezone.utc)
    assert msgs[1].text == "hello there\nsecond line"


def test_strips_lrm_marks():
    raw = "‎3/2/24, 9:05 PM - ‎Alex: ‎hi\n"
    msgs = parse_whatsapp(raw, "UTC")
    assert msgs[0].speaker_raw == "Alex" and msgs[0].text == "hi"
    assert msgs[0].ts.hour == 21


def test_unparseable_raises():
    with pytest.raises(ParseError):
        parse_whatsapp("this is not a chat export", "UTC")
    with pytest.raises(ParseError):
        parse_plaintext("nor is this", "UTC")


def test_whatsapp_local_times_converted_with_tz():
    msgs = parse_whatsapp("3/2/24, 9:05 PM - Alex: hi\n", NY)
    assert msgs[0].ts == datetime(2024, 3, 3, 2, 5, tzinfo=timezone.utc)  # EST = UTC-5
    assert msgs[0].ts.tzinfo is timezone.utc


def test_plaintext():
    msgs = parse_plaintext(read("plain.txt"), NY)
    assert msgs[0].text == "hi | there"
    assert msgs[1].text == "hello\ncontinued"
    assert msgs[0].ts == datetime(2024, 3, 3, 2, 5, tzinfo=timezone.utc)
    assert msgs[0].source == "plaintext" and msgs[0].role is None


def test_to_utc_dst():
    before = to_utc(datetime(2026, 3, 8, 1, 30), NY)  # EST
    after = to_utc(datetime(2026, 3, 8, 3, 30), NY)   # EDT
    assert before == datetime(2026, 3, 8, 6, 30, tzinfo=timezone.utc)
    assert after == datetime(2026, 3, 8, 7, 30, tzinfo=timezone.utc)
    assert after - before == __import__("datetime").timedelta(hours=1)


def test_to_utc_ambiguous_uses_fold0():
    # 2026-11-01 01:30 occurs twice; fold=0 picks the first (EDT, UTC-4)
    assert to_utc(datetime(2026, 11, 1, 1, 30), NY) == datetime(2026, 11, 1, 5, 30, tzinfo=timezone.utc)


def test_instagram_mojibake_fixed():
    msgs = parse_instagram_json(read("instagram.json"))
    assert [m.text for m in msgs] == ["plain text", "café \U0001F602"]  # oldest first, photo-only skipped
    assert msgs[0].ts == datetime.fromtimestamp(1709413600, timezone.utc)
    assert all(m.role is None and m.ts_precision == "second" and m.source == "instagram_import" for m in msgs)


def test_instagram_sender_mojibake_and_genuine_text_untouched():
    raw = json.dumps({"messages": [{"sender_name": "JosÃ©", "timestamp_ms": 1, "content": "naïve"}]})
    m = parse_instagram_json(raw)[0]
    assert m.speaker_raw == "José"
    assert m.text == "naïve"  # not valid utf-8 after latin-1 round trip: left as is


def test_discord_one_sided_flag():
    msgs, one_sided = parse_discord_json(read("discord.json"), "Alex")
    assert one_sided is True
    assert [m.text for m in msgs] == ["hello", "naive is utc"]
    assert all(m.role == "me" and m.speaker_raw == "Alex" and m.source == "discord_import" for m in msgs)
    assert msgs[0].platform_msg_id == "111"
    assert msgs[1].ts == datetime(2024, 3, 2, 21, 6, tzinfo=timezone.utc)


def test_discord_with_authors():
    raw = json.dumps([
        {"ID": "1", "Timestamp": "2024-03-02 21:05:11+00:00", "Contents": "a", "Author": "Alex"},
        {"ID": "2", "Timestamp": "2024-03-02 21:06:11+00:00", "Contents": "b", "Author": "Sam"},
    ])
    msgs, one_sided = parse_discord_json(raw, "Alex")
    assert one_sided is False
    assert [m.role for m in msgs] == ["me", "them"]


def test_assign_roles():
    msgs = parse_whatsapp(read("wa_us.txt"), "UTC")
    out = assign_roles(msgs, {"alex"})
    assert {m.speaker_raw: m.role for m in out} == {"Alex": "me", "Sam": "them"}
    assert msgs[0].role is None  # originals untouched


def test_is_english():
    assert is_english("are you free tonight? I was thinking we could get food")
    assert not is_english("¿estás libre esta noche? podríamos ir a cenar")
    assert is_english("haha ok \U0001F602")


def test_filter_english():
    mk = lambda t: Message(datetime(2024, 1, 1, tzinfo=timezone.utc), "me", "x", t, "second", None, "plaintext")
    kept, skipped = filter_english([mk("are you free tonight? I was thinking we could get food"),
                                    mk("¿estás libre esta noche? podríamos ir a cenar"), mk("ok")])
    assert len(kept) == 2 and skipped == 1
