"""Chat suggestions: history-built questions (no LLM), one mini-model call for vendors without history, caching."""
import json

import httpx
import pytest

from app import config, llm, main, suggestions as sugg

NEW = {"id": "v99", "name": "Acme Analytics", "category": "BI software", "contact": "Dana (AE)",
       "list_price_usd_annual": 120000}


class FakeMini:
    """Stands in for httpx.post on the mini path: records request bodies, returns a canned completion."""

    def __init__(self, content='["What does Acme Analytics charge for extra seats?", "Who signs at Acme Analytics?", '
                               '"Does Acme Analytics discount for multi-year?", "How flexible is Acme Analytics on terms?"]',
                 fail=False):
        self.content, self.fail, self.bodies = content, fail, []

    def __call__(self, url, headers=None, json=None, timeout=None):
        self.bodies.append(json)
        if self.fail:
            raise httpx.ConnectError("down")
        content = self.content
        return httpx.Response(200, request=httpx.Request("POST", url), json={
            "choices": [{"message": {"content": content}}], "usage": {"prompt_tokens": 100, "completion_tokens": 50}})


@pytest.fixture
def new_vendor(monkeypatch):
    monkeypatch.setitem(main.VENDORS, NEW["id"], dict(NEW))
    return NEW["id"]


def _eps(vid):
    return [e for e in main.HISTORY if e["vendor_id"] == vid]


def test_all_vendors_returns_cross_vendor_defaults(api):
    r = api.get("/api/chat/suggestions").json()
    assert r == {"vendor_id": None, "questions": sugg.CROSS_VENDOR, "source": "default"}


def test_unknown_vendor_is_404(api):
    assert api.get("/api/chat/suggestions", params={"vendor_id": "nope"}).status_code == 404


@pytest.mark.parametrize("vid", [v for v in main.VENDORS if "hidden" in main.VENDORS[v]])
def test_history_questions_mention_vendor_and_only_known_tactics(api, vid):
    r = api.get("/api/chat/suggestions", params={"vendor_id": vid}).json()
    name = main.VENDORS[vid]["name"]
    assert r["source"] == "history" and len(r["questions"]) == 4 and len(set(r["questions"])) == 4
    assert all(name in q for q in r["questions"])
    tried = {e["tactic_used"] for e in _eps(vid)}
    for t, words in sugg.TACTIC_WORDS.items():
        if t not in tried:
            assert not any(words in q for q in r["questions"]), (t, r["questions"])
    assert not any("_" in q for q in r["questions"])  # plain words, never competing_quote
    lost = {e["tactic_used"] for e in _eps(vid) if e["outcome"] == "lost"}
    backfire = [q for q in r["questions"] if "backfire" in q]
    if lost:
        assert len(backfire) == 1 and any(sugg.tactic_words(t) in backfire[0] for t in lost)
    else:
        assert not backfire


def test_backfire_question_only_when_a_loss_exists():
    v = {"name": "Testco", "category": "x", "contact": "unknown"}
    won = [{"date": "2025-01-01", "tactic_used": "competing_quote", "outcome": "won", "final_discount": 0.1, "notes": ""}]
    assert not any("backfire" in q for q in sugg.from_history(v, won))
    lost = won + [{"date": "2025-03-01", "tactic_used": "escalate_to_exec", "outcome": "lost", "final_discount": 0.02,
                   "notes": ""}]
    assert "Why did escalating to their execs backfire with Testco?" in sugg.from_history(v, lost)


def test_upcoming_objective_used(api):
    up = next(u for u in main.UPCOMING if u["vendor_id"] in main.VENDORS)
    qs = api.get("/api/chat/suggestions", params={"vendor_id": up["vendor_id"]}).json()["questions"]
    v = main.VENDORS[up["vendor_id"]]
    assert f"How should we approach '{up['objective'].rstrip('.')}' with {v['name']}?" in qs


def test_new_vendor_one_mini_call_then_cached(api, new_vendor, monkeypatch):
    fake = FakeMini()
    monkeypatch.setattr(httpx, "post", fake)
    spent = llm.SPEND["usd"]
    r = api.get("/api/chat/suggestions", params={"vendor_id": new_vendor}).json()
    assert r["source"] == "llm" and len(r["questions"]) == 4 and "Acme Analytics" in r["questions"][0]
    assert len(fake.bodies) == 1 and fake.bodies[0]["model"] == config.LLM_MINI_MODEL
    assert llm.SPEND["usd"] - spent == pytest.approx((100 * llm._MINI_IN + 50 * llm._MINI_OUT) / 1e6)
    assert json.loads(main.SUGGESTIONS_CACHE.read_text())[new_vendor] == r["questions"]
    assert api.get("/api/chat/suggestions", params={"vendor_id": new_vendor}).json() == r
    assert len(fake.bodies) == 1
    # survives a restart: the in-memory cache is gone but the file answers, still no call
    main.SUGGESTIONS.clear()
    assert api.get("/api/chat/suggestions", params={"vendor_id": new_vendor}).json() == r
    assert len(fake.bodies) == 1


def test_llm_failure_gives_default(api, new_vendor, monkeypatch):
    monkeypatch.setattr(httpx, "post", FakeMini(fail=True))
    r = api.get("/api/chat/suggestions", params={"vendor_id": new_vendor}).json()
    assert r["source"] == "default" and r["questions"] == sugg.generic(main.VENDORS[new_vendor])
    assert not main.SUGGESTIONS_CACHE.exists()  # failures are never persisted


def test_unusable_llm_output_gives_default(api, new_vendor, monkeypatch):
    monkeypatch.setattr(httpx, "post", FakeMini(content="sorry"))
    assert api.get("/api/chat/suggestions", params={"vendor_id": new_vendor}).json()["source"] == "default"


def test_budget_exceeded_gives_default_without_calling(api, new_vendor, monkeypatch):
    monkeypatch.setitem(llm.SPEND, "usd", llm.BUDGET_USD)
    fake = FakeMini()
    monkeypatch.setattr(httpx, "post", fake)
    r = api.get("/api/chat/suggestions", params={"vendor_id": new_vendor})
    assert r.status_code == 200 and r.json()["source"] == "default" and fake.bodies == []


def test_logging_outcome_invalidates_cache(api, new_vendor, monkeypatch):
    monkeypatch.setattr(httpx, "post", FakeMini())
    assert api.get("/api/chat/suggestions", params={"vendor_id": new_vendor}).json()["source"] == "llm"
    monkeypatch.setattr(main.memory, "retain_episode", lambda *a, **k: None)
    r = api.post("/api/outcome", json={"vendor_id": new_vendor, "tactic_used": "competing_quote", "ask_discount": 0.2,
                                        "final_discount": 0.05, "outcome": "lost", "notes": "Refused to move."})
    assert r.status_code == 200
    assert new_vendor not in json.loads(main.SUGGESTIONS_CACHE.read_text())
    after = api.get("/api/chat/suggestions", params={"vendor_id": new_vendor}).json()
    assert after["source"] == "history"
    assert "Why did a competing quote backfire with Acme Analytics?" in after["questions"]


@pytest.mark.parametrize("text,n", [
    ('["Q one about it?", "Q two about it?"]', 2),
    ('{"questions": ["Q one about it?", "Q two about it?", "Q three about it?"]}', 3),
    ("Here you go:\n1. First question here?\n- Second question here?\n* Third question here?", 3),
    ("```json\n[\"Fenced question one?\", \"Fenced question two?\"]\n```", 2),
])
def test_parse_questions(text, n):
    assert len(sugg.parse_questions(text)) == n
