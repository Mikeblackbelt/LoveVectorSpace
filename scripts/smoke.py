"""Smoke test for a running LoveVectorSpace server (stdlib + httpx). Exits non-zero on the first failure.

  BASE_URL=https://lvs.example.app SMOKE_EMAIL=judge1@demo.lvs SMOKE_PASSWORD=... python scripts/smoke.py
  python scripts/smoke.py --base-url URL --invite CODE        # signs up a throwaway account
  python scripts/smoke.py --base-url URL --email E --password P --agent

It creates one synthetic person, runs the whole pipeline on a synthetic WhatsApp export, then deletes the person.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid

import httpx

PASSWORD = "Smoke-Test-Passw0rd-" + uuid.uuid4().hex[:8]
TZ = "America/New_York"


def synthetic_whatsapp(n_days: int = 40) -> bytes:
    """A made-up two-person chat in the WhatsApp US export format (Alex = owner, Sam = other)."""
    lines = ["3/1/26, 9:00 AM - Messages and calls are end-to-end encrypted."]
    script = [
        ("Alex", "hey, how was your day?"), ("Sam", "pretty good! I finally finished the report"),
        ("Alex", "nice, want to grab coffee this weekend?"), ("Sam", "yes, Saturday works for me"),
        ("Sam", "how about the place near the park?"), ("Alex", "perfect, see you at 11"),
    ]
    for d in range(n_days):
        month, day = (3, d + 1) if d < 31 else (4, d - 30)
        for k, (who, text) in enumerate(script):
            lines.append(f"{month}/{day}/26, {7 + k}:{10 + k * 7:02d} PM - {who}: {text}")
    return ("\n".join(lines) + "\n").encode()


class Smoke:
    def __init__(self, base: str, timeout: float = 30.0):
        self.base = base.rstrip("/")
        self.c = httpx.Client(base_url=self.base, timeout=timeout)
        self.h: dict[str, str] = {}

    @staticmethod
    def check(cond: bool, what: str) -> None:
        if not cond:
            raise AssertionError(what)
        print(f"ok   {what}")

    def req(self, method: str, path: str, expect: int, **kw) -> httpx.Response:
        kw.setdefault("headers", self.h)
        r = self.c.request(method, path, **kw)
        self.check(r.status_code == expect, f"{method} {path} -> {r.status_code} (want {expect}) {r.text[:200] if r.status_code != expect else ''}")
        return r

    def run(self, args: argparse.Namespace) -> None:
        r = self.c.get("/healthz")
        self.check(r.status_code == 200 and r.json().get("ok") is True, "GET /healthz")
        self.check(self.c.get("/api/people").status_code == 401, "GET /api/people without auth -> 401")

        if args.invite:
            email = f"smoke-{uuid.uuid4().hex[:8]}@example.com"
            r = self.c.post("/api/auth/signup", json={"email": email, "password": PASSWORD,
                                                      "invite_code": args.invite})
            self.check(r.status_code == 201, f"signup with invite -> {r.status_code} {r.text[:200]}")
        elif args.email and args.password:
            r = self.c.post("/api/auth/login", json={"email": args.email, "password": args.password})
            self.check(r.status_code == 200, f"login -> {r.status_code} {r.text[:200]}")
        else:
            raise SystemExit("need --invite, or --email and --password (or SMOKE_* env vars)")
        self.h = {"Authorization": f"Bearer {r.json()['access_token']}"}

        pid = self.req("POST", "/api/people", 201, json={"pseudonym": "Smoke Test", "mode": "potential",
                                                         "timezone": TZ}).json()["id"]
        try:
            self.pipeline(pid, args)
        finally:
            r = self.c.delete(f"/api/people/{pid}", headers=self.h)
            self.check(r.status_code == 204, f"cleanup: DELETE person -> {r.status_code}")

        self.headers_on_root()

    def pipeline(self, pid: int, args: argparse.Namespace) -> None:
        raw = synthetic_whatsapp()
        imp = self.req("POST", f"/api/people/{pid}/imports", 201, files={"file": ("chat.txt", raw)},
                       data={"tz": TZ, "me_names": ["Alex"]})
        self.check(imp.json()["added"] > 0, "import added messages")
        job = self.req("POST", f"/api/people/{pid}/analyze", 202).json()["job_id"]
        deadline = time.time() + args.job_timeout
        while True:
            j = self.c.get(f"/api/jobs/{job}", headers=self.h).json()
            if j["status"] in ("done", "error"):
                break
            self.check(time.time() < deadline, "analysis job finished in time")
            time.sleep(0.5)
        self.check(j["status"] == "done", f"analysis job done (status={j['status']}, error={j.get('error')})")
        ov = self.req("GET", f"/api/people/{pid}/overview", 200).json()
        s = ov["success"]
        self.check(bool(s.get("tag")) and "uncalibrated" in s["tag"], "overview has success.tag")
        self.check(all(k in s for k in ("percent", "low", "high")), "overview has success range keys")
        if s["status"] == "ok":
            self.check(s["low"] <= s["percent"] <= s["high"], "success percent inside its range")
        print(f"     success: {s['status']} {s['percent']} [{s['low']}, {s['high']}]")

        tok = self.req("POST", "/api/tokens", 201, json={"kind": "extension", "label": "smoke"}).json()
        eh = {"Authorization": f"Bearer {tok['token']}"}
        try:
            self.req("POST", "/api/ext/link", 204, headers=eh,
                     json={"person_id": pid, "platform": "whatsapp", "chat_key": "smoke-chat"})
            msgs = [{"platform_msg_id": f"smoke{i}", "ts_local": f"2026-11-0{i}T19:0{i}:00", "ts_precision": "minute",
                     "direction": "outgoing" if i % 2 else "incoming", "speaker_raw": "Alex" if i % 2 else "Sam",
                     "text": f"zebra-quartz-marker {i}"} for i in range(1, 6)]
            ing = self.req("POST", "/api/ingest", 200, headers=eh, json={
                "platform": "whatsapp", "chat_key": "smoke-chat", "tz": TZ, "messages": msgs})
            self.check(ing.json()["added"] == 5, "ingest added 5 messages")
            summ = self.req("GET", "/api/ext/summary", 200, headers=eh,
                            params={"platform": "whatsapp", "chat_key": "smoke-chat"})
            sj = summ.json()
            self.check(sj["linked"] and sj["total"] >= 5 and sj["person"]["id"] == pid, "ext/summary has counts")
            self.check("zebra-quartz-marker" not in summ.text, "ext/summary contains no message text")
        finally:
            self.c.delete(f"/api/tokens/{tok['info']['id']}", headers=self.h)

        if args.agent:
            self.agent(pid)

    def agent(self, pid: int) -> None:
        r = self.c.get(f"/api/people/{pid}/agent/threads", headers=self.h)
        if r.status_code == 503:
            print("skip agent: server reports agent_unavailable (no GROQ_API_KEY)")
            return
        self.check(r.status_code == 200, "agent available")
        tid = self.req("POST", f"/api/people/{pid}/agent/threads", 201, json={"kind": "chat"}).json()["id"]
        events: list[dict] = []
        with self.c.stream("POST", f"/api/agent/threads/{tid}/messages", headers=self.h, timeout=120,
                           json={"text": "List what you know about this person"}) as resp:
            self.check(resp.status_code == 200, "agent message stream opened")
            for line in resp.iter_lines():
                if line.startswith("data:"):
                    events.append(json.loads(line[5:].strip()))
                    if events[-1]["type"] in ("done", "error"):
                        break
        types = [e["type"] for e in events]
        self.check("tool_call" in types, f"agent made a tool_call (events: {types[:8]})")
        self.check(types[-1] == "done", f"agent finished with done (last: {events[-1] if events else None})")

    def headers_on_root(self) -> None:
        r = self.c.get("/")
        self.check(r.status_code == 200, "GET / serves the SPA")
        self.check("default-src" in r.headers.get("content-security-policy", ""), "CSP header on /")
        self.check(r.headers.get("x-content-type-options") == "nosniff", "X-Content-Type-Options: nosniff on /")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", default=os.environ.get("BASE_URL"))
    ap.add_argument("--email", default=os.environ.get("SMOKE_EMAIL"))
    ap.add_argument("--password", default=os.environ.get("SMOKE_PASSWORD"))
    ap.add_argument("--invite", default=os.environ.get("SMOKE_INVITE"))
    ap.add_argument("--agent", action="store_true", help="also exercise the Groq agent if the server has it")
    ap.add_argument("--job-timeout", type=float, default=120.0)
    args = ap.parse_args(argv)
    if not args.base_url:
        ap.error("BASE_URL or --base-url is required")
    try:
        Smoke(args.base_url).run(args)
    except (AssertionError, httpx.HTTPError) as e:
        print(f"FAIL {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    print("smoke test passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
