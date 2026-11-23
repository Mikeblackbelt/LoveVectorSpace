"""Phrase and regex rules. Matching is on lowercased text with curly quotes folded.

Urgent categories (threat, self_harm) are tuned for recall: a few benign banter
lines may match, and that is accepted.
"""
import re

URGENT_CATEGORIES = frozenset({"threat", "self_harm"})

_RAW: dict[str, list[str]] = {
    "monitoring": [
        r"\b(send|share|show|give|turn on|keep) (me )?(your |ur )?(live )?location\b",
        r"\b(turn|keep) your location on\b",
        r"\bwho (are|were|was) you (with|texting|talking to|messaging)\b",
        r"\bwhere were you (last night|really|exactly)\b",
        r"\b(give|tell|send|share|text) me your (\w+ )?(password|passcode|pin)\b",
        r"\bi need your (\w+ )?(password|passcode)\b",
        r"\blet me (see|check|look at|go through) your (phone|texts|messages|dms)\b",
        r"\bshow me your (phone|texts|messages|dms|chat)",
        r"\bi (checked|went through|read|looked (at|through)) your (phone|texts|messages|dms)\b",
        r"\bwhy (was|is) your phone (off|dead|switched off)\b",
        r"\bi'?m tracking you\b",
        r"\btrack(ing)? your (phone|location)\b",
        r"\bprove (it|where you)\b",
    ],
    "control": [
        r"\byou'?re not allowed\b",
        r"\byou are not allowed\b",
        r"\bi (don'?t|do not) (let|allow) you\b",
        r"\bi forbid\b",
        r"\byou need my (permission|approval)\b",
        r"\bask me (first|before)\b",
        r"\b(just )?do (as|what) i (say|tell you)\b",
        r"\bdelete (his|her|their|that|my) (number|pics|photos|account|messages)\b",
        r"\bwho said you could\b",
        r"\byou don'?t get to (decide|go|talk|see|say|wear)\b",
        r"\bi decide (what|who|where)\b",
    ],
    "isolation": [
        r"\b(stop|quit|don'?t|do not) (talking|seeing|hanging out|speaking) (to|with)\b.{0,20}\b(friends|family|mom|dad|sister|brother|cousins|coworkers)\b",
        r"\b(don'?t|do not) (talk|speak) to your (friends|family|mother|father|mom|dad|sister|brother)\b",
        r"\bstop talking to your (friends|family|sister|brother|mom|dad)\b",
        r"\bquit hanging out with\b",
        r"\byour (friends|family) (are|is) (bad|toxic|against|a bad)\b",
        r"\byou don'?t need (them|anyone|friends|your friends|your family)\b",
        r"\bcut (them|your friends|your family|him|her) off\b",
        r"\bit'?s me or (them|your friends|your family)\b",
        r"\byou (only|just) need me\b",
        r"\bi don'?t want you (to )?(see|seeing|hang|hanging|talk|talking|going out)\b",
        r"\b(trying to|just trying to) (take|keep) you (away|from me)\b",
        r"\bnobody else cares about you\b",
    ],
    "hostility": [
        r"\byou'?re (so |such a |just )?(worthless|pathetic|disgusting|useless|a loser|an? joke|loser)\b",
        r"\byou are (so |such a |just )?(worthless|pathetic|disgusting|useless)\b",
        r"\bi hate you\b",
        r"\bnobody (could|would|will) (ever )?(love|want) you\b",
        r"\byou ruin everything\b",
        r"\byou make me sick\b",
        r"\bno wonder (nobody|no one|everyone)\b",
        r"\bwhat is wrong with you\b",
        r"\bi regret (meeting|dating) you\b",
        r"\byou'?re nothing\b",
    ],
    "threat": [
        r"\b(i'?ll|i will|i'?m going to|i'?m gonna|im gonna|gonna|going to|i could|i can|i'?d) (kill|hurt|beat|hit|punch|strangle|choke|stab|shoot|destroy|ruin) (you|ya|u|her|him|them)\b",
        r"\bi swear i'?ll (kill|hurt|end)\b",
        r"\byou'?ll (regret|pay for|be sorry)\b",
        r"\byou will (regret|pay for|be sorry)\b",
        r"\bmake you pay\b",
        r"\bwatch your back\b",
        r"\bi know where you (live|work|are)\b",
        r"\bi'?ll find you\b",
        r"\bif you leave( me)?,? i('?ll| will)\b",
        r"\bdo (it|what i say) or else\b",
        r"\b(hit|slapped|punched|choked|shoved|kicked|strangled|pushed|grabbed) me\b(?! up)",
        r"\bbeat me up\b",
        r"\bput (his|her|their) hands on me\b",
        r"\b(afraid|scared|terrified) (of|for) (you|him|her|them)\b",
        r"\bi'?m (scared|afraid) (of )?what (you|he|she) (might|will|could) do\b",
        r"\bi (feel|am) (unsafe|not safe)\b",
        r"\b(unsafe|not safe) at home\b",
    ],
    "self_harm": [
        r"\bkill (myself|my self)\b",
        r"\bend (it all|my life|my own life)\b",
        r"\bending my life\b",
        r"\btake my own life\b",
        r"\bwant(ed)? to die\b",
        r"\bwish i (was|were) (dead|gone)\b",
        r"\b(don'?t|do not) want to (be alive|live|be here)( anymore)?\b",
        r"\b(hurt|hurting|cut|cutting|harm|harming) myself\b",
        r"\bsuicid(e|al)\b",
        r"\bbetter off without me\b",
        r"\bno reason to (live|go on)\b",
        r"\bcan'?t go on\b",
        r"\boverdose\b",
        r"\bself[- ]harm",
    ],
}

RULES: dict[str, list[re.Pattern]] = {
    cat: [re.compile(p) for p in pats] for cat, pats in _RAW.items()
}

# Words that signal violence or self-harm when the owner describes it in an interview answer.
FACT_URGENT = [
    re.compile(p) for p in (
        r"\bthreat(en|ened|ens|ening)?\b",
        r"\bviolen(ce|t)\b",
        r"\babus(e|ed|ive)\b",
        r"\b(hit|slapped|punched|choked|shoved|kicked|strangled|pushed|hurt|beat)\b",
        r"\bkill(ed|ing)?\b",
        r"\bweapon\b",
        r"\bself[- ]harm\b",
        r"\bsuicid",
    )
] + [p for cat in URGENT_CATEGORIES for p in RULES[cat]]


def normalize(text: str) -> str:
    t = text.replace("’", "'").replace("‘", "'").replace("`", "'").lower()
    return re.sub(r"\s+", " ", t).strip()


def scan(text: str) -> set[str]:
    """Categories whose rules match the text."""
    t = normalize(text)
    return {cat for cat, pats in RULES.items() if any(p.search(t) for p in pats)}
