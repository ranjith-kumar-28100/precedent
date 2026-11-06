"""Offline test harness: no Azure, no Hindsight server. Every network path is replaced with a fake."""
import json
from types import SimpleNamespace

import httpx
import pytest

from app import llm, memory


def hit(text, *, type="world", doc=None, tags=(), metadata=None, date="2025-06-12", id=None):
    """One Hindsight recall result, shaped like the SDK's model objects."""
    return SimpleNamespace(id=id or f"id-{abs(hash((text, doc))) % 10**8}", text=text, type=type,
                           occurred_start=f"{date}T00:00:00+00:00" if date else None, mentioned_at=None,
                           metadata=metadata, document_id=doc, tags=list(tags), source_fact_ids=[])


class FakeHindsight:
    """Stands in for hindsight_client.Hindsight. recall() returns whatever `results` holds."""

    def __init__(self):
        self.results = []
        self.calls = []

    def recall(self, **kw):
        self.calls.append(("recall", kw))
        return SimpleNamespace(results=list(self.results))

    def get_mental_model(self, **kw):
        self.calls.append(("get_mental_model", kw))
        return SimpleNamespace(content="Playbook: competing quotes work; escalation backfires.")

    def reflect(self, **kw):
        raise AssertionError("reflect calls the LLM; tests must not reach it")

    def retain(self, **kw):
        raise AssertionError("retain calls the LLM; tests must not reach it")

    def get_version(self):
        return SimpleNamespace(version="fake")


class ScriptedLLM:
    """Replaces llm.chat_message: returns queued assistant messages and records the tools offered."""

    def __init__(self, script):
        self.script = list(script)
        self.offered = []

    def __call__(self, messages, tools=None, **_):
        self.offered.append([t["function"]["name"] for t in tools or []])
        if not self.script:
            return {"role": "assistant", "content": "done"}
        return self.script.pop(0)


def tool_call(name, args=None, cid="c1"):
    return {"role": "assistant", "content": "", "tool_calls": [
        {"id": cid, "type": "function", "function": {"name": name, "arguments": json.dumps(args or {})}}]}


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    """Block real HTTP and swap the Hindsight client for every test."""
    def no_network(*a, **k):
        raise AssertionError("network call attempted in an offline test")
    monkeypatch.setattr(httpx, "post", no_network)
    monkeypatch.setattr(httpx, "get", no_network)
    fake = FakeHindsight()
    monkeypatch.setattr(memory, "client", lambda: fake)
    monkeypatch.setitem(llm.SPEND, "usd", 0.0)
    return fake


@pytest.fixture
def api():
    from fastapi.testclient import TestClient
    from app import main
    return TestClient(main.app)
