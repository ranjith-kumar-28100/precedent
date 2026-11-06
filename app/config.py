"""All runtime configuration comes from .env (see .env.example)."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


LLM_MODEL = env("LLM_MODEL")
LLM_BASE_URL = env("LLM_BASE_URL")
LLM_API_KEY = env("LLM_API_KEY")

HINDSIGHT_URL = env("HINDSIGHT_URL", "http://localhost:8888")
BANK_ID = env("HINDSIGHT_BANK_ID", "precedent-procurement")

DATA_DIR = ROOT / "data"
WEB_DIR = ROOT / "web"
