"""Create an invite code from the command line (operator bootstrap; also works while the server runs).

  python -m analyzer.accounts.invite_cli [--email someone@example.com] [--days 14]
  python -m analyzer.accounts.invite_cli --admin        # invite bound to ADMIN_EMAIL

Reads DATA_DIR and MASTER_KEY from the environment (the same values the server uses) and prints only the
code. `--admin` binds the invite to ADMIN_EMAIL: whoever signs up with it uses that address, and the
account becomes admin once the address is verified (the server's ADMIN_EMAIL rule). Needed only with
REGISTRATION=invite; with open registration nobody needs an invite.
"""
from __future__ import annotations

import argparse
import os
import secrets
import sys
from pathlib import Path

from .repos import AccountsDB, Invites


def create_invite(data_dir: str, master_key: str, email: str | None = None, days: int = 14) -> dict:
    db = AccountsDB(Path(data_dir) / "accounts.db", master_key)
    try:
        return Invites(db).create(secrets.token_urlsafe(9), None, email, days)
    finally:
        db.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Create an invite code (prints the code).")
    ap.add_argument("--email", help="bind the invite to this address")
    ap.add_argument("--admin", action="store_true", help="bind the invite to ADMIN_EMAIL (admin bootstrap)")
    ap.add_argument("--days", type=int, default=14, help="days until it expires (default 14)")
    a = ap.parse_args(argv)
    master_key = os.environ.get("MASTER_KEY", "")
    data_dir = os.environ.get("DATA_DIR", "data")
    if len(master_key) < 32:
        print("MASTER_KEY is not set (use the server's value)", file=sys.stderr)
        return 2
    email = a.email
    if a.admin:
        email = os.environ.get("ADMIN_EMAIL", "").strip()
        if not email:
            print("--admin needs ADMIN_EMAIL in the environment", file=sys.stderr)
            return 2
    if not 1 <= a.days <= 365:
        print("--days must be 1-365", file=sys.stderr)
        return 2
    inv = create_invite(data_dir, master_key, email, a.days)
    print(inv["code"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
