"""Runs scripts/smoke.py against an in-process uvicorn (tmp DATA_DIR, SEED_DEMO=1, no Groq): validates the deploy
smoke test without Docker."""
import importlib.util
import socket
import threading
import time
from pathlib import Path

import httpx
import pytest
import uvicorn

ROOT = Path(__file__).resolve().parents[2]
DEMO_PW = "demo-password-for-judges"


def _load_smoke():
    spec = importlib.util.spec_from_file_location("smoke", ROOT / "scripts" / "smoke.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def server(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>lvs</title>")
    env = {"MASTER_KEY": "m" * 48, "JWT_SECRET": "j" * 48, "DATA_DIR": str(tmp_path / "data"),
           "FRONTEND_DIST": str(dist), "APP_ORIGIN": "http://127.0.0.1", "COOKIE_SECURE": "0",
           "MAIL_DEV_ALLOW": "1", "SEED_DEMO": "1", "DEMO_PASSWORD": DEMO_PW,
           "MODELS_DIR": str(tmp_path / "no-models")}
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.chdir(tmp_path)          # no stray .env
    from analyzer.web.main import build_app
    app = build_app()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    base = f"http://127.0.0.1:{port}"
    for _ in range(600):                 # up, and the background demo seeding finished
        try:
            r = httpx.get(base + "/healthz")
            if r.status_code == 200 and r.json().get("seeding") is False:
                break
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    yield base
    srv.should_exit = True
    t.join(10)


def test_smoke_as_demo_judge(server, capsys):
    smoke = _load_smoke()
    rc = smoke.main(["--base-url", server, "--email", "judge1@demo.lvs", "--password", DEMO_PW, "--agent"])
    out = capsys.readouterr()
    assert rc == 0, out.out + out.err
    assert "skip agent" in out.out            # no Groq key in the test
    tok = httpx.post(server + "/api/auth/login", json={"email": "judge1@demo.lvs", "password": DEMO_PW}).json()
    r = httpx.get(server + "/api/people", headers={"Authorization": f"Bearer {tok['access_token']}"})
    assert "Smoke Test" not in {p["pseudonym"] for p in r.json()}      # cleaned up


def test_smoke_signup_open_registration_cleans_up(server, capsys):
    smoke = _load_smoke()
    rc = smoke.main(["--base-url", server, "--signup"])
    out = capsys.readouterr()
    assert rc == 0, out.out + out.err
    assert "throwaway account deleted" not in out.err


def test_smoke_fails_on_dead_server():
    smoke = _load_smoke()
    assert smoke.main(["--base-url", "http://127.0.0.1:9", "--email", "a", "--password", "b"]) == 1
