import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from analyzer.parsers import ParseError, detect_format
from analyzer.parsers import grindr_json, hinge_json, tinder_json

FIX = Path(__file__).parent.parent / "fixtures" / "chats"


def read(n):
    return (FIX / n).read_text(encoding="utf-8")


def test_tinder_list_and_parse():
    infos = tinder_json.list_matches(read("tinder.json"))
    assert [(i.match_id, i.message_count, i.one_sided) for i in infos] == [
        ("Match 1", 2, True), ("Match 2", 1, True), ("Match 3", 0, True)]
    assert infos[0].first_ts == datetime(2025, 3, 2, 14, 5, 11, tzinfo=UTC)
    assert infos[0].last_ts == datetime(2025, 3, 2, 15, 0, tzinfo=UTC)
    assert infos[0].label == "Match 1 · first msg 2025-03-02"
    msgs, one = tinder_json.parse_match(read("tinder.json"), "Match 1", "Alex")
    assert one and [m.text for m in msgs] == ["hey, nice dog & hat", "coffee sometime?"]
    assert all(m.role == "me" and m.source == "tinder_import" and m.ts_precision == "second"
               and m.speaker_raw == "Alex" for m in msgs)
    m2, _ = tinder_json.parse_match(read("tinder.json"), "Match 2", "Alex")
    assert m2[0].ts == datetime.fromtimestamp(1741000000, UTC)


def test_tinder_key_variants():
    raw = json.dumps([{"matchId": 7, "Messages": [{"Message": "yo", "sentDate": "1741000000"}]}])
    msgs, _ = tinder_json.parse_match(raw, "7", "A")
    assert msgs[0].text == "yo"


def test_hinge_list_and_parse():
    infos = hinge_json.list_matches(read("hinge.json"))
    assert [(i.match_id, i.message_count) for i in infos] == [("1", 2), ("3", 1)]
    msgs, one = hinge_json.parse_match(read("hinge.json"), "1", "Sam")
    assert one and msgs[0].ts == datetime(2025, 1, 5, 12, 30, 15, tzinfo=UTC)
    assert msgs[0].role == "me" and msgs[0].source == "hinge_import"


def test_grindr_list_and_parse():
    infos = grindr_json.list_matches(read("grindr.json"))
    assert [(i.match_id, i.message_count, i.one_sided) for i in infos] == [
        ("c-100", 2, True), ("c-200", 1, True)]
    msgs, one = grindr_json.parse_match(read("grindr.json"), "c-100", "Alex")
    assert one and msgs[0].platform_msg_id == "m1" and msgs[0].source == "grindr_import"
    assert msgs[0].ts == datetime.fromtimestamp(1740000000, UTC)


def test_grindr_two_sided_and_variants():
    raw = json.dumps({"chats": [{"chatId": "x", "messages": [
        {"senderId": "u1", "text": "a", "sentAt": "2025-03-01T10:00:00Z"},
        {"senderId": "u2", "text": "b", "sentAt": "2025-03-01T10:01:00Z"}]}]})
    msgs, one = grindr_json.parse_match(raw, "x", "u1")
    assert not one and [m.role for m in msgs] == ["me", "them"]
    flat = json.dumps([{"conversationId": "q", "body": "hi", "timestamp": 1741000000}])
    assert grindr_json.list_matches(flat)[0].message_count == 1


@pytest.mark.parametrize("mod", [tinder_json, hinge_json, grindr_json])
def test_malformed_raises_with_hint(mod):
    with pytest.raises(ParseError, match="expected"):
        mod.list_matches("{not json")
    with pytest.raises(ParseError, match="expected"):
        mod.list_matches('{"foo": 1}')


def test_unknown_match_id():
    with pytest.raises(ParseError):
        tinder_json.parse_match(read("tinder.json"), "nope", "A")


@pytest.mark.parametrize("fname,expected", [
    ("wa_us.txt", "whatsapp"), ("plain.txt", "plaintext"), ("instagram.json", "instagram"),
    ("discord.json", "discord"), ("tinder.json", "tinder"), ("hinge.json", "hinge"),
    ("grindr.json", "grindr")])
def test_detect(fname, expected):
    assert detect_format(fname, (FIX / fname).read_bytes()) == expected


def test_detect_errors():
    with pytest.raises(ParseError, match="expected"):
        detect_format("x.json", b'{"a": 1}')
    with pytest.raises(ParseError):
        detect_format("x.json", b"{bad")
    with pytest.raises(ParseError):
        detect_format("x.txt", b"   ")
