"""Service layer: `ServiceFactoryImpl` / `UserServiceImpl` implementing service/facade.py.

Threading model (chosen design): the API layer hands us one already-open SQLCipher connection per user.
`open_db` opens connections with check_same_thread=False, and *every* touch of a user's database, from
request threads, the single background worker and debounce timers, happens while holding that user's
RLock (kept in the factory, keyed by user id, so several `UserServiceImpl` objects for one user share
it). Background jobs run on one worker thread. They use the connection of the service object that
scheduled them, unless the factory was given a `conn_opener(user_id)`, in which case each background
task opens (and closes) its own connection, which is the right choice if the API closes request
connections. Either way the per-user lock serialises all access.

Lifetime: `UserServiceImpl.close()` (or `ServiceFactoryImpl.close_user(user_id)`) cancels the user's debounce
timers, flags the service closed (checked under the user lock by every timer and queued task, which then
no-op) and waits, bounded, for tasks already running. The API must call `service.close()` and then
`with service.lock: conn.close()`, holding the SAME per-user lock (`service.lock`) around the connection
close, before deleting or evicting a user. `ServiceFactoryImpl.shutdown()` does the same for all users.
Jobs left queued/running by a close are marked `error` ("cancelled") the next time the user is opened.

Integration: the API should build the factory with `ServiceFactoryImpl.from_settings(settings)`, which wires
the scales, overlay and models directories and the Groq client factory (the agent is unavailable only when
GROQ_API_KEY is missing). `conn_opener(user_id)` must raise (never create a file) for a deleted user.

Logs never contain message text, fact values or agent content: only ids, counts and exception names.
"""
from __future__ import annotations

import contextlib
import functools
import json
import logging
import queue
import re
import threading
import uuid
import weakref
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import ValidationError

from analyzer.agent.checkins import CHECKIN_FIRST_Q
from analyzer.agent.interview import first_question, progress as interview_prog
from analyzer.agent.loop import run_agent
from analyzer.agent.next_steps import generate_next_steps as _generate
from analyzer.parsers import (detect_format, ParseError, assign_roles, filter_english, parse_discord_json,
                              parse_instagram_json, parse_plaintext, parse_whatsapp, to_utc)
from analyzer.parsers import bumble_json, grindr_json, hinge_json, tinder_json
from analyzer.parsers.model import Message
from analyzer.scales.loader import load_scales
from analyzer.scales.schema import display_text
from analyzer.scales.scorer import AnswerError, score as score_scale
from analyzer.store.agent import AgentStore
from analyzer.store.facts import Facts
from analyzer.store.interactions import Interactions
from analyzer.store.jobs import Jobs
from analyzer.store.links import ChatLinks, SpeakerMap
from analyzer.store.messages import MessageStore
from analyzer.store.models import InteractionFields
from analyzer.store.next_steps import _COLS as _STEP_COLS, NextSteps, _row as _step_row
from analyzer.store.people import People
from analyzer.store.settings import Settings
from analyzer.store.snapshots import Snapshots
from analyzer.store._base import now_str, parse as parse_ts, tx

from . import analysis, labels
from .analysis import iso, person_dict
from .facade import (AgentUnavailable, ChatNotLinked, EventSink, InvalidInput, NotFound)
from .material import material_change

log = logging.getLogger("analyzer.service")

DEBOUNCE_S = 900
PLATFORMS = ("whatsapp", "discord", "instagram", "tinder", "grindr", "bumble")
THEMES = ("signal", "pulse", "riso", "blueprint", "journal", "matcha", "midnight", "inkwell", "crt")
DATING = {"tinder": tinder_json, "hinge": hinge_json, "grindr": grindr_json, "bumble": bumble_json}
SOURCE_RE = re.compile(r"^(screenshot_import|android_sms|android_(notify|a11y)_[a-z0-9_]{1,30})$")
KINDS = ("chat", "interview", "checkin")
THREAD_TITLES = {"chat": "Chat", "interview": "Intake interview", "checkin": "Hangout check-in"}
CAPTURE_CHUNK = 2000
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
SETTING_DEFAULTS: dict[str, Any] = {
    "theme": "signal",
    "auto_theme": {"mode": "system", "day": "journal", "night": "signal",
                   "day_start": "07:00", "day_end": "19:00"},
    "reduce_motion": False, "contrast_boost": False, "text_size": "m",
    "owner_timezone": None, "agent_enabled": True, "agent_reads_text": True, "catchup_enabled": True,
}


class NullEvents:
    def publish(self, user_id: str, event: dict) -> None:
        pass


def _tz(name: str | None, field: str = "timezone") -> str:
    if not name:
        return "UTC"
    try:
        ZoneInfo(name)
    except Exception as e:
        raise InvalidInput("unknown timezone", field) from e
    return name


def _utc(s: str) -> datetime:
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, AttributeError) as e:
        raise InvalidInput("bad timestamp", "ts") from e
    return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d.astimezone(timezone.utc)


def _fields_dict(f: InteractionFields) -> dict:
    d = f.model_dump(mode="json")
    d["ts"] = iso(f.ts)
    return d


def _inter_dict(i) -> dict:
    return {"id": i.id, "person_id": i.person_id, "fields": _fields_dict(i.fields), "notes": i.notes}


def _fact_dict(f) -> dict:
    return {"id": f.id, "person_id": f.person_id, "key": f.key, "value": f.value, "source": f.source,
            "confidence": f.confidence, "updated_at": iso(f.updated_at)}


def _step_dict(s) -> dict:
    return {"id": s.id, "kind": s.kind, "title": s.title, "why": s.why,
            "evidence_refs": s.evidence_refs, "status": s.status, "created_at": iso(s.created_at)}


def _job_dict(j) -> dict:
    return {"id": j.id, "kind": j.kind, "status": j.status, "error": j.error,
            "created_at": iso(j.created_at), "finished_at": iso(j.finished_at) if j.finished_at else None}


class ServiceClosed(RuntimeError):
    """The service (or its factory) was closed; background work must stop touching the connection."""


def locked(fn):
    @functools.wraps(fn)
    def wrapper(self, *a, **kw):
        with self._live():
            return fn(self, *a, **kw)
    return wrapper


# ---------------------------------------------------------------------------------------------
class _UserState:
    def __init__(self):
        self.lock = threading.RLock()  # the per-user lock: every touch of the user's DB holds it
        self.cv = threading.Condition()  # guards the fields below; never held while taking `lock`
        self.pending: dict[int, threading.Timer] = {}
        self.firing = 0  # debounce timers that fired but have not yet queued their job
        self.running = 0  # background tasks of this user currently executing
        self.services: "weakref.WeakSet" = weakref.WeakSet()
        self.recovered = False


class ServiceFactoryImpl:
    def __init__(self, scales_dir, overlay_dir, models_dir, groq_client_factory: Callable | None = None,
                 debounce_s: float = DEBOUNCE_S, conn_opener: Callable[[str], Any] | None = None):
        self.scales = load_scales(Path(scales_dir), Path(overlay_dir) if overlay_dir else None)
        self.models_dir = Path(models_dir) if models_dir else None
        self.groq_client_factory = groq_client_factory
        self.debounce_s = debounce_s
        self.conn_opener = conn_opener
        self._states: dict[str, _UserState] = {}
        self._states_lock = threading.Lock()
        self._queue: queue.Queue = queue.Queue()
        self._worker: threading.Thread | None = None
        self._submit_lock = threading.Lock()  # guards worker start, queue put and the shutdown flag
        self._shutdown = False
        self._clf: SimpleNamespace | None = None
        self._clf_lock = threading.Lock()

    @classmethod
    def from_settings(cls, settings, **kw) -> "ServiceFactoryImpl":
        """The factory the API should use: derives directories from settings/env, wires the Groq client."""
        import os
        from analyzer.agent.groq_client import client_factory_from_env
        root = Path(__file__).resolve().parents[1]
        data_dir = getattr(settings, "data_dir", None) or os.environ.get("DATA_DIR")
        overlay = Path(data_dir) / "scale_items" if data_dir else Path("data") / "scale_items"
        models = getattr(settings, "models_dir", None) or os.environ.get("MODELS_DIR")             or root.parents[1] / "models"
        key = getattr(settings, "groq_api_key", None)
        if key:  # settings may come from .env; the env-based factory reads os.environ
            os.environ.setdefault("GROQ_API_KEY", key)
        model = getattr(settings, "groq_model", None)
        if model:
            os.environ.setdefault("GROQ_MODEL", model)
        return cls(root / "scales" / "defs", overlay, Path(models), client_factory_from_env(), **kw)

    # -- shared plumbing --
    def state(self, user_id: str) -> _UserState:
        with self._states_lock:
            return self._states.setdefault(user_id, _UserState())

    def classifiers(self) -> SimpleNamespace:
        with self._clf_lock:
            if self._clf is None:
                self._clf = SimpleNamespace(emotion=self._load("emotion"), toxicity=self._load("toxicity"))
            return self._clf

    def _load(self, name: str):
        if self.models_dir is None:
            return None
        d = self.models_dir / name
        if not (d / "model.onnx").exists() or not (d / "labels.json").exists():
            return None
        try:
            from analyzer.ml.onnx_text import OnnxTextClassifier
            return OnnxTextClassifier(d, json.loads((d / "labels.json").read_text(encoding="utf-8")))
        except Exception as e:
            log.warning("model %s unavailable: %s", name, e.__class__.__name__)
            return None

    def submit(self, fn: Callable[[], None]) -> None:
        with self._submit_lock:
            if self._shutdown:
                raise ServiceClosed("service factory is shut down")
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._work, name="analysis-worker", daemon=True)
                self._worker.start()
            self._queue.put(fn)

    def _work(self) -> None:
        while True:
            fn = self._queue.get()
            try:
                fn()
            except Exception as e:  # a failed task must never kill the worker
                log.warning("background task failed: %s", e.__class__.__name__)
            finally:
                self._queue.task_done()

    def wait_idle(self, timeout: float = 30.0) -> bool:
        """Block until the worker queue is empty and no debounce timers are pending (tests, shutdown)."""
        end = threading.Event()
        deadline = datetime.now() + timedelta(seconds=timeout)
        while datetime.now() < deadline:
            with self._states_lock:
                states = list(self._states.values())
            pending = False
            for st in states:
                with st.cv:
                    if st.firing or any(t.is_alive() for t in st.pending.values()):
                        pending = True
                        break
            if not pending and self._queue.unfinished_tasks == 0:
                return True
            end.wait(0.02)
        return False

    @staticmethod
    def _cancel_timers(st: _UserState) -> None:
        with st.cv:
            for t in st.pending.values():
                t.cancel()
            st.pending.clear()

    def close_user(self, user_id: str, timeout: float = 10.0) -> None:
        """Close every service of one user (see `UserServiceImpl.close`) and forget the user's state.
        Call before closing/deleting the user's connection; then `with lock: conn.close()`."""
        with self._states_lock:
            st = self._states.get(user_id)
        if st is None:
            return
        for svc in list(st.services):
            svc.close(timeout)
        self._cancel_timers(st)
        with self._states_lock:
            if self._states.get(user_id) is st:
                del self._states[user_id]

    def shutdown(self, timeout: float = 30.0) -> None:
        """Stop all background work: no new submissions, timers cancelled, queued tasks and already-fired
        timers become no-ops. Call before closing user connections."""
        with self._submit_lock:
            self._shutdown = True
        with self._states_lock:
            states = list(self._states.values())
        for st in states:
            self._cancel_timers(st)
        self.wait_idle(timeout)

    # -- facade --
    def for_user(self, user_id: str, conn: Any, events: EventSink) -> "UserServiceImpl":
        svc = UserServiceImpl(self, user_id, conn, events)
        st = svc._state
        with svc._lock:
            if not st.recovered:  # first open in this process: nothing of this user can be running
                st.recovered = True
                try:
                    Jobs(conn).fail_unfinished("cancelled")
                except Exception as e:
                    log.warning("job recovery failed: %s", e.__class__.__name__)
        st.services.add(svc)
        return svc

    def seed_demo(self, user_id: str, conn: Any) -> None:
        from .seed import seed
        seed(self.for_user(user_id, conn, NullEvents()))


# ---------------------------------------------------------------------------------------------
class UserServiceImpl:
    def __init__(self, factory: ServiceFactoryImpl, user_id: str, conn: Any, events: EventSink,
                 origin: "UserServiceImpl | None" = None):
        self.factory, self.user_id, self.conn, self._events = factory, user_id, conn, events
        self._state = factory.state(user_id)
        self._lock = self._state.lock
        self._origin = origin or self  # task services share the closed flag of the service that spawned them
        self._closed = False

    # ------------------------------------------------------------------ lifetime
    @property
    def lock(self) -> threading.RLock:
        """The per-user lock. The API must hold this same lock around `conn.close()`."""
        return self._lock

    @property
    def closed(self) -> bool:
        return self._origin._closed or self.factory._shutdown

    @contextlib.contextmanager
    def _live(self):
        """Hold the user lock; raise ServiceClosed if the service was closed (flag read under the lock)."""
        with self._lock:
            if self.closed:
                raise ServiceClosed(self.user_id)
            yield

    def close(self, timeout: float = 10.0) -> None:
        """Cancel this user's debounce timers, make every timer/queued task a no-op from now on, and wait
        (at most `timeout`) for tasks already running. Idempotent. Call it WITHOUT holding `lock` (waiting
        while holding it cannot finish a task that needs it); afterwards take `lock` around `conn.close()`."""
        with self._lock:
            self._closed = True
        ServiceFactoryImpl._cancel_timers(self._state)
        st = self._state
        with st.cv:
            if not st.cv.wait_for(lambda: st.running == 0 and st.firing == 0, timeout):
                log.warning("close timed out waiting for background work")

    @contextlib.contextmanager
    def _task_service(self):
        """Service object a background task should use (own connection when an opener exists)."""
        opener = self.factory.conn_opener
        if opener is None:
            with self._live():
                pass
            yield self
            return
        with self._live():  # check + open under the lock: a deleted/closed user's file is never re-created
            conn = opener(self.user_id)
        try:
            yield UserServiceImpl(self.factory, self.user_id, conn, self._events, origin=self._origin)
        finally:
            with contextlib.suppress(Exception):
                conn.close()

    def _submit(self, fn: Callable[["UserServiceImpl"], None]) -> None:
        st = self._state

        def task():
            if self.closed:
                return
            with st.cv:
                st.running += 1
            try:
                with self._task_service() as svc:
                    fn(svc)
            except ServiceClosed:
                pass
            finally:
                with st.cv:
                    st.running -= 1
                    st.cv.notify_all()
        try:
            self.factory.submit(task)
        except ServiceClosed:
            log.warning("task rejected: service closed")

    def _publish(self, event: dict) -> None:
        try:
            self._events.publish(self.user_id, event)
        except Exception as e:
            log.warning("event publish failed: %s", e.__class__.__name__)

    def _person(self, pid: int):
        p = People(self.conn).get(pid)
        if p is None:
            raise NotFound(f"person {pid}")
        return p

    # ------------------------------------------------------------------ people & sources
    @locked
    def list_people(self) -> list[dict]:
        out = []
        now = datetime.now(timezone.utc)
        for p in People(self.conn).list():
            snap = self._latest_overview(p.id)
            data = snap.data if snap else None
            succ = (data or {}).get("success") or {}
            out.append({
                "id": p.id, "pseudonym": p.pseudonym, "mode": p.mode,
                "sources": self._sources(p.id, now),
                "success": {"percent": succ.get("percent"), "low": succ.get("low"),
                            "high": succ.get("high"), "status": succ.get("status", "insufficient_data")},
                "safety": analysis.max_severity(data) if data else "none",
                "updated_at": iso(snap.created_at) if snap else None})
        return out

    def _sources(self, pid: int, now: datetime) -> list[dict]:
        rows = self.conn.execute(
            "SELECT s.source, MAX(m.ts) FROM message_sources s JOIN messages m ON m.id=s.message_id"
            " WHERE m.person_id=? GROUP BY s.source ORDER BY s.source", (pid,)).fetchall()
        out = []
        for src, last in rows:
            ts = parse_ts(last)
            out.append({"source": src, "last_sync": iso(ts),
                        "health": "ok" if now - ts <= timedelta(days=14) else "stale"})
        return out

    @locked
    def create_person(self, pseudonym: str, mode: str, timezone: str | None = None) -> dict:
        pseudonym = (pseudonym or "").strip()
        if not pseudonym or len(pseudonym) > 80:
            raise InvalidInput("pseudonym must be 1-80 characters", "pseudonym")
        if mode not in ("potential", "established"):
            raise InvalidInput("mode must be potential or established", "mode")
        return person_dict(People(self.conn).add(pseudonym, mode, _tz(timezone)))

    @locked
    def get_person(self, pid: int) -> dict:
        return person_dict(self._person(pid))

    @locked
    def update_person(self, pid: int, **fields: Any) -> dict:
        self._person(pid)
        sets, args = [], []
        if fields.get("pseudonym") is not None:
            ps = str(fields["pseudonym"]).strip()
            if not ps or len(ps) > 80:
                raise InvalidInput("pseudonym must be 1-80 characters", "pseudonym")
            sets.append("pseudonym=?"); args.append(ps)
        if fields.get("mode") is not None:
            if fields["mode"] not in ("potential", "established"):
                raise InvalidInput("mode must be potential or established", "mode")
            sets.append("mode=?"); args.append(fields["mode"])
        if fields.get("timezone") is not None:
            sets.append("timezone=?"); args.append(_tz(fields["timezone"]))
        if sets:
            with tx(self.conn) as c:
                c.execute(f"UPDATE people SET {', '.join(sets)} WHERE id=?", [*args, pid])  # fixed column names
            if "mode" in fields and fields["mode"] is not None:
                self.schedule_reanalysis(pid)
        return person_dict(self._person(pid))

    @locked
    def delete_person(self, pid: int) -> None:
        self._person(pid)
        timer = self._state.pending.pop(pid, None)
        if timer:
            timer.cancel()
        with tx(self.conn) as c:
            c.execute("DELETE FROM settings WHERE key IN (?,?)",
                      (f"skipped_non_english:{pid}", f"next_steps_auto_at:{pid}"))
        People(self.conn).delete(pid)

    # -- parsing --
    @staticmethod
    def _decode(raw: bytes) -> str:
        return raw.decode("utf-8-sig", errors="replace")

    def _parse(self, filename: str, raw: bytes, tz: str, me_names: list[str], match_id: str | None = None):
        """-> (fmt, messages, one_sided); roles assigned unless `me_names` is empty.

        Dating formats need `match_id` (one match = one unit); parser errors become InvalidInput."""
        try:
            fmt = detect_format(filename or "", raw)
            text = self._decode(raw)
            if fmt in DATING:
                if not match_id:
                    raise InvalidInput("pick which match to import", "match_id")
                owner = me_names[0] if me_names else "Me"
                try:
                    msgs, one = DATING[fmt].parse_match(text, match_id, owner)
                except ParseError as e:
                    if "not found" in str(e):
                        raise InvalidInput(str(e), "match_id") from e
                    raise
                return fmt, msgs, one
            if fmt == "discord":
                msgs, one = parse_discord_json(text, me_names[0] if me_names else "")
                return fmt, msgs, one
            if fmt == "instagram":
                msgs, one = parse_instagram_json(text), False
            elif fmt == "whatsapp":
                msgs, one = parse_whatsapp(text, tz), False
            else:
                msgs, one = parse_plaintext(text, tz), False
        except ParseError as e:
            raise InvalidInput(str(e), "file") from e
        if me_names:
            msgs = assign_roles(msgs, set(me_names))
        return fmt, msgs, one

    @staticmethod
    def _match_dict(m) -> dict:
        return {"match_id": m.match_id, "label": m.label,
                "first_ts": iso(m.first_ts) if m.first_ts else None,
                "last_ts": iso(m.last_ts) if m.last_ts else None,
                "message_count": m.message_count, "one_sided": m.one_sided}

    def preview_import(self, filename: str, raw: bytes) -> dict:
        try:
            fmt = detect_format(filename or "", raw)
            if fmt in DATING:
                matches = DATING[fmt].list_matches(self._decode(raw))
                return {"format": fmt, "matches": [self._match_dict(m) for m in matches],
                        "one_sided": all(m.one_sided for m in matches)}
        except ParseError as e:
            raise InvalidInput(str(e), "file") from e
        fmt, msgs, one = self._parse(filename, raw, "UTC", [])
        speakers = sorted({m.speaker_raw for m in msgs if m.speaker_raw})
        if fmt == "discord":
            speakers = speakers or ["(you)"]
        return {"format": fmt, "speakers": speakers, "lines": len(msgs),
                "one_sided": bool(one or len(speakers) < 2)}

    def _store_import(self, pid: int, msgs: list[Message], unit_id: str, one_sided: bool,
                      check_roles: bool = True) -> dict:
        msgs, skipped_ne = filter_english(msgs)
        res = MessageStore(self.conn).ingest(pid, msgs, unit_id)
        sm = SpeakerMap(self.conn)
        for src, speaker, role in {(m.source, m.speaker_raw, m.role) for m in msgs if m.role}:
            sm.set(pid, src, speaker, role)
        self._add_skipped(pid, skipped_ne)
        one_sided = bool(one_sided or (check_roles and len({m.role for m in msgs}) < 2))
        job_id = self.start_analysis(pid)
        self._publish({"type": "ingest", "person_id": pid, "added": res.added, "merged": res.merged})
        return {"unit_id": unit_id, "added": res.added, "merged": res.merged,
                "skipped_non_english": skipped_ne, "one_sided": one_sided, "job_id": job_id}

    @locked
    def import_file(self, pid: int, filename: str, raw: bytes, tz: str, me_names: list[str],
                    match_id: str | None = None) -> dict:
        self._person(pid)
        me_names = [n for n in (me_names or []) if n and n.strip()]
        tz = _tz(tz, "tz")
        try:
            dating = detect_format(filename or "", raw) in DATING
        except ParseError as e:
            raise InvalidInput(str(e), "file") from e
        if not me_names and not dating:
            raise InvalidInput("say which name is you", "me_names")
        fmt, msgs, one_sided = self._parse(filename, raw, tz, me_names, match_id)
        if fmt not in ("discord", *DATING) and not any(m.role == "me" for m in msgs):
            raise InvalidInput("none of those names appear in the chat", "me_names")
        unit_id = f"import:{fmt}:{match_id}" if dating else f"import:{uuid.uuid4().hex[:16]}"
        return self._store_import(pid, msgs, unit_id, one_sided)

    @locked
    def import_messages(self, pid: int, source: str, tz: str, messages: list[dict]) -> dict:
        """Pre-parsed messages (screenshot OCR, Android readers) through the normal import pipeline."""
        self._person(pid)
        if not isinstance(source, str) or not SOURCE_RE.match(source):
            raise InvalidInput("unknown source", "source")
        tz = _tz(tz, "tz")
        if not isinstance(messages, list) or not messages:
            raise InvalidInput("messages must be a non-empty list", "messages")
        notify = source.startswith("android_notify_")
        out: list[Message] = []
        for m in messages:
            try:
                text = m["text"]
                if not isinstance(text, str) or not text.strip():
                    raise ValueError
                ts = _utc(m["ts_utc"]) if m.get("ts_utc") else to_utc(datetime.fromisoformat(m["ts_local"]), tz)
                role = "them" if notify else m["role"]
                if role not in ("me", "them"):
                    raise ValueError
                prec = m.get("ts_precision", "approx")
                if prec not in ("second", "minute", "approx"):
                    raise ValueError
            except (KeyError, ValueError, TypeError, InvalidInput) as e:
                raise InvalidInput("each message needs text, role me|them, ts_utc or ts_local, ts_precision",
                                   "messages") from e
            out.append(Message(ts, role, role, text, prec, None, source))
        others = self.conn.execute(
            "SELECT 1 FROM units WHERE person_id=? AND source NOT LIKE 'android\\_notify\\_%' ESCAPE '\\' LIMIT 1",
            (pid,)).fetchone()
        return self._store_import(pid, out, f"import:{source}:{uuid.uuid4().hex[:12]}",
                                  bool(notify and not others), check_roles=not notify)

    def _add_skipped(self, pid: int, n: int) -> None:
        if n:
            st = Settings(self.conn)
            st.set(f"skipped_non_english:{pid}", (st.get(f"skipped_non_english:{pid}", 0) or 0) + n)

    @locked
    def list_units(self, pid: int) -> list[dict]:
        self._person(pid)
        return [{"unit_id": u.unit_id, "source": u.source, "created_at": iso(u.created_at),
                 "message_count": u.message_count,
                 "start_ts": iso(u.start_ts) if u.start_ts else None,
                 "end_ts": iso(u.end_ts) if u.end_ts else None}
                for u in MessageStore(self.conn).units(pid)]

    @locked
    def delete_unit(self, unit_id: str) -> dict:
        r = self.conn.execute("SELECT person_id FROM units WHERE unit_id=?", (unit_id,)).fetchone()
        if r is None:
            raise NotFound("unit")
        removed = MessageStore(self.conn).delete_unit(unit_id)
        self.start_analysis(r[0])
        return {"removed_messages": removed}

    @locked
    def get_speakers(self, pid: int) -> list[dict]:
        self._person(pid)
        return [{"source": m.source, "speaker_raw": m.speaker_raw, "role": m.role}
                for m in SpeakerMap(self.conn).get(pid)]

    @locked
    def set_speakers(self, pid: int, mappings: list[dict]) -> list[dict]:
        self._person(pid)
        by_source: dict[str, dict[str, str]] = {}
        for m in mappings:
            if not isinstance(m, dict) or m.get("role") not in ("me", "them") \
                    or not m.get("source") or not m.get("speaker_raw"):
                raise InvalidInput("each mapping needs source, speaker_raw and role me|them", "mappings")
            by_source.setdefault(m["source"], {})[m["speaker_raw"]] = m["role"]
        store, sm = MessageStore(self.conn), SpeakerMap(self.conn)
        for source, mp in by_source.items():
            for raw_name, role in mp.items():
                sm.set(pid, source, raw_name, role)
            store.set_roles(pid, source, mp)
        if by_source:
            self.start_analysis(pid)
        return self.get_speakers(pid)

    @locked
    def coverage(self, pid: int) -> list[dict]:
        self._person(pid)
        return [{"source": src, "start": iso(s), "end": iso(e)}
                for s, e, src in MessageStore(self.conn).coverage(pid)]

    # ------------------------------------------------------------------ analysis & jobs
    def _latest_overview(self, pid: int):
        snaps = analysis.overview_snapshots(self.conn, pid)
        return snaps[0] if snaps else None

    @locked
    def overview(self, pid: int) -> dict:
        self._person(pid)
        snap = self._latest_overview(pid)
        if snap is None:
            raise NotFound("no analysis yet")
        steps = [_step_dict(s) for s in NextSteps(self.conn).list(pid, "open")]
        return analysis.public(snap.data, steps)

    @locked
    def start_analysis(self, pid: int) -> int:
        self._person(pid)
        job_id = Jobs(self.conn).create(pid, "analysis")
        self._publish({"type": "job", "person_id": pid, "job_id": job_id, "status": "queued"})
        self._submit(lambda svc: svc._exec_analysis(job_id, pid))
        return job_id

    def schedule_reanalysis(self, pid: int, debounce_s: float | None = None) -> None:
        """Debounced re-analysis: while a timer is pending for this person, further calls add nothing."""
        delay = self.factory.debounce_s if debounce_s is None else debounce_s
        st = self._state
        with self._lock:
            if self.closed:
                return
            with st.cv:
                if pid in st.pending and st.pending[pid].is_alive():
                    return

                def fire():
                    with st.cv:
                        if st.pending.get(pid) is timer:
                            del st.pending[pid]
                        st.firing += 1
                    try:
                        with self._task_service() as svc, svc._live():  # no-op once closed / shut down
                            if People(svc.conn).get(pid) is None:
                                return
                            job_id = Jobs(svc.conn).create(pid, "reanalysis")
                        self._publish({"type": "job", "person_id": pid, "job_id": job_id, "status": "queued"})
                        self._submit(lambda t: t._exec_analysis(job_id, pid))
                    except ServiceClosed:
                        pass
                    except Exception as e:
                        log.warning("debounced job failed: %s", e.__class__.__name__)
                    finally:
                        with st.cv:
                            st.firing -= 1
                            st.cv.notify_all()

                timer = threading.Timer(delay, fire)
                timer.daemon = True
                st.pending[pid] = timer
                timer.start()

    def run_now(self, pid: int) -> int:
        """Bypass the debounce: cancel any pending timer and analyse immediately."""
        with self._live():
            with self._state.cv:
                t = self._state.pending.pop(pid, None)
            if t:
                t.cancel()
        return self.start_analysis(pid)

    def _job_event(self, pid, job_id, status):
        self._publish({"type": "job", "person_id": pid, "job_id": job_id, "status": status})

    def analyze_now(self, pid: int) -> dict:
        """Synchronous analysis + snapshot (no job row). Returns (snapshot data, material)."""
        with self._live():
            prev = self._latest_overview(pid)
            data = analysis.compute_overview(self.conn, pid, self.factory.scales, self.factory.classifiers())
            Snapshots(self.conn).save(pid, data)
            steps = NextSteps(self.conn).list(pid)
            last_cards = max((s.created_at for s in steps), default=None)
            material = material_change(prev.data if prev else None, data, last_cards)
        self._publish({"type": "snapshot", "person_id": pid})
        data["_material"] = material
        return data

    def _exec_analysis(self, job_id: int, pid: int) -> None:
        with self._live():
            jobs = Jobs(self.conn)
            if People(self.conn).get(pid) is None:
                jobs.update(job_id, "error", "person removed")
                return
            jobs.update(job_id, "running")
        self._job_event(pid, job_id, "running")
        try:
            data = self.analyze_now(pid)
            material = data.pop("_material")
        except Exception as e:
            log.warning("analysis job %s failed: %s", job_id, e.__class__.__name__)
            with self._live():
                Jobs(self.conn).update(job_id, "error", f"analysis failed ({e.__class__.__name__})")
            self._job_event(pid, job_id, "error")
            return
        with self._live():
            Jobs(self.conn).update(job_id, "done")
        self._job_event(pid, job_id, "done")
        if material:
            self._submit(lambda svc: svc._exec_next_steps(None, pid, on_demand=False))

    def _exec_next_steps(self, job_id: int | None, pid: int, on_demand: bool) -> None:
        if job_id is not None:
            with self._live():
                Jobs(self.conn).update(job_id, "running")
            self._job_event(pid, job_id, "running")
        try:
            with self._live():
                if People(self.conn).get(pid) is None:
                    raise NotFound("person")
            _generate(self, pid, on_demand)
        except Exception as e:
            log.warning("next-steps job failed: %s", e.__class__.__name__)
            if job_id is not None:
                with self._live():
                    Jobs(self.conn).update(job_id, "error", f"failed ({e.__class__.__name__})")
                self._job_event(pid, job_id, "error")
            return
        if job_id is not None:
            with self._live():
                Jobs(self.conn).update(job_id, "done")
            self._job_event(pid, job_id, "done")

    @locked
    def job(self, job_id: int) -> dict:
        j = Jobs(self.conn).get(job_id)
        if j is None:
            raise NotFound("job")
        return _job_dict(j)

    @locked
    def history(self, pid: int, metric_id: str) -> list[dict]:
        self._person(pid)
        out = []
        for s in reversed(analysis.overview_snapshots(self.conn, pid)):
            for m in [*s.data.get("metrics", []), *s.data.get("interaction_metrics", [])]:
                if m["id"] == metric_id:
                    out.append({"ts": iso(s.created_at), "value": m["value"]})
        return out

    def explain_metric(self, metric_id: str) -> dict:
        info = labels.explain(metric_id)
        if info is None:
            raise NotFound("metric")
        return info

    # ------------------------------------------------------------------ questionnaires
    def list_scales(self) -> list[dict]:
        out = []
        for defn in self.factory.scales.values():
            d = defn.model_dump(mode="json")
            for item, raw in zip(defn.items, d["items"]):
                raw["display_text"] = display_text(item, defn)
            out.append(d)
        return out

    def _save_scale(self, pid: int, scale_id: str, answers: dict) -> dict:
        self._person(pid)
        defn = self.factory.scales.get(scale_id)
        if defn is None:
            raise NotFound("scale")
        try:
            clean = {str(k): v for k, v in (answers or {}).items()}
            result = score_scale(defn, clean)
        except AnswerError as e:
            raise InvalidInput(str(e), e.item_id) from e
        res = result.model_dump(mode="json")
        Snapshots(self.conn).save(pid, {"kind": "scale", "scale_id": scale_id, "answers": clean, "result": res})
        return res

    @locked
    def submit_questionnaire(self, pid: int, scale_id: str, answers: dict[str, int]) -> dict:
        res = self._save_scale(pid, scale_id, answers)
        self.start_analysis(pid)
        return res

    @locked
    def questionnaire_history(self, pid: int) -> list[dict]:
        self._person(pid)
        return analysis.scale_snapshots(self.conn, pid)

    # ------------------------------------------------------------------ context
    @locked
    def list_facts(self, pid: int) -> list[dict]:
        self._person(pid)
        return [_fact_dict(f) for f in Facts(self.conn).list(pid)]

    @locked
    def add_fact(self, pid: int, key: str, value: str, confidence: str, source: str = "owner_edit") -> dict:
        self._person(pid)
        key = (key or "").strip()
        if not key or not str(value).strip():
            raise InvalidInput("key and value are required", "key")
        try:
            f = Facts(self.conn).upsert(pid, key[:100], str(value)[:2000], source, confidence)
        except ValueError as e:
            raise InvalidInput(str(e), "confidence") from e
        if key.startswith("safety."):
            self.schedule_reanalysis(pid)
        return _fact_dict(f)

    @locked
    def update_fact(self, fact_id: int, **fields: Any) -> dict:
        try:
            f = Facts(self.conn).update(fact_id, value=fields.get("value"), source="owner_edit",
                                        confidence=fields.get("confidence"))
        except KeyError as e:
            raise NotFound("fact") from e
        except ValueError as e:
            raise InvalidInput(str(e), "confidence") from e
        return _fact_dict(f)

    @locked
    def delete_fact(self, fact_id: int) -> None:
        if Facts(self.conn).get(fact_id) is None:
            raise NotFound("fact")
        Facts(self.conn).delete(fact_id)

    @locked
    def list_interactions(self, pid: int, since: str | None = None) -> list[dict]:
        self._person(pid)
        return [_inter_dict(i) for i in Interactions(self.conn).list(pid, _utc(since) if since else None)]

    @staticmethod
    def _validate_fields(fields: dict) -> InteractionFields:
        try:
            return InteractionFields.model_validate(fields)
        except ValidationError as e:
            loc = e.errors()[0]["loc"]
            raise InvalidInput("invalid interaction fields", str(loc[0]) if loc else "fields") from e

    @locked
    def add_interaction(self, pid: int, fields: dict, notes: str = "") -> dict:
        self._person(pid)
        i = Interactions(self.conn).add(pid, self._validate_fields(fields), notes or "")
        self.schedule_reanalysis(pid)
        return _inter_dict(i)

    @locked
    def update_interaction(self, interaction_id: int, **patch: Any) -> dict:
        repo = Interactions(self.conn)
        cur = repo.get(interaction_id)
        if cur is None:
            raise NotFound("interaction")
        merged = cur.fields.model_dump(mode="json")
        merged.update(patch.get("fields") or {})
        merged.update({k: v for k, v in patch.items() if k in InteractionFields.model_fields})
        i = repo.update(interaction_id, self._validate_fields(merged), patch.get("notes"))
        self.schedule_reanalysis(i.person_id)
        return _inter_dict(i)

    @locked
    def delete_interaction(self, interaction_id: int) -> None:
        cur = Interactions(self.conn).get(interaction_id)
        if cur is None:
            raise NotFound("interaction")
        Interactions(self.conn).delete(interaction_id)
        self.schedule_reanalysis(cur.person_id)

    # ------------------------------------------------------------------ next steps
    @locked
    def list_next_steps(self, pid: int, status: str | None = None) -> list[dict]:
        self._person(pid)
        if status not in (None, "open", "done", "dismissed"):
            raise InvalidInput("bad status", "status")
        return [_step_dict(s) for s in NextSteps(self.conn).list(pid, status)]

    @locked
    def generate_next_steps(self, pid: int) -> int:
        self._person(pid)
        job_id = Jobs(self.conn).create(pid, "next_steps")
        self._job_event(pid, job_id, "queued")
        self._submit(lambda svc: svc._exec_next_steps(job_id, pid, on_demand=True))
        return job_id

    @locked
    def set_next_step_status(self, step_id: int, status: str) -> dict:
        if status not in ("open", "done", "dismissed"):
            raise InvalidInput("bad status", "status")
        try:
            NextSteps(self.conn).set_status(step_id, status)
        except KeyError as e:
            raise NotFound("next step") from e
        return _step_dict(_step_row(self.conn.execute(
            f"SELECT {_STEP_COLS} FROM next_steps WHERE id=?", (step_id,)).fetchone()))

    # helpers used by the agent package
    @locked
    def _add_step_dedup(self, pid, kind, title, why, refs) -> dict | None:
        ns = NextSteps(self.conn)
        if ns.recent_similar(pid, kind, refs):
            return None
        return _step_dict(ns.add(pid, kind, title, why, refs))

    @locked
    def _max_step_id(self) -> int:
        return self.conn.execute("SELECT COALESCE(MAX(id),0) FROM next_steps").fetchone()[0]

    @locked
    def _steps_after(self, pid: int, step_id: int) -> list[dict]:
        return [_step_dict(s) for s in NextSteps(self.conn).list(pid) if s.id > step_id]

    @locked
    def _auto_run_allowed(self, pid: int, now: datetime) -> bool:
        st, key = Settings(self.conn), f"next_steps_auto_at:{pid}"
        last = st.get(key)
        if last and now - parse_ts(last) < timedelta(days=1):
            return False
        st.set(key, now_str())
        return True

    @locked
    def _last_interaction_ts(self, pid: int):
        r = self.conn.execute("SELECT MAX(ts) FROM interactions WHERE person_id=?", (pid,)).fetchone()[0]
        return parse_ts(r) if r else None

    @locked
    def _first_message_ts(self, pid: int):
        r = self.conn.execute("SELECT MIN(ts) FROM messages WHERE person_id=?", (pid,)).fetchone()[0]
        return parse_ts(r) if r else None

    @locked
    def _message_count_since(self, pid: int, since: datetime) -> int:
        from analyzer.store._base import fmt
        return self.conn.execute("SELECT COUNT(*) FROM messages WHERE person_id=? AND ts>=?",
                                 (pid, fmt(since))).fetchone()[0]

    @locked
    def _band_change(self, pid: int, metric_id: str):
        snaps = analysis.overview_snapshots(self.conn, pid)
        if len(snaps) < 2:
            return None
        a = snaps[1].data.get("_internal", {}).get("bands", {}).get(metric_id)
        b = snaps[0].data.get("_internal", {}).get("bands", {}).get(metric_id)
        return (a, b) if a and b and a != b else None

    @locked
    def search_messages(self, pid: int, query: str, limit: int = 20) -> list[dict]:
        from analyzer.store.messages import normalize
        limit = max(1, min(int(limit), 50))
        q = normalize(query).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        rows = self.conn.execute(
            "SELECT ts, role, text FROM messages WHERE person_id=? AND role IS NOT NULL"
            " AND norm_text LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT ?", (pid, f"%{q}%", limit)).fetchall()
        return [{"ts": iso(parse_ts(r[0])), "role": r[1], "text": r[2][:240]} for r in rows]

    # ------------------------------------------------------------------ agent
    def _agent_client(self):
        with self._live():
            if not Settings(self.conn).get("agent_enabled", True):
                return None
        f = self.factory.groq_client_factory
        if f is None:
            return None
        try:
            return f()
        except Exception as e:
            log.warning("groq client unavailable: %s", e.__class__.__name__)
            return None

    def _require_agent(self):
        client = self._agent_client()
        if client is None:
            raise AgentUnavailable("agent disabled or no GROQ_API_KEY")
        return client

    @locked
    def _persist_message(self, tid, role, content, tool_calls=None) -> int:
        return AgentStore(self.conn).add_message(tid, role, content, tool_calls).id

    @locked
    def _thread_messages(self, tid):
        t = AgentStore(self.conn).thread(tid)
        return t.messages if t else []

    def _thread_dict(self, t) -> dict:
        last = self.conn.execute("SELECT MAX(created_at) FROM agent_messages WHERE thread_id=?",
                                 (t.id,)).fetchone()[0]
        return {"id": t.id, "kind": t.kind, "title": f"{THREAD_TITLES.get(t.kind, 'Chat')} "
                f"{iso(t.created_at)[:10]}", "created_at": iso(t.created_at),
                "updated_at": iso(parse_ts(last)) if last else iso(t.created_at)}

    @locked
    def list_threads(self, pid: int) -> list[dict]:
        self._require_agent()
        self._person(pid)
        return [self._thread_dict(t) for t in reversed(AgentStore(self.conn).threads(pid))]

    @locked
    def create_thread(self, pid: int, kind: str) -> dict:
        self._require_agent()
        p = self._person(pid)
        if kind not in KINDS:
            raise InvalidInput("kind must be chat, interview or checkin", "kind")
        store = AgentStore(self.conn)
        t = store.new_thread(pid, kind)
        if kind == "interview":
            keys = [f.key for f in Facts(self.conn).list(pid)]
            store.add_message(t.id, "assistant", first_question(p.mode, keys))
        elif kind == "checkin":
            store.add_message(t.id, "assistant", CHECKIN_FIRST_Q)
        return self._thread_dict(store.thread(t.id))

    @locked
    def get_thread(self, tid: int) -> dict:
        self._require_agent()
        t = AgentStore(self.conn).thread(tid)
        if t is None:
            raise NotFound("thread")
        msgs = []
        for m in t.messages:
            if m.role == "system":
                continue
            d = {"id": m.id, "role": m.role, "content": m.content, "created_at": iso(m.created_at)}
            if m.tool_calls:
                d["tool_calls"] = m.tool_calls
            msgs.append(d)
        return {"thread": self._thread_dict(t), "messages": msgs}

    def send_message(self, tid: int, text: str) -> Iterator[dict]:
        client = self._require_agent()  # eager: raises before any streaming starts
        with self._live():
            t = AgentStore(self.conn).thread(tid)
        if t is None:
            raise NotFound("thread")
        text = (text or "").strip()
        if not text or len(text) > 8000:
            raise InvalidInput("message must be 1-8000 characters", "text")
        return run_agent(self, client, tid, text, t.kind, t.person_id)

    @locked
    def interview_progress(self, pid: int) -> dict:
        self._require_agent()
        p = self._person(pid)
        return interview_prog(p.mode, [f.key for f in Facts(self.conn).list(pid)])

    # ------------------------------------------------------------------ settings
    @locked
    def get_settings(self) -> dict:
        st = Settings(self.conn)
        out = {}
        for k, default in SETTING_DEFAULTS.items():
            v = st.get(k)
            if v is None:
                v = default
            out[k] = {**default, **v} if isinstance(default, dict) else v
        return out

    @locked
    def update_settings(self, patch: dict) -> dict:
        patch = dict(patch or {})
        unknown = [k for k in patch if k not in SETTING_DEFAULTS]
        if unknown:
            raise InvalidInput("unknown setting", unknown[0])
        cur = self.get_settings()
        for k, v in patch.items():
            if k == "theme":
                if v not in (*THEMES, "auto"):
                    raise InvalidInput("unknown theme", k)
            elif k == "text_size":
                if v not in ("s", "m", "l"):
                    raise InvalidInput("text_size must be s, m or l", k)
            elif k in ("reduce_motion", "contrast_boost", "agent_enabled", "agent_reads_text",
                       "catchup_enabled"):
                if not isinstance(v, bool):
                    raise InvalidInput("must be true or false", k)
            elif k == "owner_timezone":
                if v is not None:
                    _tz(v, k)
            elif k == "auto_theme":
                if not isinstance(v, dict):
                    raise InvalidInput("auto_theme must be an object", k)
                m = {**cur["auto_theme"], **v}
                if set(v) - set(cur["auto_theme"]) or m["mode"] not in ("system", "time") \
                        or m["day"] not in THEMES or m["night"] not in THEMES \
                        or not _HHMM.match(str(m["day_start"])) or not _HHMM.match(str(m["day_end"])):
                    raise InvalidInput("invalid auto_theme", k)
                v = m
            patch[k] = v
        st = Settings(self.conn)
        for k, v in patch.items():
            st.set(k, v)
        return self.get_settings()

    # ------------------------------------------------------------------ extension
    @locked
    def ext_people(self) -> list[dict]:
        return [{"id": p.id, "pseudonym": p.pseudonym} for p in People(self.conn).list()]

    @locked
    def ext_link(self, person_id: int, platform: str, chat_key: str) -> None:
        self._person(person_id)
        if platform not in PLATFORMS:
            raise InvalidInput("unknown platform", "platform")
        if not chat_key or len(chat_key) > 500:
            raise InvalidInput("chat_key required", "chat_key")
        ChatLinks(self.conn).link(person_id, platform, chat_key)

    @locked
    def ext_unlink(self, platform: str, chat_key: str) -> None:
        ChatLinks(self.conn).unlink(platform, chat_key)

    @locked
    def ext_summary(self, platform: str, chat_key: str) -> dict:
        pid = ChatLinks(self.conn).person_for(platform, chat_key)
        if pid is None:
            return {"linked": False, "person": None, "total": 0, "today": 0, "last7d": 0,
                    "my_share_30d": None, "last_captured_ts": None, "last_captured_ids": []}
        from analyzer.store._base import fmt
        p, now, c = self._person(pid), datetime.now(timezone.utc), self.conn
        base = ("FROM messages m WHERE m.person_id=? AND m.role IS NOT NULL AND EXISTS"
                " (SELECT 1 FROM message_sources s WHERE s.message_id=m.id AND s.platform=?)")
        def count(extra="", *args):
            return c.execute(f"SELECT COUNT(*) {base} {extra}", (pid, platform, *args)).fetchone()[0]
        day0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
        total = count()
        n30 = count("AND m.ts>=?", fmt(now - timedelta(days=30)))
        mine30 = count("AND m.ts>=? AND m.role='me'", fmt(now - timedelta(days=30)))
        last = c.execute(f"SELECT MAX(m.ts) {base}", (pid, platform)).fetchone()[0]
        ids = [r[0] for r in c.execute(
            "SELECT s.platform_msg_id FROM message_sources s JOIN messages m ON m.id=s.message_id"
            " WHERE m.person_id=? AND s.platform=? AND s.platform_msg_id IS NOT NULL"
            " ORDER BY m.ts DESC, m.id DESC LIMIT 20", (pid, platform))]
        return {"linked": True, "person": {"id": p.id, "pseudonym": p.pseudonym}, "total": total,
                "today": count("AND m.ts>=?", fmt(day0)), "last7d": count("AND m.ts>=?", fmt(now - timedelta(days=7))),
                "my_share_30d": (mine30 / n30) if n30 else None,
                "last_captured_ts": iso(parse_ts(last)) if last else None, "last_captured_ids": ids}

    def ingest_capture(self, batch: dict) -> dict:
        platform, chat_key = batch.get("platform"), batch.get("chat_key")
        if platform not in PLATFORMS:
            raise InvalidInput("unknown platform", "platform")
        tz = _tz(batch.get("tz"), "tz")
        given_unit = batch.get("unit_id")
        if given_unit is not None and (not isinstance(given_unit, str) or not 0 < len(given_unit) <= 200):
            raise InvalidInput("unit_id must be a short string", "unit_id")
        raw_msgs = batch.get("messages")
        if not isinstance(raw_msgs, list):
            raise InvalidInput("messages must be a list", "messages")
        with self._live():
            pid = ChatLinks(self.conn).person_for(platform, chat_key or "")
            if pid is None:
                raise ChatNotLinked(platform)
            msgs: list[Message] = []
            bad = 0
            for m in raw_msgs:
                try:
                    text = m["text"]
                    if not isinstance(text, str) or not text.strip():
                        raise ValueError
                    if m.get("ts_utc"):
                        ts = _utc(m["ts_utc"])
                    else:
                        ts = to_utc(datetime.fromisoformat(m["ts_local"]), tz)
                    role = {"outgoing": "me", "incoming": "them"}[m["direction"]]
                    prec = m.get("ts_precision", "minute")
                    if prec not in ("second", "minute", "approx"):
                        raise ValueError
                    msgs.append(Message(ts, role, str(m.get("speaker_raw") or role), text, prec,
                                        m.get("platform_msg_id") and str(m["platform_msg_id"]),
                                        f"{platform}_ext"))
                except (KeyError, ValueError, TypeError, InvalidInput):
                    bad += 1
            msgs, skipped_ne = filter_english(msgs)
            self._add_skipped(pid, skipped_ne)
            added = merged = skipped = bad
            added = merged = 0
            store = MessageStore(self.conn)
            by_unit: dict[str, list[Message]] = {}
            for m in sorted(msgs, key=lambda x: x.ts):
                day = m.ts.astimezone(timezone.utc).strftime("%Y-%m-%d")
                key = given_unit or f"capture:{platform}:{chat_key}:{day}"
                by_unit.setdefault(key, []).append(m)
            for unit, ms in by_unit.items():
                for chunk in self._chunks(ms):
                    try:
                        r = store.ingest(pid, chunk, unit)
                    except ValueError as e:
                        if "another person" in str(e):
                            raise InvalidInput("unit_id belongs to another person", "unit_id") from e
                        raise
                    added, merged, skipped = added + r.added, merged + r.merged, skipped + r.skipped
            sm = SpeakerMap(self.conn)
            for src, speaker, role in {(m.source, m.speaker_raw, m.role) for m in msgs}:
                sm.set(pid, src, speaker, role)
        self._publish({"type": "ingest", "person_id": pid, "added": added, "merged": merged})
        if added or merged:
            self.schedule_reanalysis(pid)
        return {"added": added, "merged": merged, "skipped": skipped}

    @staticmethod
    def _chunks(ms: list[Message]) -> Iterator[list[Message]]:
        """Chunks of ~CAPTURE_CHUNK, cut only between minutes so occurrence indexes stay correct."""
        start = 0
        while start < len(ms):
            end = min(start + CAPTURE_CHUNK, len(ms))
            while 0 < end < len(ms) and ms[end].ts.strftime("%H%M") == ms[end - 1].ts.strftime("%H%M") \
                    and end > start + 1:
                end += 1
            yield ms[start:end]
            start = end

    # ------------------------------------------------------------------ export
    @locked
    def export(self, include_messages: bool) -> dict:
        c = self.conn
        out: dict[str, Any] = {"exported_at": iso(datetime.now(timezone.utc)), "people": [],
                               "settings": self.get_settings(), "scale_results": [], "overviews": []}
        store, agent = MessageStore(c), AgentStore(c)
        for p in People(c).list():
            entry = {"person": person_dict(p), "facts": self.list_facts(p.id),
                     "interactions": self.list_interactions(p.id),
                     "next_steps": self.list_next_steps(p.id),
                     "speakers": self.get_speakers(p.id),
                     "units": self.list_units(p.id),
                     "threads": [{"thread": self._thread_dict(t),
                                  "messages": [{"role": m.role, "content": m.content,
                                                "created_at": iso(m.created_at)}
                                               for m in agent.thread(t.id).messages]}
                                 for t in agent.threads(p.id)]}
            entry["scale_results"] = analysis.scale_snapshots(c, p.id)
            snap = self._latest_overview(p.id)
            entry["latest_overview"] = analysis.public(snap.data, []) if snap else None
            if include_messages:
                entry["messages"] = [{"ts": iso(m.ts), "role": m.role, "speaker_raw": m.speaker_raw,
                                      "text": m.text, "sources": m.sources}
                                     for m in store.messages(p.id, roles_required=False)]
            out["people"].append(entry)
        return out
