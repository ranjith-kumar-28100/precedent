import pytest

from app import agent, chat as chat_mod, llm
from tests.conftest import ScriptedLLM, hit, tool_call

HIDDEN = ("hidden", "floor_discount", '"works"', '"fails"', "decision_maker")
BRIEF = {"summary": "Open high.", "vendor_profile": "price-firm", "decision_maker": "CCO",
         "recommended_opening_ask_pct": 18, "watch_outs": ["quarter end"],
         "tactics": [{"tactic": "competing_quote", "why": "Won before [m1]", "confidence": 0.9}]}


def test_vendors_never_leak_hidden_profile(api):
    r = api.get("/api/vendors")
    assert r.status_code == 200 and len(r.json()) > 0
    for key in HIDDEN:
        assert key not in r.text
    assert {"id", "name", "category", "episodes"} <= set(r.json()[0])


def test_upcoming(api):
    r = api.get("/api/upcoming")
    assert r.status_code == 200 and isinstance(r.json(), list) and r.json()


def test_eval_cached_replays_saved_run(api):
    r = api.get("/api/eval/cached")
    assert r.status_code == 200
    s = r.json()["series"]
    assert len(s["memory"]) == len(s["baseline"]) > 0


def test_eval_run_without_permission_uses_cache(api, monkeypatch):
    monkeypatch.delenv("ALLOW_FRESH_EVAL", raising=False)
    job = api.post("/api/eval/run", json={"fresh": True}).json()["job_id"]
    assert api.get(f"/api/eval/{job}").json()["status"] == "done"


def test_unknown_vendor_is_404(api):
    assert api.post("/api/brief", json={"vendor_id": "nope", "objective": "x"}).status_code == 404


def test_brief_memory_off_has_no_memory_tools(api, monkeypatch):
    fake = ScriptedLLM([tool_call("market_benchmarks"), tool_call("submit_brief", BRIEF, "c2")])
    monkeypatch.setattr(llm, "chat_message", fake)
    vid = api.get("/api/vendors").json()[0]["id"]
    r = api.post("/api/brief", json={"vendor_id": vid, "objective": "renew", "use_memory": False}).json()
    assert set(fake.offered[0]) == {"market_benchmarks", "submit_brief"}
    assert r["use_memory"] is False and r["citations"] == []
    assert r["brief"]["tactics"][0]["tactic"] == "competing_quote"
    assert [t["tool"] for t in r["trace"]] == ["market_benchmarks", "submit_brief"]


def test_brief_memory_on_cites_the_scoreboard(api, monkeypatch, offline):
    offline.results = [hit("won with a quote", doc="ep-1", metadata={
        "tactic": "competing_quote", "outcome": "won", "final_discount": "0.150", "ask_discount": "0.180"})]
    fake = ScriptedLLM([tool_call("tactic_scoreboard"), tool_call("submit_brief", BRIEF, "c2")])
    monkeypatch.setattr(llm, "chat_message", fake)
    vid = api.get("/api/vendors").json()[0]["id"]
    r = api.post("/api/brief", json={"vendor_id": vid, "objective": "renew"}).json()
    assert {"tactic_scoreboard", "recall_memory", "get_playbook", "reflect_on_vendor"} <= set(fake.offered[0])
    assert r["citations"][0]["id"] == "m1" and "PROVEN" in r["citations"][0]["text"]
    assert r["brief"]["decision_maker"] == "CCO"


def test_submit_rejects_unknown_tactic():
    run = agent.Run(bank_id="b", vendor={"id": "v01"})
    msg = agent.t_submit(run, **{**BRIEF, "tactics": [{"tactic": "bribery", "why": "", "confidence": 1}]})
    assert msg.startswith("Rejected") and run.brief is None


def test_submit_rejects_non_numeric_ask():
    run = agent.Run(bank_id="b", vendor={"id": "v01"})
    assert agent.t_submit(run, **{**BRIEF, "recommended_opening_ask_pct": "lots"}).startswith("Rejected")


def test_brief_falls_back_when_agent_never_submits(api, monkeypatch):
    monkeypatch.setattr(llm, "chat_message", ScriptedLLM([]))  # always answers with plain text
    vid = api.get("/api/vendors").json()[0]["id"]
    r = api.post("/api/brief", json={"vendor_id": vid, "objective": "renew", "use_memory": False}).json()
    assert r["brief"]["summary"] == "Agent did not produce a brief."


def test_system_prompt_keeps_the_ask_rule():
    assert "Never under-ask" in agent.SYSTEM and "18% off list" in agent.SYSTEM


def test_chat_memory_off_offers_no_memory_tools(api, monkeypatch):
    fake = ScriptedLLM([{"role": "assistant", "content": "General advice only."}])
    monkeypatch.setattr(llm, "chat_message", fake)
    r = api.post("/api/chat", json={"messages": [{"role": "user", "content": "what backfired?"}],
                                    "use_memory": False}).json()
    assert set(fake.offered[0]) == chat_mod.NO_MEMORY_TOOLS
    assert r["citations"] == [] and r["answer"] == "General advice only."


def test_chat_memory_on_offers_memory_tools(api, monkeypatch):
    fake = ScriptedLLM([{"role": "assistant", "content": "ok"}])
    monkeypatch.setattr(llm, "chat_message", fake)
    api.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert "search_memory" in fake.offered[0]


def test_chat_requires_user_last(api):
    r = api.post("/api/chat", json={"messages": [{"role": "assistant", "content": "hi"}]})
    assert r.status_code == 400


def test_budget_guard_blocks_before_any_request(monkeypatch):
    monkeypatch.setitem(llm.SPEND, "usd", llm.BUDGET_USD)
    with pytest.raises(llm.BudgetExceeded):
        llm.chat_message([{"role": "user", "content": "hi"}])  # httpx.post is blocked; must not be reached


def test_chat_returns_402_when_budget_spent(api, monkeypatch):
    def broke(*a, **k):
        raise llm.BudgetExceeded("budget reached")
    monkeypatch.setattr(llm, "chat_message", broke)
    r = api.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 402


def test_meter_prices_tokens():
    before = dict(llm.SPEND)
    try:
        llm.SPEND.update(usd=0.0, prompt=0, completion=0)
        llm._meter({"prompt_tokens": 1_000_000, "completion_tokens": 0})
        assert llm.SPEND["usd"] == pytest.approx(llm._PRICE_IN)
    finally:
        llm.SPEND.update(before)
