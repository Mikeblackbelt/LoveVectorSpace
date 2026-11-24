"""Synthetic demo data: Yu Cheng (potential), Sam (established), Jordan (potential, too thin).

Everything here is invented, English and non-graphic. Timestamps are relative to "now" so the demo
always looks current. Deterministic (fixed RNG seed per person) apart from that offset.

Resumable and idempotent (`seed` may run on every start): each person's data is written under the user
lock and only then marked complete (setting `demo_seed:<name>` = person id). On the next run a person
whose marker is missing has any same-named leftovers (a crash mid-write) removed and is seeded again; a
marked person that was deleted is seeded again; a marked person without an overview snapshot (a crash
or shutdown during analysis) is analysed again. Analysis runs outside the user lock (models included).
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

from analyzer.parsers.model import Message
from analyzer.store.facts import Facts
from analyzer.store.interactions import Interactions
from analyzer.store.links import SpeakerMap
from analyzer.store.messages import MessageStore
from analyzer.store.models import InteractionFields
from analyzer.store.next_steps import NextSteps
from analyzer.store.people import People
from analyzer.store.settings import Settings

OPENERS_ME = ["hey, how was your day?", "morning! did you sleep okay?", "hi you. what are you up to tonight?",
              "just saw this and thought of you", "how did the presentation go?", "hey, are you free this weekend?",
              "good morning, coffee is calling my name", "how's your week been so far?"]
OPENERS_THEM = ["hi! just got home, long day", "hey you, how are you?", "good morning :)",
                "i was just about to text you", "you won't believe what happened on the train",
                "hey, how was your day?", "what are you up to later?", "morning! ready for monday?"]
FILLER = ["that sounds really good", "haha no way", "i know, right?", "honestly same", "that makes sense",
          "ha, that's funny", "oh nice, tell me more", "yeah i think so too", "that's so true",
          "wow, i didn't know that", "okay that sounds like a plan", "i get what you mean",
          "we should try that place sometime", "lol i can picture it", "sounds good to me",
          "that's a lot, i hope it gets easier", "i was thinking the same thing"]
QUESTIONS = ["what did you end up doing?", "have you ever been there?", "do you want to try it this week?",
             "how do you usually spend sundays?", "what kind of music are you into lately?",
             "did you get to see your sister?", "what are you reading right now?",
             "how did your exam go?", "which one would you pick?"]
DISCLOSE = ["honestly i feel a bit nervous about the new job", "i'm a little stressed about money lately",
            "i miss my grandmother's cooking so much", "i feel like i can talk to you about this stuff",
            "i'm worried i'm not doing enough at work", "i wish i had more time to paint again",
            "i'm excited about the trip, i feel lucky", "i felt really alone when i first moved here"]
PLANS = ["want to grab dinner on friday?", "there's a market on saturday, want to go?",
         "let's get coffee after class", "i found a nice walking trail, are you in?"]


def _answers(defn, base: int, jitter: random.Random):
    ans = {}
    for item in defn.items:
        lo, hi = defn.item_range(item)
        ans[item.id] = max(lo, min(hi, base + jitter.choice((-1, 0, 0, 1))))
    return ans


def _session(rng, day, initiator, source, platform_ids, counter, n, extra=()):
    """One chat session: a list of Messages starting at a random hour of `day`."""
    t = day.replace(hour=rng.randint(8, 21), minute=rng.randint(0, 50))
    role = initiator
    out = []
    lines = [rng.choice(OPENERS_ME if role == "me" else OPENERS_THEM)]
    for i in range(n):
        if i < len(lines):
            text = lines[i]
        else:
            pool = rng.choices([FILLER, QUESTIONS, DISCLOSE, PLANS], [6, 3, 1.2, 0.5])[0]
            text = rng.choice(pool)
        counter[0] += 1
        mid = f"{platform_ids}-{counter[0]}" if platform_ids else None
        out.append(Message(t, role, "Alex" if role == "me" else "Yu", text, "minute", mid, source))
        t += timedelta(minutes=rng.randint(1, 9), seconds=0)
        if rng.random() > 0.2:  # mostly alternate; sometimes double-text
            role = "them" if role == "me" else "me"
    for text in extra:  # always spoken by the other person
        counter[0] += 1
        mid = f"{platform_ids}-{counter[0]}" if platform_ids else None
        out.append(Message(t, "them", "Yu", text, "minute", mid, source))
        t += timedelta(minutes=2)
    return out


def _chat(rng, start, days, active, source, ids_prefix, size, them_name, skip=(), mon=None, me_init=0.5):
    msgs, counter = [], [0]
    for d in range(days):
        forced = bool(mon) and d in mon
        if d in skip or (rng.random() > active and not forced):
            continue
        day = start + timedelta(days=d)
        init = "me" if rng.random() < me_init else "them"
        extra = [mon[d]] if mon and d in mon else []
        msgs += _session(rng, day, init, source, ids_prefix, counter, rng.randint(*size), extra)
    return [Message(m.ts, m.role, m.speaker_raw if m.role == "me" else them_name, m.text,
                    m.ts_precision, m.platform_msg_id, m.source) for m in msgs]


DEMO_PEOPLE = ("Yu Cheng", "Sam", "Jordan")


def _marker(name: str) -> str:
    return f"demo_seed:{name}"


def _seed_yu(svc, now):
    conn, rng = svc.conn, random.Random(7)
    store, facts, inter, ppl, sm = MessageStore(conn), Facts(conn), Interactions(conn), People(conn), SpeakerMap(conn)
    # potential, 10 weeks, two-week coverage gap
    yu = ppl.add("Yu Cheng", "potential", "America/New_York")
    start = (now - timedelta(days=70)).replace(hour=0, minute=0)
    part1 = _chat(rng, start, 28, 0.85, "whatsapp_import", None, (4, 11), "Yu", me_init=0.62)
    part2 = _chat(rng, start + timedelta(days=42), 28, 0.85, "whatsapp_ext", "yu", (4, 11), "Yu", me_init=0.6)
    store.ingest(yu.id, part1, "import:seed-yu-1")
    store.ingest(yu.id, part2, "capture:whatsapp:seed-yu-2")
    for src in ("whatsapp_import", "whatsapp_ext"):
        sm.set(yu.id, src, "Alex", "me")
        sm.set(yu.id, src, "Yu", "them")
    for key, val, conf in [("met.how", "Through a mutual friend's birthday dinner", "owner_sure"),
                           ("known.length", "About three months", "owner_sure"),
                           ("inperson.where", "Coffee shops near campus, once a fortnight", "owner_sure"),
                           ("goals.hope", "Hoping it becomes something more; a bit unsure how they feel",
                            "owner_unsure")]:
        facts.upsert(yu.id, key, val, "interview", conf)
    for days_ago, init, close, comfort, ft, plan, tension in [
            (60, "me", 4, 4, None, "me", None), (47, "them", 5, 5, True, "them", None),
            (30, "me", 5, 5, True, "me", None), (12, "mutual", 6, 6, True, "them", None)]:
        inter.add(yu.id, InteractionFields(
            ts=now - timedelta(days=days_ago), place="Cafe on Main Street", duration_min=90,
            initiated_by=init, activity="coffee and a walk", closeness_1_7=close, comfort_1_7=comfort,
            responsiveness=["asked about my week", "remembered the exam"], tension=tension,
            next_plan_proposed_by=plan, followed_through_prev=ft), "Relaxed, easy conversation.")
    for sid, base in (("reciprocity", 5), ("disclosure_balance", 4), ("breadcrumbing", 3)):
        svc._save_scale(yu.id, sid, _answers(svc.factory.scales[sid], base, rng))
    NextSteps(conn).add(yu.id, "plan", "Suggest a specific plan for next week",
                        "You suggest most meetups; proposing one concrete option makes it easy for them to "
                        "say yes or counter.", ["metric:meetup_initiation_share", "interaction:1"])
    NextSteps(conn).add(yu.id, "reflect", "Notice who opens up first",
                        "Opening up is fairly even so far; see whether that holds when topics get personal.",
                        ["metric:disclosure_rate"])
    return yu.id


def _seed_sam(svc, now):
    conn, rng = svc.conn, random.Random(11)
    store, facts, inter, ppl, sm = MessageStore(conn), Facts(conn), Interactions(conn), People(conn), SpeakerMap(conn)
    # established, WhatsApp + Discord, monitoring-style messages
    sam = ppl.add("Sam", "established", "America/Chicago")
    sstart = (now - timedelta(days=84)).replace(hour=0, minute=0)
    mon = {70: "who were you with last night?", 74: "send me your location, i want to see where you are",
           77: "let me see your phone, i just want to check something",
           80: "why was your phone off? who were you talking to?"}
    wa = _chat(rng, sstart, 84, 0.8, "whatsapp_import", None, (3, 6), "Sam", mon=mon, me_init=0.5)
    dc = _chat(rng, sstart + timedelta(days=14), 70, 0.35, "discord_ext", "sam", (3, 7), "Sam", me_init=0.45)
    store.ingest(sam.id, wa, "import:seed-sam-1")
    store.ingest(sam.id, dc, "capture:discord:seed-sam-2")
    for src in ("whatsapp_import", "discord_ext"):
        sm.set(sam.id, src, "Alex", "me")
        sm.set(sam.id, src, "Sam", "them")
    for key, val, conf in [("stage.length", "Together about two years", "owner_sure"),
                           ("living.situation", "Live together, shared flat", "owner_sure"),
                           ("stressors.main", "Work schedules clash", "owner_unsure")]:
        facts.upsert(sam.id, key, val, "interview", conf)
    for days_ago, init in ((40, "mutual"), (26, "them"), (9, "me")):
        inter.add(sam.id, InteractionFields(
            ts=now - timedelta(days=days_ago), place="Home", duration_min=180, initiated_by=init,
            activity="dinner and a film", closeness_1_7=5, comfort_1_7=5, responsiveness=["listened"],
            next_plan_proposed_by="me", followed_through_prev=True), "")
    svc._save_scale(sam.id, "csi16", _answers(svc.factory.scales["csi16"], 4, rng))
    return sam.id


def _seed_jordan(svc, now):
    conn = svc.conn
    # potential, too few messages
    jordan = People(conn).add("Jordan", "potential", "UTC")
    jl = [("me", "hey! it was great meeting you yesterday"), ("them", "same here, i had a good time"),
          ("me", "want to get coffee sometime this week?"), ("them", "sure, thursday works for me"),
          ("me", "perfect, i know a nice place nearby"), ("them", "sounds good, send me the address"),
          ("me", "will do tonight"), ("them", "great, see you then")]
    t = now - timedelta(days=3)
    jmsgs = [Message(t + timedelta(minutes=5 * i), r, "Alex" if r == "me" else "Jordan", x, "minute",
                     None, "whatsapp_import") for i, (r, x) in enumerate(jl)]
    MessageStore(conn).ingest(jordan.id, jmsgs, "import:seed-jordan-1")
    return jordan.id


SEEDERS = {"Yu Cheng": _seed_yu, "Sam": _seed_sam, "Jordan": _seed_jordan}


def _has_overview(conn, pid: int) -> bool:
    from .analysis import overview_snapshots
    return bool(overview_snapshots(conn, pid))


def seed(svc) -> dict[str, str]:
    """Bring the demo people to a complete state. Returns {name: "ok" | "seeded" | "analysed"}."""
    status: dict[str, str] = {}
    to_analyse: list[tuple[str, int]] = []
    with svc._live():
        conn = svc.conn
        st, ppl = Settings(conn), People(conn)
        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        for name in DEMO_PEOPLE:
            marked = st.get(_marker(name))
            person = ppl.get(marked) if isinstance(marked, int) else None
            if person is not None and person.pseudonym != name:
                person = None
            if person is None and marked is None:
                same = [p for p in ppl.list() if p.pseudonym == name]
                legacy = next((p for p in same if _has_overview(conn, p.id)), None)
                if legacy is not None:      # seeded by an older version (no markers): adopt it
                    person = legacy
                    st.set(_marker(name), legacy.id)
                else:                       # leftovers of an interrupted seed: start this person over
                    for p in same:
                        ppl.delete(p.id)
            if person is None:
                pid = SEEDERS[name](svc, now)
                st.set(_marker(name), pid)  # data complete; analysis may still be pending
                status[name] = "seeded"
            else:
                pid = person.id
                status[name] = "ok"
            if not _has_overview(conn, pid):
                to_analyse.append((name, pid))
    for name, pid in to_analyse:            # user lock released: the models never block the account
        svc.analyze_now(pid)
        if status[name] == "ok":
            status[name] = "analysed"
    return status
