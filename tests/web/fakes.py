"""A fake ServiceFactory whose data lives in each user's own (SQLCipher) connection."""
from __future__ import annotations

import json
from typing import Any

from analyzer.service.facade import AgentUnavailable, ChatNotLinked, InvalidInput, NotFound

TS = "2026-11-23T12:00:00Z"

_DDL = """
CREATE TABLE IF NOT EXISTS fake_people(id INTEGER PRIMARY KEY, pseudonym TEXT, mode TEXT, timezone TEXT,
    analyzed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS fake_units(unit_id TEXT PRIMARY KEY, person_id INTEGER, n INTEGER);
CREATE TABLE IF NOT EXISTS fake_facts(id INTEGER PRIMARY KEY, person_id INTEGER, key TEXT, value TEXT, confidence TEXT);
CREATE TABLE IF NOT EXISTS fake_interactions(id INTEGER PRIMARY KEY, person_id INTEGER, fields TEXT, notes TEXT);
CREATE TABLE IF NOT EXISTS fake_steps(id INTEGER PRIMARY KEY, person_id INTEGER, status TEXT);
CREATE TABLE IF NOT EXISTS fake_threads(id INTEGER PRIMARY KEY, person_id INTEGER, kind TEXT);
CREATE TABLE IF NOT EXISTS fake_jobs(id INTEGER PRIMARY KEY, person_id INTEGER);
CREATE TABLE IF NOT EXISTS fake_links(platform TEXT, chat_key TEXT, person_id INTEGER, PRIMARY KEY(platform, chat_key));
CREATE TABLE IF NOT EXISTS fake_kv(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS fake_q(person_id INTEGER, scale_id TEXT, answers TEXT);
"""

DEFAULT_SETTINGS = {"theme": "signal", "auto_theme": {"mode": "system", "day": "signal", "night": "crt",
                    "day_start": "07:00", "day_end": "19:00"}, "reduce_motion": False, "contrast_boost": False,
                    "text_size": "m", "owner_timezone": None, "agent_enabled": True, "agent_reads_text": True,
                    "catchup_enabled": True}


class FakeUserService:
    def __init__(self, user_id: str, conn, events, factory: "FakeFactory"):
        self.user_id, self.c, self.events, self.factory = user_id, conn, events, factory
        self.c.executescript(_DDL)
        self.closed = False

    def close(self, timeout=10.0):
        self.closed = True

    # helpers
    def _one(self, sql, args=()):
        return self.c.execute(sql, args).fetchone()

    def _x(self, sql, args=()):
        cur = self.c.execute(sql, args)
        self.c.commit()
        return cur.lastrowid

    def _person_row(self, pid):
        r = self._one("SELECT id, pseudonym, mode, timezone FROM fake_people WHERE id=?", (pid,))
        if r is None:
            raise NotFound(f"person {pid}")
        return r

    # people
    def list_people(self):
        rows = self.c.execute("SELECT id, pseudonym, mode FROM fake_people ORDER BY id").fetchall()
        return [{"id": r[0], "pseudonym": r[1], "mode": r[2], "sources": [],
                 "success": {"percent": None, "low": None, "high": None, "status": "insufficient_data"},
                 "safety": "none", "updated_at": None} for r in rows]

    def create_person(self, pseudonym, mode, timezone):
        pid = self._x("INSERT INTO fake_people(pseudonym, mode, timezone) VALUES (?,?,?)", (pseudonym, mode, timezone))
        return self.get_person(pid)

    def load_sample(self):
        return self.create_person("Sample: Yu Cheng", "potential", "America/New_York")

    def get_person(self, pid):
        r = self._person_row(pid)
        return {"id": r[0], "pseudonym": r[1], "mode": r[2], "timezone": r[3], "created_at": TS}

    def update_person(self, pid, **fields):
        self._person_row(pid)
        for k, v in fields.items():
            if k not in ("pseudonym", "mode", "timezone"):
                raise InvalidInput("bad field", k)
            self._x(f"UPDATE fake_people SET {k}=? WHERE id=?", (v, pid))
        return self.get_person(pid)

    def delete_person(self, pid):
        self._person_row(pid)
        self._x("DELETE FROM fake_people WHERE id=?", (pid,))

    def preview_import(self, filename, raw):
        if not raw:
            raise InvalidInput("empty file", "file")
        return {"format": "plaintext", "speakers": ["Me", "Sam"], "lines": raw.count(b"\n"), "one_sided": False}

    def import_file(self, pid, filename, raw, tz, me_names, match_id=None):
        self._person_row(pid)
        dating = filename.endswith(".json")
        if dating and not match_id:
            raise InvalidInput("choose a match", "match_id")
        if not me_names and not dating:
            raise InvalidInput("say which name is you", "me_names")
        self.factory.imports.append({"filename": filename, "me_names": me_names, "match_id": match_id})
        uid = f"upload:{pid}:{len(raw)}"
        self._x("INSERT OR REPLACE INTO fake_units(unit_id, person_id, n) VALUES (?,?,?)", (uid, pid, raw.count(b"\n")))
        return {"unit_id": uid, "added": raw.count(b"\n"), "merged": 0, "skipped_non_english": 0, "one_sided": False,
                "job_id": self._x("INSERT INTO fake_jobs(person_id) VALUES (?)", (pid,))}

    def import_messages(self, pid, source, tz, messages):
        self._person_row(pid)
        if source not in ("screenshot_import", "android_sms") and not source.startswith("android_"):
            raise InvalidInput("unknown source", "source")
        self.factory.imports.append({"source": source, "messages": messages})
        return {"unit_id": f"{source}:{pid}", "added": len(messages), "merged": 0, "skipped_non_english": 0,
                "one_sided": False, "job_id": self._x("INSERT INTO fake_jobs(person_id) VALUES (?)", (pid,))}

    def list_units(self, pid):
        self._person_row(pid)
        return [{"unit_id": r[0], "source": "plaintext", "created_at": TS, "message_count": r[1], "start_ts": None,
                 "end_ts": None} for r in self.c.execute("SELECT unit_id, n FROM fake_units WHERE person_id=?", (pid,))]

    def delete_unit(self, unit_id):
        r = self._one("SELECT n FROM fake_units WHERE unit_id=?", (unit_id,))
        if r is None:
            raise NotFound("unit")
        self._x("DELETE FROM fake_units WHERE unit_id=?", (unit_id,))
        return {"removed_messages": r[0]}

    def get_speakers(self, pid):
        self._person_row(pid)
        return json.loads((self._one("SELECT v FROM fake_kv WHERE k=?", (f"speakers:{pid}",)) or ["[]"])[0])

    def set_speakers(self, pid, mappings):
        self._person_row(pid)
        self._x("INSERT OR REPLACE INTO fake_kv(k, v) VALUES (?,?)", (f"speakers:{pid}", json.dumps(mappings)))
        return mappings

    def coverage(self, pid):
        self._person_row(pid)
        return []

    # analysis
    def overview(self, pid):
        r = self._person_row(pid)
        if not self._one("SELECT analyzed FROM fake_people WHERE id=?", (pid,))[0]:
            raise NotFound("no snapshot yet")
        return {"person": self.get_person(pid), "mode": r[2], "generated_at": TS, "metrics": [],
                "safety": {"flags": [], "resources": [], "disclaimer": "x"}}

    def start_analysis(self, pid):
        self._person_row(pid)
        self._x("UPDATE fake_people SET analyzed=1 WHERE id=?", (pid,))
        jid = self._x("INSERT INTO fake_jobs(person_id) VALUES (?)", (pid,))
        self.events.publish(self.user_id, {"type": "job", "person_id": pid, "job_id": jid, "status": "done"})
        return jid

    def job(self, job_id):
        if self._one("SELECT id FROM fake_jobs WHERE id=?", (job_id,)) is None:
            raise NotFound("job")
        return {"id": job_id, "kind": "analyze", "status": "done", "error": None, "created_at": TS, "finished_at": TS}

    def history(self, pid, metric_id):
        self._person_row(pid)
        return [{"ts": TS, "value": 0.5}]

    def explain_metric(self, metric_id):
        if metric_id != "lsm":
            raise NotFound("metric")
        return {"id": "lsm", "measures": "style matching", "evidence": "moderate", "caveats": "", "citation": "x"}

    # questionnaires
    def list_scales(self):
        return [{"id": "csi16"}]

    def submit_questionnaire(self, pid, scale_id, answers):
        self._person_row(pid)
        if scale_id != "csi16":
            raise NotFound("scale")
        if not answers:
            raise InvalidInput("no answers")
        self._x("INSERT INTO fake_q VALUES (?,?,?)", (pid, scale_id, json.dumps(answers)))
        return {"scale_id": scale_id, "status": "ok"}

    def questionnaire_history(self, pid):
        self._person_row(pid)
        return [{"scale_id": r[0], "submitted_at": TS, "result": {}} for r in
                self.c.execute("SELECT scale_id FROM fake_q WHERE person_id=?", (pid,))]

    # context
    def _fact(self, fid):
        r = self._one("SELECT id, person_id, key, value, confidence FROM fake_facts WHERE id=?", (fid,))
        if r is None:
            raise NotFound("fact")
        return {"id": r[0], "person_id": r[1], "key": r[2], "value": r[3], "confidence": r[4], "created_at": TS}

    def list_facts(self, pid):
        self._person_row(pid)
        return [self._fact(r[0]) for r in self.c.execute("SELECT id FROM fake_facts WHERE person_id=?", (pid,))]

    def add_fact(self, pid, key, value, confidence):
        self._person_row(pid)
        return self._fact(self._x("INSERT INTO fake_facts(person_id, key, value, confidence) VALUES (?,?,?,?)",
                                  (pid, key, value, confidence)))

    def update_fact(self, fact_id, **fields):
        self._fact(fact_id)
        for k, v in fields.items():
            self._x(f"UPDATE fake_facts SET {k}=? WHERE id=?", (v, fact_id))
        return self._fact(fact_id)

    def delete_fact(self, fact_id):
        self._fact(fact_id)
        self._x("DELETE FROM fake_facts WHERE id=?", (fact_id,))

    def _inter(self, iid):
        r = self._one("SELECT id, person_id, fields, notes FROM fake_interactions WHERE id=?", (iid,))
        if r is None:
            raise NotFound("interaction")
        return {"id": r[0], "person_id": r[1], "fields": json.loads(r[2]), "notes": r[3], "created_at": TS}

    def list_interactions(self, pid):
        self._person_row(pid)
        return [self._inter(r[0]) for r in self.c.execute("SELECT id FROM fake_interactions WHERE person_id=?", (pid,))]

    def add_interaction(self, pid, fields, notes):
        self._person_row(pid)
        if "ts" not in fields:
            raise InvalidInput("ts is required", "fields.ts")
        return self._inter(self._x("INSERT INTO fake_interactions(person_id, fields, notes) VALUES (?,?,?)",
                                   (pid, json.dumps(fields), notes)))

    def update_interaction(self, interaction_id, **fields):
        cur = self._inter(interaction_id)
        if "notes" in fields:
            self._x("UPDATE fake_interactions SET notes=? WHERE id=?", (fields["notes"], interaction_id))
        if "fields" in fields:
            self._x("UPDATE fake_interactions SET fields=? WHERE id=?",
                    (json.dumps({**cur["fields"], **fields["fields"]}), interaction_id))
        return self._inter(interaction_id)

    def delete_interaction(self, interaction_id):
        self._inter(interaction_id)
        self._x("DELETE FROM fake_interactions WHERE id=?", (interaction_id,))

    # next steps
    def _step(self, sid):
        r = self._one("SELECT id, status FROM fake_steps WHERE id=?", (sid,))
        if r is None:
            raise NotFound("step")
        return {"id": r[0], "kind": "talk", "title": "t", "why": "w", "evidence_refs": [], "status": r[1],
                "created_at": TS}

    def list_next_steps(self, pid, status=None):
        self._person_row(pid)
        rows = self.c.execute("SELECT id FROM fake_steps WHERE person_id=? AND (? IS NULL OR status=?)",
                              (pid, status, status)).fetchall()
        return [self._step(r[0]) for r in rows]

    def generate_next_steps(self, pid):
        self._person_row(pid)
        self._x("INSERT INTO fake_steps(person_id, status) VALUES (?, 'open')", (pid,))
        self.events.publish(self.user_id, {"type": "next_steps", "person_id": pid})
        return self._x("INSERT INTO fake_jobs(person_id) VALUES (?)", (pid,))

    def set_next_step_status(self, step_id, status):
        self._step(step_id)
        self._x("UPDATE fake_steps SET status=? WHERE id=?", (status, step_id))
        return self._step(step_id)

    # agent
    def _agent(self):
        if not self.factory.agent_enabled:
            raise AgentUnavailable()

    def list_threads(self, pid):
        self._agent()
        self._person_row(pid)
        return [{"id": r[0], "kind": r[1], "title": "t", "created_at": TS, "updated_at": TS} for r in
                self.c.execute("SELECT id, kind FROM fake_threads WHERE person_id=?", (pid,))]

    def create_thread(self, pid, kind):
        self._agent()
        self._person_row(pid)
        tid = self._x("INSERT INTO fake_threads(person_id, kind) VALUES (?,?)", (pid, kind))
        return {"id": tid, "kind": kind, "title": "t", "created_at": TS, "updated_at": TS}

    def get_thread(self, tid):
        self._agent()
        r = self._one("SELECT id, kind FROM fake_threads WHERE id=?", (tid,))
        if r is None:
            raise NotFound("thread")
        return {"thread": {"id": r[0], "kind": r[1]}, "messages": []}

    def send_message(self, tid, text):
        self._agent()
        if self._one("SELECT id FROM fake_threads WHERE id=?", (tid,)) is None:
            raise NotFound("thread")
        yield {"type": "token", "text": "Hel"}
        yield {"type": "tool_call", "name": "get_person_overview", "args": {"person_id": 1}}
        if self.factory.fail_mid_stream:
            raise RuntimeError("boom")
        yield {"type": "token", "text": "lo"}
        yield {"type": "done", "message_id": 7}

    def interview_progress(self, pid):
        self._agent()
        self._person_row(pid)
        return {"covered": [], "open": ["values"], "topics": [{"id": "values", "label": "Values"}]}

    # settings
    def get_settings(self):
        r = self._one("SELECT v FROM fake_kv WHERE k='settings'")
        return json.loads(r[0]) if r else dict(DEFAULT_SETTINGS)

    def update_settings(self, patch):
        if "theme" in patch and patch["theme"] not in ("signal", "pulse", "riso", "blueprint", "journal", "matcha",
                                                       "midnight", "inkwell", "crt", "auto"):
            raise InvalidInput("unknown theme", "theme")
        s = {**self.get_settings(), **patch}
        self._x("INSERT OR REPLACE INTO fake_kv(k, v) VALUES ('settings', ?)", (json.dumps(s),))
        return s

    # extension
    def ext_people(self):
        return [{"id": r[0], "pseudonym": r[1]} for r in self.c.execute("SELECT id, pseudonym FROM fake_people")]

    def ext_link(self, person_id, platform, chat_key):
        self._person_row(person_id)
        self._x("INSERT OR REPLACE INTO fake_links VALUES (?,?,?)", (platform, chat_key, person_id))

    def ext_unlink(self, platform, chat_key):
        self._x("DELETE FROM fake_links WHERE platform=? AND chat_key=?", (platform, chat_key))

    def ext_summary(self, platform, chat_key):
        r = self._one("SELECT person_id FROM fake_links WHERE platform=? AND chat_key=?", (platform, chat_key))
        person = None
        if r:
            p = self.get_person(r[0])
            person = {"id": p["id"], "pseudonym": p["pseudonym"]}
        return {"linked": r is not None, "person": person, "total": 0, "today": 0, "last7d": 0, "my_share_30d": None,
                "last_captured_ts": None, "last_captured_ids": []}

    def ingest_capture(self, batch):
        r = self._one("SELECT person_id FROM fake_links WHERE platform=? AND chat_key=?",
                      (batch["platform"], batch["chat_key"]))
        if r is None:
            raise ChatNotLinked()
        self.factory.ingested.append((self.user_id, batch))
        self.events.publish(self.user_id, {"type": "ingest", "person_id": r[0], "added": len(batch["messages"])})
        return {"added": len(batch["messages"]), "merged": 0, "skipped": 0}

    def export(self, include_messages):
        return {"people": self.list_people(), "facts": [self._fact(r[0]) for r in
                self.c.execute("SELECT id FROM fake_facts")], "messages": [] if include_messages else None}


class FakeFactory:
    def __init__(self):
        self.agent_enabled = True
        self.fail_mid_stream = False
        self.ingested: list = []
        self.imports: list = []
        self.services: list[FakeUserService] = []
        self.seeded: list[str] = []
        self.seed_calls: list[str] = []
        self.seed_gate = None   # threading.Event: seed_demo blocks until it is set (slow-seeder tests)

    def for_user(self, user_id: str, conn: Any, events: Any) -> FakeUserService:
        s = FakeUserService(user_id, conn, events, self)
        self.services.append(s)
        return s

    def seed_demo(self, user_id: str, conn: Any) -> None:
        """Idempotent like the real one: `seeded` records only calls that actually added data."""
        if self.seed_gate is not None:
            assert self.seed_gate.wait(10), "test never released the seeder"
        svc = FakeUserService(user_id, conn, None, self)
        self.seed_calls.append(user_id)
        if not svc.list_people():
            svc.create_person("Yu Cheng", "potential", None)
            self.seeded.append(user_id)
