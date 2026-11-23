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

            target = self._find_match(person_id, m, platform, minute, norm, occ, touched) if m.role else None
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
        c.commit()
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
        else:  # key 2 (existing approx rows still match fuzzily)
            rows = c.execute(
                "SELECT id, ts FROM messages WHERE person_id=? AND role=? AND norm_text=?"
                " AND ((ts_precision!='approx' AND minute=? AND occ=?)"
                "   OR (ts_precision='approx' AND ts BETWEEN ? AND ?))",
                (person_id, m.role, norm, minute, occ, lo, hi)).fetchall()
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
        c = self.conn
        n = 0
        for raw, role in mapping.items():
            if role not in ("me", "them"):
                raise ValueError(f"bad role {role!r}")
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
        c.commit()
        self.recompute_dedupe(person_id)
        return n

    def recompute_dedupe(self, person_id: int) -> int:
        """Merge role-known messages that now match under key 1 / key 2 / fuzzy rules."""
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
        keepers: list[tuple] = []
        merged = 0
        for r in rows:
            mid, role, ts, minute, norm, occ, prec = r
            hit = None
            for k in keepers:
                kid = k[0]
                if k[1] != role or units[kid] & units[mid]:
                    continue  # messages sharing a unit were distinct in one batch
                if keys1.get(kid, set()) & keys1.get(mid, set()):
                    hit = k
                elif k[4] != norm:
                    continue
                elif prec == "approx" or k[6] == "approx":
                    if abs(_parse(k[2]) - _parse(ts)) <= FUZZ:
                        hit = k
                elif k[3] == minute and k[5] == occ:
                    hit = k
                if hit:
                    break
            if hit is None:
                keepers.append(r)
                continue
            kid = hit[0]
            c.execute("UPDATE message_sources SET message_id=? WHERE message_id=?", (kid, mid))
            c.execute("DELETE FROM messages WHERE id=?", (mid,))
            units[kid] |= units[mid]
            keys1.setdefault(kid, set()).update(keys1.get(mid, set()))
            merged += 1
        c.commit()
        return merged
