from ._base import tx

_CHUNK = 500


class Scores:
    """Per-message score cache, keyed by (message_id, model)."""

    def __init__(self, conn):
        self.conn = conn

    def get(self, message_ids: list[int], model: str) -> dict[int, float]:
        out: dict[int, float] = {}
        ids = list(message_ids)
        for i in range(0, len(ids), _CHUNK):
            part = ids[i:i + _CHUNK]
            q = ",".join("?" * len(part))
            for mid, score in self.conn.execute(
                    f"SELECT message_id, score FROM message_scores WHERE model=? AND message_id IN ({q})",
                    [model, *part]):
                out[mid] = score
        return out

    def put(self, model: str, mapping: dict[int, float]) -> None:
        with tx(self.conn) as c:
            c.executemany(
                "INSERT INTO message_scores(message_id, model, score) VALUES (?,?,?)"
                " ON CONFLICT(message_id, model) DO UPDATE SET score=excluded.score",
                [(mid, model, float(s)) for mid, s in mapping.items()])
