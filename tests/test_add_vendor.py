import json

import pytest

from app import llm, main, memory
from tests.conftest import ScriptedLLM, tool_call
from tests.test_api import BRIEF, HIDDEN

NEW = {"name": "Acme Analytics", "category": "BI software", "contact": "Dana (AE)",
       "list_price_usd_annual": 120000, "notes": "Quoted 10% off informally last spring."}


@pytest.fixture
def store(monkeypatch, tmp_path, offline):
    """Isolate VENDORS and the custom-vendor file; record retain calls instead of raising."""
    monkeypatch.setattr(main, "VENDORS", dict(main.VENDORS))
    monkeypatch.setattr(main, "CUSTOM_VENDORS", tmp_path / "custom_vendors.json")
    calls = []
    monkeypatch.setattr(offline, "retain", lambda **kw: calls.append(kw), raising=False)
    return calls


def test_add_vendor_returns_public_fields(api, store):
    r = api.post("/api/vendors", json=NEW)
    assert r.status_code == 200
    body = r.json()
    assert body == {"id": "v13", "name": "Acme Analytics", "category": "BI software", "contact": "Dana (AE)",
                    "list_price_usd_annual": 120000, "episodes": 0}
    for key in HIDDEN:
        assert key not in r.text


def test_new_vendor_listed_and_persisted(api, store):
    api.post("/api/vendors", json={**NEW, "name": "  Acme Analytics  "})
    listed = {v["id"]: v for v in api.get("/api/vendors").json()}
    assert listed["v13"]["name"] == "Acme Analytics" and listed["v13"]["episodes"] == 0
    saved = json.loads(main.CUSTOM_VENDORS.read_text())
    assert saved[0].pop("added")  # date the vendor was added, kept for its first deal's deadline
    assert saved == [{"id": "v13", "name": "Acme Analytics", "category": "BI software", "contact": "Dana (AE)",
                      "list_price_usd_annual": 120000}]
    assert api.post("/api/vendors", json={**NEW, "name": "Other Co"}).json()["id"] == "v14"


def test_duplicate_name_is_409(api, store):
    existing = next(iter(main.VENDORS.values()))["name"]
    r = api.post("/api/vendors", json={**NEW, "name": f" {existing.upper()} "})
    assert r.status_code == 409 and r.json()["detail"] == "vendor already exists"
    assert store == []


@pytest.mark.parametrize("bad", [{"name": "   "}, {"name": "x"}, {"list_price_usd_annual": 0},
                                 {"list_price_usd_annual": -5}, {"category": " "}, {"notes": "x" * 1001}])
def test_invalid_input_is_422(api, store, bad):
    assert api.post("/api/vendors", json={**NEW, **bad}).status_code == 422
    assert "v13" not in main.VENDORS


def test_defaults_for_optional_fields(api, store):
    r = api.post("/api/vendors", json={k: NEW[k] for k in ("name", "category", "list_price_usd_annual")})
    assert r.json()["contact"] == "unknown"
    assert "What we know" not in store[0]["content"]


def test_retain_failure_is_502_and_not_added(api, store, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("hindsight down")
    monkeypatch.setattr(memory, "retain_profile", boom)
    r = api.post("/api/vendors", json=NEW)
    assert r.status_code == 502 and r.json()["detail"].startswith("could not save vendor to memory: ")
    assert "v13" not in main.VENDORS and not main.CUSTOM_VENDORS.exists()


def test_profile_memory_shape(api, store):
    api.post("/api/vendors", json=NEW)
    kw = store[0]
    assert kw["document_id"] == "profile-v13" and "tactic" not in kw["metadata"]
    assert kw["metadata"]["kind"] == "profile"
    assert kw["tags"] == ["vendor:v13", "category:BI software"]
    assert "Acme Analytics" in kw["content"] and "$120,000/yr" in kw["content"]
    assert "What we know: Quoted 10% off" in kw["content"]


def test_brief_and_memory_view_for_new_vendor(api, store, monkeypatch, offline):
    api.post("/api/vendors", json=NEW)
    fake = ScriptedLLM([tool_call("tactic_scoreboard"), tool_call("submit_brief", BRIEF, "c2")])
    monkeypatch.setattr(llm, "chat_message", fake)
    r = api.post("/api/brief", json={"vendor_id": "v13", "objective": "first contract"})
    assert r.status_code == 200
    assert "No past negotiations on record" in r.json()["trace"][0]["result"]
    m = api.get("/api/memory/v13")
    assert m.status_code == 200 and m.json()["episodes"] == []


class _Stop(BaseException):  # escapes _retry, which only catches Exception
    pass


def test_eval_loop_skips_vendors_without_hidden(store, monkeypatch):
    custom = {"id": "v13", "name": "Acme", "category": "x", "contact": "-", "list_price_usd_annual": 1}
    monkeypatch.setattr(main, "VENDORS", {"v13": custom, **main.VENDORS})  # custom vendor first
    seen = []

    def stop(bank, v, *a, **k):
        seen.append(v["id"])
        raise _Stop
    monkeypatch.setattr(memory, "ensure_bank", lambda b: None)
    monkeypatch.setattr(main.agent, "make_brief", stop)
    with pytest.raises(_Stop):
        main._eval_loop({"series": {"memory": [], "baseline": []}}, "t", 1, 3)
    assert seen == ["v01"]


def test_startup_merges_custom_vendors(store):
    main.CUSTOM_VENDORS.write_text(json.dumps([{"id": "v20", "name": "Saved Co", "category": "c", "contact": "unknown",
                                                "list_price_usd_annual": 5}]))
    loaded = main._load_vendors()
    assert loaded["v20"]["name"] == "Saved Co" and "v01" in loaded
    main.CUSTOM_VENDORS.write_text("{not json")
    assert "v20" not in main._load_vendors() and "v01" in main._load_vendors()


def test_new_vendor_gets_a_first_deal_on_the_calendar(api, store):
    before = api.get("/api/upcoming").json()
    api.post("/api/vendors", json=NEW)
    after = api.get("/api/upcoming").json()
    assert len(after) == len(before) + 1
    deal = after[-1]
    assert deal["vendor_id"] == "v13" and "Acme Analytics" in deal["objective"] and deal["deadline"]
