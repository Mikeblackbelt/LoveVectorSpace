import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from analyzer.parsers.model import Message

_ZW = re.compile("[​-‏﻿]")
_WS = re.compile(r"\s+")
_FMT = "%Y-%m-%dT%H:%M:%S.%fZ"  # fixed width, so string order == time order
_MIN_FMT = "%Y-%m-%dT%H:%M"
FUZZ = timedelta(minutes=10)


def normalize(text: str) -> str:
    t = _ZW.sub("", unicodedata.normalize("NFC", text)).lower()
    return _WS.sub(" ", t).strip()


def platform_of(source: str) -> str:
    return source.split("_")[0]


def _fmt(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).strftime(_FMT)


def _parse(s: str) -> datetime:
    return datetime.strptime(s, _FMT).replace(tzinfo=timezone.utc)


@dataclass(frozen=True)
class IngestResult:
    added: int
    merged: int
    skipped: int


@dataclass(frozen=True)
class StoredMessage:
    id: int
    person_id: int
    ts: datetime
    role: str | None
    speaker_raw: str
    text: str
    ts_precision: str
    sources: list[str]


@dataclass(frozen=True)
class Unit:
    unit_id: str
    person_id: int
    source: str
    created_at: datetime
    message_count: int
    start_ts: datetime | None
    end_ts: datetime | None


class MessageStore:
    def __init__(self, conn):
        self.conn = conn

    # ---- ingest -------------------------------------------------------
    def ingest(self, person_id: int, msgs: list[Message], unit_id: str) -> IngestResult:
        try:
            result = self._ingest(person_id, msgs, unit_id)
            self.conn.commit()
            return result
        except BaseException:
            self.conn.rollback()
            raise

    def _ingest(self, person_id: int, msgs: list[Message], unit_id: str) -> IngestResult:
        c = self.conn
        row = c.execute("SELECT person_id FROM units WHERE unit_id=?", (unit_id,)).fetchone()
        if row is not None and row[0] != person_id:
            raise ValueError("unit_id belongs to another person")
        source = msgs[0].source if msgs else "unknown"
        c.execute("INSERT OR IGNORE INTO units(unit_id, person_id, source, created_at) VALUES (?,?,?,?)",
                  (unit_id, person_id, source, _fmt(datetime.now(timezone.utc))))
        added = merged = skipped = 0
        occ_counter: dict[tuple, int] = {}
        touched: set[int] = set()  # rows created or matched in this batch; never fuzzy-matched again
        for m in msgs:
            norm = normalize(m.text)
            minute = m.ts.astimezone(timezone.utc).strftime(_MIN_FMT)
            # While the role is unknown, count occurrences per raw speaker.
            k = (m.role if m.role else ("raw", m.speaker_raw), minute, norm)
            occ = occ_counter.get(k, 0)
            occ_counter[k] = occ + 1
            platform = platform_of(m.source)

            if m.role:
                target = self._find_match(person_id, m, platform, minute, norm, occ, touched)
            else:  # unknown role: only idempotency within the same unit
                r = c.execute(
                    "SELECT m.id FROM messages m JOIN message_sources s ON s.message_id=m.id"
                    " WHERE s.unit_id=? AND m.person_id=? AND m.role IS NULL AND m.speaker_raw=?"
                    " AND m.minute=? AND m.norm_text=? AND m.occ=? LIMIT 1",
                    (unit_id, person_id, m.speaker_raw, minute, norm, occ)).fetchone()
                target = r[0] if r else None
            if target is None:
                cur = c.execute(
                    "INSERT INTO messages(person_id, ts, minute, role, speaker_raw, text, norm_text, ts_precision, occ)"
                    " VALUES (?,?,?,?,?,?,?,?,?)",
                    (person_id, _fmt(m.ts), minute, m.role, m.speaker_raw, m.text, norm, m.ts_precision, occ))
                target = cur.lastrowid
                added += 1
            else:
                touched.add(target)
                if c.execute("SELECT 1 FROM message_sources WHERE message_id=? AND unit_id=?",
                             (target, unit_id)).fetchone():
                    skipped += 1
                    continue
                merged += 1
            touched.add(target)
            c.execute("INSERT INTO message_sources(message_id, source, platform, unit_id, platform_msg_id)"
                      " VALUES (?,?,?,?,?)", (target, m.source, platform, unit_id, m.platform_msg_id))
        return IngestResult(added, merged, skipped)

    def _find_match(self, person_id, m, platform, minute, norm, occ, touched):
        c = self.conn
        if m.platform_msg_id:  # key 1
            r = c.execute(
                "SELECT s.message_id FROM message_sources s JOIN messages x ON x.id=s.message_id"
                " WHERE x.person_id=? AND s.platform=? AND s.platform_msg_id=? ORDER BY s.message_id LIMIT 1",
                (person_id, platform, m.platform_msg_id)).fetchone()
            if r:
                return r[0]
        ts = m.ts.astimezone(timezone.utc)
        lo, hi = _fmt(ts - FUZZ), _fmt(ts + FUZZ)
        if m.ts_precision == "approx":  # fuzzy
            rows = c.execute(
                "SELECT id, ts FROM messages WHERE person_id=? AND role=? AND norm_text=? AND ts BETWEEN ? AND ?",
                (person_id, m.role, norm, lo, hi)).fetchall()
        else:  # key 2, plus existing approx rows matching fuzzily
            rows = c.execute(
                "SELECT id, ts FROM messages WHERE person_id=? AND role=? AND norm_text=?"
                " AND minute=? AND occ=? AND ts_precision!='approx'",
                (person_id, m.role, norm, minute, occ)).fetchall()
            rows += c.execute(
                "SELECT id, ts FROM messages WHERE person_id=? AND role=? AND norm_text=?"
                " AND ts BETWEEN ? AND ? AND ts_precision='approx'",
                (person_id, m.role, norm, lo, hi)).fetchall()
        rows = [r for r in rows if r[0] not in touched]
        if not rows:
            return None
        return min(rows, key=lambda r: abs(_parse(r[1]) - ts))[0]

    # ---- reads --------------------------------------------------------
    def messages(self, person_id: int, roles_required: bool = True) -> list[StoredMessage]:
        q = "SELECT id, person_id, ts, role, speaker_raw, text, ts_precision FROM messages WHERE person_id=?"
        if roles_required:
            q += " AND role IS NOT NULL"
        out = []
        for r in self.conn.execute(q + " ORDER BY ts, id", (person_id,)).fetchall():
            srcs: list[str] = []
            for (s,) in self.conn.execute(
                    "SELECT source FROM message_sources WHERE message_id=? ORDER BY id", (r[0],)):
                if s not in srcs:
                    srcs.append(s)
            out.append(StoredMessage(r[0], r[1], _parse(r[2]), r[3], r[4], r[5], r[6], srcs))
        return out

    def units(self, person_id: int) -> list[Unit]:
        rows = self.conn.execute(
            "SELECT u.unit_id, u.person_id, u.source, u.created_at, COUNT(s.id), MIN(m.ts), MAX(m.ts)"
            " FROM units u LEFT JOIN message_sources s ON s.unit_id=u.unit_id"
            " LEFT JOIN messages m ON m.id=s.message_id"
            " WHERE u.person_id=? GROUP BY u.unit_id ORDER BY u.created_at, u.rowid", (person_id,)).fetchall()
        return [Unit(r[0], r[1], r[2], _parse(r[3]), r[4],
                     _parse(r[5]) if r[5] else None, _parse(r[6]) if r[6] else None) for r in rows]

    def coverage(self, person_id: int) -> list[tuple[datetime, datetime, str]]:
        return sorted(((u.start_ts, u.end_ts, u.source) for u in self.units(person_id) if u.start_ts),
                      key=lambda t: (t[0], t[2]))

    # ---- deletes ------------------------------------------------------
    def delete_unit(self, unit_id: str) -> int:
        c = self.conn
        c.execute("DELETE FROM message_sources WHERE unit_id=?", (unit_id,))
        n = c.execute("DELETE FROM messages WHERE id NOT IN (SELECT message_id FROM message_sources)").rowcount
        c.execute("DELETE FROM units WHERE unit_id=?", (unit_id,))
        c.commit()
        return n

    # ---- roles / dedupe ----------------------------------------------
    def set_roles(self, person_id: int, source: str, mapping: dict[str, str]) -> int:
        for role in mapping.values():  # validate everything before writing
            if role not in ("me", "them"):
                raise ValueError(f"bad role {role!r}")
        c = self.conn
        try:
            n = 0
            for raw, role in mapping.items():
                n += c.execute(
                    "UPDATE messages SET role=? WHERE person_id=? AND speaker_raw=? AND id IN"
                    " (SELECT message_id FROM message_sources WHERE source=?)",
                    (role, person_id, raw, source)).rowcount
            # Occurrence indexes were counted per raw speaker; recount per unit and role.
            rows = c.execute(
                "SELECT m.id, s.unit_id, m.role, m.minute, m.norm_text FROM messages m"
                " JOIN message_sources s ON s.message_id=m.id"
                " WHERE m.person_id=? AND s.source=? AND m.role IS NOT NULL"
                " AND (SELECT COUNT(*) FROM message_sources s2 WHERE s2.message_id=m.id)=1 ORDER BY m.id",
                (person_id, source)).fetchall()
            counter: dict[tuple, int] = {}
            for mid, unit, role, minute, norm in rows:
                k = (unit, role, minute, norm)
                c.execute("UPDATE messages SET occ=? WHERE id=?", (counter.get(k, 0), mid))
                counter[k] = counter.get(k, 0) + 1
            self._dedupe(person_id)
            c.commit()
            return n
        except BaseException:
            c.rollback()
            raise

    def recompute_dedupe(self, person_id: int) -> int:
        """Merge role-known messages that now match under key 1 / key 2 / fuzzy rules."""
        try:
            merged = self._dedupe(person_id)
            self.conn.commit()
            return merged
        except BaseException:
            self.conn.rollback()
            raise

    def _dedupe(self, person_id: int) -> int:
        c = self.conn
        rows = c.execute(
            "SELECT id, role, ts, minute, norm_text, occ, ts_precision FROM messages"
            " WHERE person_id=? AND role IS NOT NULL ORDER BY id", (person_id,)).fetchall()
        units: dict[int, set] = {}
        keys1: dict[int, set] = {}
        for mid, unit, plat, pmid in c.execute(
                "SELECT s.message_id, s.unit_id, s.platform, s.platform_msg_id FROM message_sources s"
                " JOIN messages m ON m.id=s.message_id WHERE m.person_id=? AND m.role IS NOT NULL",
                (person_id,)):
            units.setdefault(mid, set()).add(unit)
            if pmid:
                keys1.setdefault(mid, set()).add((plat, pmid))
        # Keepers are indexed so each message only meets plausible candidates:
        # key 1 by (platform, id); key 2 by exact key; fuzzy by (role, text) bucket.
        by_key1: dict[tuple, int] = {}
        by_key2: dict[tuple, list] = {}
        approx_bucket: dict[tuple, list] = {}  # approx keepers per (role, text)
        all_bucket: dict[tuple, list] = {}  # every keeper per (role, text); scanned only for approx rows
        info: dict[int, tuple] = {}
        merged = 0
        for r in rows:
            mid, role, ts, minute, norm, occ, prec = r
            u = units.setdefault(mid, set())
            bucket = (role, norm)
            hit = None
            for k1 in keys1.get(mid, ()):
                kid = by_key1.get(k1)
                if kid is not None and not (units[kid] & u):
                    hit = kid
                    break
            if hit is None:
                if prec == "approx":
                    cands = all_bucket.get(bucket, ())
                else:
                    cands = by_key2.get((role, norm, minute, occ), []) + approx_bucket.get(bucket, [])
                t = _parse(ts)
                for kid in cands:
                    if units[kid] & u:
                        continue  # same unit: distinct within one batch
                    kts, kprec = info[kid]
                    if prec == "approx" or kprec == "approx":
                        if abs(_parse(kts) - t) <= FUZZ:
                            hit = kid
                            break
                    else:
                        hit = kid
                        break
            if hit is None:
                info[mid] = (ts, prec)
                all_bucket.setdefault(bucket, []).append(mid)
                if prec == "approx":
                    approx_bucket.setdefault(bucket, []).append(mid)
                else:
                    by_key2.setdefault((role, norm, minute, occ), []).append(mid)
                for k1 in keys1.get(mid, ()):
                    by_key1.setdefault(k1, mid)
                continue
            c.execute("UPDATE message_sources SET message_id=? WHERE message_id=?", (hit, mid))
            c.execute("DELETE FROM messages WHERE id=?", (mid,))
            units[hit] |= u
            for k1 in keys1.get(mid, ()):
                keys1.setdefault(hit, set()).add(k1)
                by_key1.setdefault(k1, hit)
            merged += 1
        return merged
