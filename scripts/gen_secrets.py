"""Print fresh secrets for the server's environment. Output goes to stdout only; nothing is written to disk.

  python scripts/gen_secrets.py
"""
import base64
import secrets


def main() -> None:
    print(f"MASTER_KEY={base64.b64encode(secrets.token_bytes(48)).decode()}")
    print(f"JWT_SECRET={base64.b64encode(secrets.token_bytes(48)).decode()}")
    print(f"DEMO_PASSWORD={secrets.token_urlsafe(18)}")


if __name__ == "__main__":
    main()
