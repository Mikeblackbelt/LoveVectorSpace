from dataclasses import replace

from .model import Message


def assign_roles(msgs: list[Message], me_names: set[str]) -> list[Message]:
    """Label each message "me" if its speaker is in me_names (case-insensitive), else "them"."""
    mine = {n.strip().casefold() for n in me_names}
    return [
        replace(m, role="me" if m.speaker_raw.strip().casefold() in mine else "them")
        for m in msgs
    ]
