from app import memory, sim
from tests.conftest import hit


def md(tactic, outcome, final, ask="0.180"):
    return {"tactic": tactic, "outcome": outcome, "final_discount": final, "ask_discount": ask, "date": "2025-06-12"}


def test_scoreboard_counts_each_episode_once(offline):
    # Hindsight derives several facts from one retained episode; all share its document_id
    offline.results = [
        hit("fact a", doc="ep-1", metadata=md("competing_quote", "won", "0.190")),
        hit("fact b", doc="ep-1", metadata=md("competing_quote", "won", "0.190")),
        hit("fact c", doc="ep-2", metadata=md("escalate_to_exec", "lost", "0.020")),
        hit("an observation", type="observation", doc=None, metadata=None),
    ]
    sb = memory.tactic_scoreboard("bank", "v01", sim.TACTICS)
    assert sb["episodes"] == 2
    assert sb["board"]["competing_quote"] == {"tries": 1, "outcomes": ["won"], "discounts": [0.19]}
    assert sb["board"]["escalate_to_exec"]["outcomes"] == ["lost"]
    assert "competing_quote" not in sb["untried"] and "bundle" in sb["untried"]


def test_scoreboard_scopes_recall_to_the_vendor_tag(offline):
    memory.tactic_scoreboard("bank", "v07", sim.TACTICS)
    _, kw = offline.calls[-1]
    assert kw["tags"] == ["vendor:v07"] and kw["tags_match"] == "any_strict"


def test_scoreboard_tolerates_bad_discount(offline):
    offline.results = [hit("x", doc="ep-9", metadata=md("bundle", "partial", "n/a"))]
    sb = memory.tactic_scoreboard("bank", "v01", sim.TACTICS)
    assert sb["board"]["bundle"]["discounts"] == []


def test_recall_bank_parses_vendor_from_tags(offline):
    offline.results = [hit("Kestrel folded", tags=["category:raw", "vendor:v03"]),
                       hit("untagged", tags=[], type="observation", date=None)]
    out = memory.recall_bank("bank", "what worked")
    assert out[0]["vendor_id"] == "v03" and out[0]["kind"] == "fact" and out[0]["date"] == "2025-06-12"
    assert out[1]["vendor_id"] is None and out[1]["kind"] == "observation" and out[1]["date"] is None
    assert "tags" not in offline.calls[-1][1]  # whole-bank search


def test_recall_bank_with_vendor_filters_by_tag(offline):
    memory.recall_bank("bank", "q", vendor_id="v02")
    assert offline.calls[-1][1]["tags"] == ["vendor:v02"]


def test_episode_text_keeps_numbers_exact():
    ep = {"date": "2025-06-12", "tactic_used": "volume_commit", "ask_discount": 0.10, "final_discount": 0.01,
          "outcome": "lost", "notes": "They added a minimum charge."}
    text = memory.episode_text(ep, {"name": "TransPacific", "category": "logistics"})
    assert "asked for 10% off and got 1.0% (lost)" in text and "volume commit" in text


def test_bank_stats_reads_hindsight_totals(monkeypatch):
    from types import SimpleNamespace
    import httpx
    from app import memory
    pages = {"stats": {"total_documents": 61, "total_nodes": 344, "total_observations": 157},
             "operations": {"operations": [{"operation_type": "refresh_mental_model", "status": "completed"},
                                           {"operation_type": "refresh_mental_model", "status": "failed"},
                                           {"operation_type": "consolidation", "status": "completed"}], "total": 3}}
    monkeypatch.setattr(httpx, "get", lambda url, **k: SimpleNamespace(json=lambda: pages[url.rsplit("/", 1)[1]]))
    monkeypatch.setitem(memory._STATS, "at", 0.0)
    assert memory.bank_stats("b") == {"documents": 61, "memories": 344, "observations": 157, "reflect": 1}


def test_bank_stats_is_none_when_hindsight_down(monkeypatch):
    from app import memory
    monkeypatch.setitem(memory._STATS, "at", 0.0)
    monkeypatch.setitem(memory._STATS, "bank", None)
    assert memory.bank_stats("b") is None  # offline fixture makes httpx.get raise
