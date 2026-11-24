import subprocess
import sys
from pathlib import Path

from analyzer.accounts.invite_cli import main

from .conftest import PASSWORD, Harness

ROOT = Path(__file__).resolve().parents[2]


def test_create_invite_admin_bootstrap(tmp_path, monkeypatch, capsys):
    h = Harness(tmp_path, registration="invite")
    monkeypatch.setenv("DATA_DIR", h.settings.data_dir)
    monkeypatch.setenv("MASTER_KEY", h.settings.master_key)
    monkeypatch.setenv("ADMIN_EMAIL", "admin@example.com")
    assert main(["--admin"]) == 0                     # while the server holds accounts.db open
    code = capsys.readouterr().out.strip()
    inv = h.accounts.invites.get(code)
    assert inv and inv["email"] == "admin@example.com"
    with h.client() as c:
        bad = c.post("/api/auth/signup", json={"email": "other@example.com", "password": PASSWORD,
                                                "invite_code": code})
        assert bad.status_code == 403                 # bound to ADMIN_EMAIL
        r = c.post("/api/auth/signup", json={"email": "admin@example.com", "password": PASSWORD,
                                              "invite_code": code}, headers={"X-Client": "native"})
        assert r.status_code == 201
        c.post("/api/auth/verify-email", json={"token": h.mailer.token_for("admin@example.com", "verify")})
        assert h.accounts.users.by_email("admin@example.com").role == "admin"


def test_create_invite_script_and_errors(tmp_path, monkeypatch):
    h = Harness(tmp_path)
    h.accounts.close()
    env = {"DATA_DIR": h.settings.data_dir, "MASTER_KEY": h.settings.master_key, "PATH": ""}
    import os
    env["SYSTEMROOT"] = os.environ.get("SYSTEMROOT", "")
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "create_invite.py"), "--email", "x@example.com"],
                       env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    assert len(r.stdout.strip()) >= 10
    monkeypatch.delenv("MASTER_KEY", raising=False)
    assert main([]) == 2
    monkeypatch.setenv("MASTER_KEY", h.settings.master_key)
    monkeypatch.delenv("ADMIN_EMAIL", raising=False)
    assert main(["--admin"]) == 2
