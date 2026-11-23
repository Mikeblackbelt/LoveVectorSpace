import json

from ._base import tx

_CHUNK = 500


class Scores:
    """Per-message score-vector cache, keyed by (message_id, model)."""

    def __init__(self, conn):
        self.conn = conn

    def get(self, message_ids: list[int], model: str) -> dict[int, list[float]]:
        out: dict[int, list[float]] = {}
        ids = list(message_ids)
        for i in range(0, len(ids), _CHUNK):
            part = ids[i:i + _CHUNK]
            q = ",".join("?" * len(part))
            for mid, score in self.conn.execute(
                    f"SELECT message_id, scores_json FROM message_scores WHERE model=? AND message_id IN ({q})",
                    [model, *part]):
                out[mid] = json.loads(score)
        return out

    def put(self, model: str, mapping: dict[int, list[float]]) -> None:
        with tx(self.conn) as c:
            c.executemany(
                "INSERT INTO message_scores(message_id, model, scores_json) VALUES (?,?,?)"
                " ON CONFLICT(message_id, model) DO UPDATE SET scores_json=excluded.scores_json",
                [(mid, model, json.dumps([float(x) for x in v])) for mid, v in mapping.items()])
