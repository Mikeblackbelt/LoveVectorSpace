"""Print a new invite code. Wrapper around `python -m analyzer.accounts.invite_cli` (see that module).

  DATA_DIR=... MASTER_KEY=... python scripts/create_invite.py [--admin] [--email E] [--days N]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from analyzer.accounts.invite_cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
