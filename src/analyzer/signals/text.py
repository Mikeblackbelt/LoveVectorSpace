import re
from pathlib import Path

import yaml

TOKEN = re.compile(r"\b[\w']+\b")
WORDLISTS = Path(__file__).parent / "wordlists"


def norm_apostrophes(text: str) -> str:
    return text.replace("’", "'").replace("‘", "'")


def tokens(text: str) -> list[str]:
    return TOKEN.findall(norm_apostrophes(text).lower())


def load_wordlist(name: str) -> dict:
    return yaml.safe_load((WORDLISTS / f"{name}.yaml").read_text(encoding="utf-8"))
