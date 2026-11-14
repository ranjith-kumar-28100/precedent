"""Create a dashboard user (stored in data/precedent.db with a scrypt hash). The password is prompted, never echoed.

    uv run python scripts/create_user.py ranjith --name "Ranjith Kumar G"
"""
import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import auth  # noqa: E402

p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
p.add_argument("username")
p.add_argument("--name", help="display name shown in the app")
a = p.parse_args()
pw = getpass.getpass(f"Password for {a.username} (min {auth.MIN_PASSWORD} chars): ")
if pw != getpass.getpass("Repeat password: "):
    sys.exit("Passwords don't match.")
try:
    auth.create_user(a.username, pw, a.name)
except ValueError as e:
    sys.exit(f"Not created: {e}")
print(f"Created {a.username}. Users: {auth.user_count()}. Set AUTH_ENABLED=1 in .env and restart the API to require sign-in.")
