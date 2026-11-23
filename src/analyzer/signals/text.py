import re
from pathlib import Path

import yaml

TOKEN = re.compile(r"\b[\w']+\b")
WORDLISTS = Path(__file__).parent / "wordlists"


def tokens(text: str) -> list[str]:
    return TOKEN.findall(text.lower())


def load_wordlist(name: str) -> dict:
    return yaml.safe_load((WORDLISTS / f"{name}.yaml").read_text(encoding="utf-8"))
