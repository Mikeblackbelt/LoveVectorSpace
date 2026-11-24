"""Plain-language labels, metric explanations and descriptive balance bands."""
from __future__ import annotations

PLAIN = {
    "initiation_share": "Who starts conversations",
    "message_share": "Who sends more",
    "ending_share": "Who ends conversations",
    "double_text_rate": "Messages sent in a row",
    "question_rate": "Questions asked",
    "disclosure_rate": "Opening up",
    "lsm": "Texting style match",
    "meetup_initiation_share": "Who suggests meetups",
    "plan_follow_through_rate": "Plans that happen",
    "meetups_per_month": "Meetups per month",
    "closeness_trend": "Feeling close over time",
    "comfort_trend": "Feeling comfortable over time",
    "tension_rate": "Hangouts with tension",
    "toxicity_rate": "Harsh language",
    "emotion_share": "Emotional tone",
    "reply_latency_median_s": "How fast replies come",
}
LABEL = {
    "initiation_share": "Initiation share", "message_share": "Message share",
    "ending_share": "Ending share", "double_text_rate": "Double-text rate",
    "question_rate": "Question rate", "disclosure_rate": "Self-disclosure rate",
    "lsm": "Language style matching", "meetup_initiation_share": "Meetup initiation share",
    "plan_follow_through_rate": "Plan follow-through rate", "meetups_per_month": "Meetups per month",
    "closeness_trend": "Closeness trend", "comfort_trend": "Comfort trend",
    "tension_rate": "Tension rate", "reply_latency_median_s": "Median reply time", "toxicity_rate": "Toxicity rate",
}
RECIPROCITY = ("initiation_share", "message_share", "question_rate", "disclosure_rate", "lsm",
               "meetup_initiation_share", "plan_follow_through_rate")
INFO = {
    "initiation_share": ("Which side opens conversations after a 6-hour gap.", "heuristic",
                         "Descriptive only; an uneven split is not a verdict on interest."),
    "message_share": ("Which side sends more messages.", "heuristic",
                      "Volume differs for many innocent reasons."),
    "ending_share": ("Which side sends the last message of a conversation.", "heuristic",
                     "Weak signal on its own."),
    "double_text_rate": ("How often a person sends another message before a reply.", "heuristic",
                         "Skips messages with approximate timestamps."),
    "question_rate": ("Share of messages containing a question mark.", "heuristic",
                      "Question marks are a rough proxy for curiosity."),
    "disclosure_rate": ("Self-disclosure words per 100 words (open word list).", "moderate",
                        "A lexicon count, not a read of how personal a message is."),
    "lsm": ("Language style matching over function-word categories.", "moderate",
            "Own open word lists; no reference band."),
    "meetup_initiation_share": ("Share of logged hangouts you suggested.", "self-report heuristic",
                                "Only logged hangouts count."),
    "plan_follow_through_rate": ("Share of earlier plans that happened.", "self-report heuristic",
                                 "Only logged hangouts count."),
    "meetups_per_month": ("Logged hangouts per month.", "self-report heuristic",
                          "Only logged hangouts count."),
    "closeness_trend": ("Slope of how close you felt at hangouts.", "self-report heuristic",
                        "Needs at least 3 logged hangouts."),
    "comfort_trend": ("Slope of how comfortable you felt at hangouts.", "self-report heuristic",
                      "Needs at least 3 logged hangouts."),
    "tension_rate": ("Share of hangouts with tension logged.", "self-report heuristic",
                     "Only logged hangouts count."),
    "reply_latency_median_s": ("Median seconds between one side message and the other reply.", "heuristic", "Skips approximate timestamps."),
    "toxicity_rate": ("Share of messages a classifier scores as toxic.", "heuristic",
                      "Swearing and banter score as toxic."),
}
CITATION = {
    "lsm": "Ireland & Pennebaker (2010), Language style matching in writing.",
    "initiation_share": "Descriptive heuristic; no norms.",
}
NO_BAND = "no reference band"


def plain_label(mid: str) -> str:
    base = mid.split(":")[0]
    if base == "emotion_share":
        return f"Emotional tone: {mid.split(':', 1)[1]}" if ":" in mid else PLAIN[base]
    return PLAIN.get(base, mid.replace("_", " ").capitalize())


def label(mid: str) -> str:
    base = mid.split(":")[0]
    if base == "emotion_share" and ":" in mid:
        return f"Emotion share: {mid.split(':', 1)[1]}"
    return LABEL.get(base, mid.replace("_", " ").capitalize())


def balance_band(mid: str, value, per_speaker) -> str | None:
    """Descriptive balance of a share metric (internal; used for change detection only)."""
    if mid not in ("message_share", "initiation_share", "meetup_initiation_share") or value is None:
        return None
    me = (per_speaker or {}).get("me", value)
    return "balanced" if 0.4 <= me <= 0.6 else ("you lead" if me > 0.6 else "they lead")


def explain(mid: str) -> dict | None:
    base = mid.split(":")[0]
    if base == "emotion_share":
        return {"id": mid, "measures": "Share of messages whose top emotion label matches.",
                "evidence": "descriptive",
                "caveats": "go_emotions was trained on Reddit; domain shift is expected.",
                "citation": "Demszky et al. (2020), GoEmotions."}
    if base not in INFO:
        return None
    m, e, c = INFO[base]
    return {"id": mid, "measures": m, "evidence": e, "caveats": c,
            "citation": CITATION.get(base, "No external norm; descriptive heuristic.")}
