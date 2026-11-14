from datetime import date, timedelta

import pytest

from app import agent, llm, memory
from tests.conftest import ScriptedLLM, tool_call
from tests.test_api import BRIEF

TODAY = date(2026, 11, 14)


def _run(decision_maker, citations=(), checks=None):
    run = agent.Run(bank_id="b", vendor={"id": "v05", "name": "Kestrel Alloys Ltd"})
    run.citations = list(citations)
    agent.t_submit(run, **{**BRIEF, "decision_maker": decision_maker,
                           **({"needs_verification": checks} if checks else {})})
    return run


def test_net_flags_uncited_decision_maker():
    run = _run("CCO Priscilla Hartmann")
    agent.verification_net(run, today=TODAY)
    [item] = run.brief["needs_verification"]
    assert item["claim"] == "Decision maker: CCO Priscilla Hartmann"
    assert "No cited memory" in item["reason"] and item["last_evidence_date"] is None
    assert "Kestrel Alloys Ltd" in item["ask"]


def test_net_flags_stale_evidence_with_its_date():
    run = _run("CCO [m1]", [{"id": "m1", "text": "Priscilla signed", "kind": "world", "date": "2026-02-19T00:00:00+00:00"}])
    agent.verification_net(run, today=TODAY)
    [item] = run.brief["needs_verification"]
    assert item["last_evidence_date"] == "2026-02-19" and "90 days" in item["reason"]
    assert item["claim"] == "Decision maker: CCO"  # citation ids stripped from the claim


def test_net_trusts_recent_cited_evidence():
    recent = (TODAY - timedelta(days=10)).isoformat()
    run = _run("CCO [m1]", [{"id": "m1", "text": "Priscilla signed", "kind": "world", "date": recent}])
    agent.verification_net(run, today=TODAY)
    assert run.brief["needs_verification"] == []


def test_net_does_not_duplicate_a_model_flag():
    run = _run("CCO", checks=[{"claim": "Who approves discounts", "reason": "old", "ask": "Who signs?"}])
    agent.verification_net(run, today=TODAY)
    assert len(run.brief["needs_verification"]) == 1


def test_net_tolerates_odd_dates():
    run = _run("CCO [m1]", [{"id": "m1", "text": "x", "kind": "world", "date": "sometime in spring"}])
    agent.verification_net(run, today=TODAY)
    assert "undated" in run.brief["needs_verification"][0]["reason"]


def test_brief_endpoint_returns_needs_verification(api, monkeypatch):
    monkeypatch.setattr(llm, "chat_message", ScriptedLLM([tool_call("submit_brief", BRIEF)]))
    vid = api.get("/api/vendors").json()[0]["id"]
    r = api.post("/api/brief", json={"vendor_id": vid, "objective": "renew", "use_memory": False}).json()
    assert r["brief"]["needs_verification"][0]["claim"].startswith("Decision maker")


def test_system_prompt_has_verify_rule():
    assert "needs_verification" in agent.SYSTEM and "90 days" in agent.SYSTEM


def test_confirm_retains_a_verified_fact(api, offline, monkeypatch):
    calls = []
    monkeypatch.setattr(offline, "retain", lambda **kw: calls.append(kw), raising=False)
    body = {"vendor_id": "v05", "claim": "Who approves discounts above 12%",
            "answer": "Marcus Lindqvist, CFO, from January 2027", "date": "2026-11-14"}
    r = api.post("/api/verify/confirm", json=body)
    assert r.status_code == 200 and r.json() == {"retained": True}
    [kw] = calls
    assert "category:verified" in kw["tags"] and "vendor:v05" in kw["tags"]
    assert kw["timestamp"] == "2026-11-14" and kw["metadata"]["kind"] == "verified"
    assert kw["document_id"] == "verified-v05-2026-11-14-who-approves-discounts-above-12"
    assert "Kestrel Alloys Ltd confirmed Who approves discounts above 12%: Marcus Lindqvist" in kw["content"]
    assert "(source: vendor email)" in kw["content"]


def test_confirm_unknown_vendor_is_404(api):
    assert api.post("/api/verify/confirm", json={"vendor_id": "nope", "claim": "x", "answer": "y"}).status_code == 404


def test_confirm_reports_memory_failure(api):
    # the offline fake's retain raises, as a down Hindsight would
    r = api.post("/api/verify/confirm", json={"vendor_id": "v05", "claim": "x", "answer": "y"})
    assert r.status_code == 502


def test_draft_returns_email_and_never_sends(api, monkeypatch):
    fake = ScriptedLLM([{"role": "assistant", "content": "Subject: Quick check before renewal\n\nHi Rhys,\nCould you confirm..."}])
    monkeypatch.setattr(llm, "chat_message", fake)
    r = api.post("/api/verify/draft", json={"vendor_id": "v05", "items": [{"claim": "Decision maker: CCO", "ask": "Who signs?"}]})
    assert r.status_code == 200
    d = r.json()
    assert d["to"].startswith("Rhys Calloway") and d["subject"] == "Quick check before renewal"
    assert d["body"].startswith("Hi Rhys")
    assert fake.offered == [[]]  # no tools offered: it only drafts text


def test_draft_without_subject_line_gets_a_default(api, monkeypatch):
    monkeypatch.setattr(llm, "chat_message", ScriptedLLM([{"role": "assistant", "content": "Hi there, please confirm."}]))
    d = api.post("/api/verify/draft", json={"vendor_id": "v05", "items": [{"claim": "c"}]}).json()
    assert "Kestrel Alloys Ltd" in d["subject"] and d["body"] == "Hi there, please confirm."


def test_draft_budget_exceeded_is_402(api, monkeypatch):
    def broke(*a, **k):
        raise llm.BudgetExceeded("spent")
    monkeypatch.setattr(llm, "chat_message", broke)
    r = api.post("/api/verify/draft", json={"vendor_id": "v05", "items": [{"claim": "c"}]})
    assert r.status_code == 402 and "budget" in r.json()["detail"].lower()


@pytest.mark.parametrize("items", [[], [{"claim": "c"}] * 6])
def test_draft_item_limits(api, items):
    assert api.post("/api/verify/draft", json={"vendor_id": "v05", "items": items}).status_code == 422
