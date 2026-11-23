"""Intake interview topics (v2 5.5). Safety/CDAQ questions are deliberately absent (v2 7b)."""
from __future__ import annotations

TOPICS_BOTH = [
    ("met", "How you met", "How did you two meet?"),
    ("known", "How long you've known each other", "How long have you known each other?"),
    ("inperson", "Seeing each other in person",
     "How often do you see each other in person, and where do you usually meet?"),
    ("goals", "Your goals and worries", "What are you hoping for here, and is anything worrying you?"),
    ("unsure", "Things you're unsure how to read",
     "Is there anything they've said or done that you're not sure how to read?"),
]
TOPICS_MODE = {
    "potential": [
        ("suggests", "Who suggests meeting up", "Who usually suggests meeting up?"),
        ("signals", "Signals you've noticed",
         "What is one thing they said or did that made you think about their interest? What exactly happened?"),
        ("shared", "Mutual friends and shared settings", "Do you have mutual friends or shared places?"),
        ("next", "What you want next", "What would you like to happen next?"),
    ],
    "established": [
        ("stage", "Length and stage", "How long have you been together, and what stage does it feel like?"),
        ("living", "Living situation", "What is your living situation?"),
        ("going_well", "What's going well", "What is going well between you right now?"),
        ("disagreements", "Recurring disagreements",
         "Is there a disagreement that keeps coming back, and how does it usually end?"),
        ("stressors", "Stressors", "What outside stresses are weighing on the two of you?"),
        ("plans", "Shared plans", "What plans do you share for the coming months?"),
    ],
}


def topics_for(mode: str) -> list[tuple[str, str, str]]:
    return TOPICS_BOTH + TOPICS_MODE[mode]


INTERVIEW_TOPICS = {m: [t[0] for t in topics_for(m)] for m in TOPICS_MODE}


def progress(mode: str, fact_keys: list[str]) -> dict:
    topics = topics_for(mode)
    prefixes = {k.split(".", 1)[0] for k in fact_keys}
    covered = [t[0] for t in topics if t[0] in prefixes]
    return {"covered": covered, "open": [t[0] for t in topics if t[0] not in prefixes],
            "topics": [{"id": t[0], "label": t[1]} for t in topics]}


def first_question(mode: str, fact_keys: list[str]) -> str:
    p = progress(mode, fact_keys)
    if not p["open"]:
        return ("We've already covered every intake topic. Is there anything you'd like to update, "
                "or something else on your mind?")
    q = {t[0]: t[2] for t in topics_for(mode)}[p["open"][0]]
    covered = bool(p["covered"])
    return (("Picking up where we left off. " if covered else "Let's start with a few questions; "
             "you can skip any of them. ") + q)


CHECKIN_FIRST = "Tell me about the hangout: when was it, where, and for how long?"
