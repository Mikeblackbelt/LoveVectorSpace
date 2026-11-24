import asyncio
import json

from analyzer.web.events import EventBus
from analyzer.web.routes.events import event_stream

from .conftest import auth


def test_events_requires_access_jwt(h, client, alice):
    assert client.get("/api/events").status_code == 401
    tok = client.post("/api/tokens", json={"kind": "api"}, headers=auth(alice["access_token"])).json()["token"]
    assert client.get("/api/events", headers=auth(tok)).status_code == 401
    assert client.get("/api/events", params={"access_token": tok}).status_code == 401
    assert client.get("/api/events", params={"access_token": "garbage"}).status_code == 401
    # ?access_token= is only honoured on /api/events
    assert client.get("/api/people", params={"access_token": alice["access_token"]}).status_code == 401


def test_bus_filters_by_user():
    async def run():
        bus = EventBus()
        a, b = bus.subscribe("A"), bus.subscribe("B")
        bus.publish("A", {"type": "job", "person_id": 1})
        bus.publish("B", {"type": "snapshot", "person_id": 2})
        await asyncio.sleep(0)
        got_a = [a.queue.get_nowait() for _ in range(a.queue.qsize())]
        got_b = [b.queue.get_nowait() for _ in range(b.queue.qsize())]
        return got_a, got_b
    got_a, got_b = asyncio.run(run())
    assert got_a == [{"type": "job", "person_id": 1}]
    assert got_b == [{"type": "snapshot", "person_id": 2}]


class FakeRequest:
    def __init__(self):
        self.disconnected = False

    async def is_disconnected(self):
        return self.disconnected


def test_event_stream_generator_per_user_and_disconnect():
    async def run():
        bus = EventBus()
        req = FakeRequest()
        gen = event_stream(req, bus, "A", heartbeat=0.05)
        out = [await gen.__anext__()]                     # ": connected" (now subscribed)
        bus.publish("B", {"type": "job", "person_id": 9})  # other user: never delivered
        bus.publish("A", {"type": "snapshot", "person_id": 1, "user_id": "A"})
        out.append(await gen.__anext__())
        out.append(await gen.__anext__())                 # heartbeat (B's event is not there)
        req.disconnected = True
        rest = [x async for x in gen]
        return out, rest, bus.subscriber_count()
    out, rest, subs = asyncio.run(run())
    assert out[0] == ": connected\n\n"
    assert json.loads(out[1][6:]) == {"type": "snapshot", "person_id": 1}
    assert out[2] == ": ping\n\n"
    assert rest == [] and subs == 0


def test_events_route_streams_only_own_events(h, client, alice, bob):
    """End-to-end through the route: Bob's job event must not reach Alice's stream."""
    a, b = auth(alice["access_token"]), auth(bob["access_token"])
    bob_pid = client.post("/api/people", json={"pseudonym": "B", "mode": "potential"}, headers=b).json()["id"]
    alice_pid = client.post("/api/people", json={"pseudonym": "A", "mode": "potential"}, headers=a).json()["id"]
    lines = []
    with client.stream("GET", "/api/events", params={"access_token": alice["access_token"]}) as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        it = r.iter_lines()
        assert next(it) == ": connected"
        client.post(f"/api/people/{bob_pid}/analyze", headers=b)
        client.post(f"/api/people/{alice_pid}/analyze", headers=a)
        for line in it:
            if line.startswith("data: "):
                lines.append(json.loads(line[6:]))
                break
    assert lines and lines[0]["type"] == "job" and lines[0]["person_id"] == alice_pid
    assert "user_id" not in lines[0]
