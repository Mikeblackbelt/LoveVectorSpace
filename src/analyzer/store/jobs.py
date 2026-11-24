from typing import Optional

from ._base import now_str, parse, tx
from .models import Job, JobStatus

_STATUS = ("queued", "running", "done", "error")


class Jobs:
    def __init__(self, conn):
        self.conn = conn

    def create(self, person_id: Optional[int], kind: str) -> int:
        with tx(self.conn) as c:
            return c.execute("INSERT INTO jobs(person_id, kind, status, created_at)"
                             " VALUES (?,?,'queued',?)", (person_id, kind, now_str())).lastrowid

    def update(self, job_id: int, status: JobStatus, error: Optional[str] = None) -> None:
        if status not in _STATUS:
            raise ValueError(f"bad status {status!r}")
        finished = now_str() if status in ("done", "error") else None
        with tx(self.conn) as c:
            if not c.execute("UPDATE jobs SET status=?, error=?, finished_at=? WHERE id=?",
                             (status, error, finished, job_id)).rowcount:
                raise KeyError(job_id)

    def fail_unfinished(self, error: str) -> int:
        """Mark jobs left queued/running (process died or service closed) as error."""
        with tx(self.conn) as c:
            return c.execute("UPDATE jobs SET status='error', error=?, finished_at=?"
                             " WHERE status IN ('queued','running')", (error, now_str())).rowcount

    def get(self, job_id: int) -> Optional[Job]:
        r = self.conn.execute(
            "SELECT id, person_id, kind, status, error, created_at, finished_at FROM jobs WHERE id=?",
            (job_id,)).fetchone()
        if r is None:
            return None
        return Job(id=r[0], person_id=r[1], kind=r[2], status=r[3], error=r[4],
                   created_at=parse(r[5]), finished_at=parse(r[6]) if r[6] else None)
