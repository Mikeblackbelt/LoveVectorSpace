"""Restore a user's quarantined database (admin tool; run while the server is STOPPED).

When an unverified account is claimed by the real address owner (password reset or first Google/Apple
sign-in), the previous data is set aside for 30 days instead of being deleted. This puts the most recent
quarantined copy back for <user_id>; the database currently in place is itself quarantined first.

    python scripts/restore_quarantine.py <user_id>

Reads MASTER_KEY and DATA_DIR from the environment (or .env), like the server.
"""
from __future__ import annotations

import sys
from pathlib import Path


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    from analyzer.accounts.quarantine import restore
    from analyzer.accounts.repos import AccountsDB
    from analyzer.web.settings import AppSettings

    settings = AppSettings()
    data_dir = Path(settings.data_dir)
    db = AccountsDB(data_dir / "accounts.db", settings.master_key)
    try:
        path = restore(db, data_dir, argv[1])
    except LookupError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    finally:
        db.close()
    print(f"restored {argv[1]} -> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
