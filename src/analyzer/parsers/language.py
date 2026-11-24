import re

from .model import Message

_STOP = set("""
a about after all also am an and any are as at be because been but by can could did do does don't for from get
got had has have he her him his how i if in is it its just like me my no not of on one or our out she so some
than that the their them then there these they this to up us was we were what when where which who why will with
would you your yes ok okay oh yeah hey im i'm it's that's what's can't won't didn't isn't aren't wasn't
going go think know want see good now really too very much more most other into over only own same such
tonight today tomorrow thanks thank please
""".split())

_TOKEN = re.compile(r"[^\W\d_]+(?:'[^\W\d_]+)?")


def is_english(text: str) -> bool:
    """Short (<4 alphabetic tokens) or emoji-only text counts as English; else >=20% stop words."""
    tokens = [t.lower() for t in _TOKEN.findall(text.replace("’", "'"))]
    if len(tokens) < 4:
        return True
    return sum(t in _STOP for t in tokens) / len(tokens) >= 0.2


def filter_english(msgs: list[Message]) -> tuple[list[Message], int]:
    kept = [m for m in msgs if is_english(m.text)]
    return kept, len(msgs) - len(kept)
