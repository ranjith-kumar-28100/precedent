"""The ledger, playbook history and recall explorer added for the memory screens."""
from types import SimpleNamespace

import pytest

from app import memory


class Inner:
    def recall(self, **kw):
        return "ok"

    def get_mental_model(self, **kw):
        raise RuntimeError("boom")


@pytest.fixture
def clear_ledger():
    memory.LEDGER.clear()
    yield
    memory.LEDGER.clear()


def test_tracked_client_records_ops_and_failures(clear_ledger):
    c = memory._Tracked(Inner())
    assert c.recall(bank_id="b", query="who decides", tags=["vendor:v04"]) == "ok"
    with pytest.raises(RuntimeError):
        c.get_mental_model(bank_id="b", mental_model_id="playbook-v02")
    ops = memory.ledger()
    assert [o["op"] for o in ops] == ["get_mental_model", "recall"]  # newest first
    assert ops[1] | {"t": None, "ms": None} == {"t": None, "op": "recall", "vendor_id": "v04", "detail": "who decides",
                                                 "ok": True, "error": None, "ms": None}
    assert ops[0]["vendor_id"] == "v02" and not ops[0]["ok"] and "boom" in ops[0]["error"]
    assert memory.ledger_counts() == {"recall": 1, "retain": 0, "reflect": 0, "mental_model": 1, "other": 0}


def test_playbook_history_orders_versions_and_skips_empty(offline):
    offline.get_mental_model_history = lambda **kw: [
        {"previous_content": "v2", "changed_at": "2026-11-06T16:03", "previous_reflect_response":
            {"based_on": {"world": [1, 2], "observation": [1]}}},
        {"previous_content": "", "changed_at": "2026-11-06T15:48", "previous_reflect_response": {"based_on": {}}},
        {"previous_content": "v1", "changed_at": "2026-11-06T15:50", "previous_reflect_response": None},
    ]
    h = memory.playbook_history("b", "v04")
    assert [v["content"] for v in h["versions"]] == ["v1", "v2"]
    assert h["versions"][1]["sources"] == {"world": 2, "observation": 1, "experience": 0}
    assert h["current"]["content"].startswith("Playbook")


def _trace_result():
    def r(id, date, type="world", tags=("vendor:v04",)):
        return {"id": id, "text": f"fact {id}", "type": type, "occurred_start": f"{date}T00:00:00+00:00",
                "tags": list(tags), "entities": ["Kenji"], "metadata": '{"tactic": "payment_terms", "outcome": "won"}'}
    return {"results": [r("a", "2026-04-02"), r("b", "2025-06-12"), r("o", "2025-06-12", type="observation")],
            "trace": {"retrieval_results": [
                {"method_name": "semantic", "results": [{"node_id": "a", "rank": 1}, {"node_id": "b", "rank": 2}]},
                {"method_name": "bm25", "results": [{"node_id": "b", "rank": 1}]}],
                "reranked": [{"node_id": "a", "rerank_score": 0.9, "rerank_rank": 1, "rrf_rank": 2}],
                "summary": {"total_nodes_visited": 29, "entry_points_found": 10}, "query": {}}}


def test_explore_recall_maps_channels_and_metadata(offline):
    offline.recall = lambda **kw: SimpleNamespace(to_dict=_trace_result)
    out = memory.explore_recall("b", "who approves", "v04")
    a, b = out["results"][0], out["results"][1]
    assert a["channels"] == {"semantic": 1, "bm25": None, "graph": None, "temporal": None}
    assert b["channels"]["bm25"] == 1 and a["rerank_rank"] == 1 and a["score"] == 0.9
    assert a["tactic"] == "payment_terms" and a["vendor_id"] == "v04"
    assert out["entities"] == [{"name": "Kenji", "count": 3}]
    assert out["summary"]["visited"] == 29


def test_explore_recall_as_of_hides_later_facts_and_observations(offline):
    seen = {}

    def recall(**kw):
        seen.update(kw)
        return SimpleNamespace(to_dict=_trace_result)
    offline.recall = recall
    out = memory.explore_recall("b", "who approves", "v04", as_of="2025-07-01")
    assert [r["id"] for r in out["results"]] == ["b"]
    assert seen["query_timestamp"] == "2025-07-01T23:59:59Z" and seen["trace"] is True
