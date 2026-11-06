"""Thin wrapper over the Hindsight client: one bank, memories tagged per vendor."""
import json
import threading
import time
from collections import deque
from datetime import datetime, timezone

from hindsight_client import Hindsight

from . import config

RETAIN_MISSION = (
    "You are the memory of a buyer-side procurement team. Extract, per vendor: which negotiation "
    "tactic we used, what we asked for versus what we got, how the vendor reacted, who actually "
    "approved discounts (name and role), timing habits (quarter end, expiring offers), and any "
    "change over time (new owner, departed contact, new pricing policy). Keep numbers exact."
)
OBSERVATIONS_MISSION = (
    "Observations are durable beliefs about how each vendor behaves in negotiation: tactics that "
    "work or backfire, the real decision maker, how far they will ever go on price, and timing "
    "habits. When newer evidence contradicts an older belief, record the change rather than "
    "discarding the history."
)
PLAYBOOK_QUERY = (
    "What do we know about how this vendor negotiates? Cover: which of our tactics moved them and "
    "which backfired, who really decides on discounts, the maximum discount they have ever given, "
    "their timing habits, and anything that changed recently."
)


_local = threading.local()

# Ledger of every Hindsight call the app makes, newest last; surfaced in the UI as memory activity.
LEDGER: deque = deque(maxlen=500)
_LEDGER_LOCK = threading.Lock()
_OP_KIND = {"recall": "recall", "retain": "retain", "reflect": "reflect"}


def _vendor_of(kwargs: dict) -> str | None:
    for t in kwargs.get("tags") or []:
        if isinstance(t, str) and t.startswith("vendor:"):
            return t.split(":", 1)[1]
    mid = kwargs.get("mental_model_id") or kwargs.get("id") or ""
    return mid.removeprefix("playbook-") if isinstance(mid, str) and mid.startswith("playbook-") else None


def _detail(op: str, kwargs: dict) -> str:
    for k in ("query", "source_query"):
        if kwargs.get(k):
            return str(kwargs[k])[:140]
    if kwargs.get("content"):
        return str(kwargs["content"])[:140]
    return kwargs.get("mental_model_id") or kwargs.get("bank_id") or op


def ledger_counts() -> dict:
    counts = {"recall": 0, "retain": 0, "reflect": 0, "mental_model": 0, "other": 0}
    with _LEDGER_LOCK:
        for e in LEDGER:
            counts[e["kind"]] += 1
    return counts


def ledger(limit: int = 100) -> list[dict]:
    with _LEDGER_LOCK:
        ops = list(LEDGER)[-limit:]
    return [{k: v for k, v in e.items() if k != "kind"} for e in reversed(ops)]


class _Tracked:
    """Wraps the Hindsight client so each public call is timed and recorded in LEDGER."""

    def __init__(self, inner: Hindsight):
        self._inner = inner

    def __getattr__(self, name):
        attr = getattr(self._inner, name)
        if name.startswith("_") or not callable(attr) or name in ("close", "get_version"):
            return attr

        def call(*args, **kwargs):
            t0 = time.perf_counter()
            entry = {"t": datetime.now(timezone.utc).isoformat(timespec="seconds"), "op": name,
                     "vendor_id": _vendor_of(kwargs), "detail": _detail(name, kwargs),
                     "kind": _OP_KIND.get(name, "mental_model" if "mental_model" in name else "other")}
            try:
                out = attr(*args, **kwargs)
                entry.update(ok=True, error=None)
                return out
            except Exception as e:
                entry.update(ok=False, error=f"{type(e).__name__}: {str(e)[:160]}")
                raise
            finally:
                entry["ms"] = int((time.perf_counter() - t0) * 1000)
                with _LEDGER_LOCK:
                    LEDGER.append(entry)
        return call


def client() -> Hindsight:
    """One client per thread: the SDK's sync wrapper binds its HTTP session to the creating thread's
    event loop, so sharing a client across FastAPI worker / eval threads fails intermittently."""
    c = getattr(_local, "client", None)
    if c is None:
        c = _local.client = _Tracked(Hindsight(base_url=config.HINDSIGHT_URL, timeout=600.0))
    return c


def vtag(vendor_id: str) -> str:
    return f"vendor:{vendor_id}"


def ensure_bank(bank_id: str) -> None:
    client().create_bank(bank_id=bank_id, name="Precedent procurement memory",
                         retain_mission=RETAIN_MISSION, retain_extraction_mode=config.env("RETAIN_EXTRACTION_MODE", "concise"),
                         observations_mission=OBSERVATIONS_MISSION,
                         reflect_mission="You advise a procurement team preparing vendor negotiations. "
                                         "Be specific, cite evidence, flag when evidence is thin.")


DIRECTIVES = [
    ("Evidence before advice", "Only state a fact about a vendor if a retained memory supports it. When the "
     "evidence is thin or missing, say so instead of guessing.", 10),
    ("Respect what backfired", "If a tactic backfired with this vendor, flag it clearly and do not recommend it "
     "again unless newer evidence shows the situation changed.", 9),
    ("Newest evidence wins", "When memories conflict (new owner, departed contact, changed pricing policy), prefer "
     "the most recent evidence and say what changed and when.", 8),
    ("Never under-ask", "Do not advise opening below the best discount this vendor has already given us.", 7),
]


def ensure_directives(bank_id: str) -> None:
    """Standing rules stored in the bank; Hindsight applies them to reflect and to playbook refreshes."""
    have = {d["name"] for d in (client().list_directives(bank_id=bank_id).to_dict().get("items") or [])}
    for name, content, prio in DIRECTIVES:
        if name not in have:
            client().create_directive(bank_id=bank_id, name=name, content=content, priority=prio)


def directives(bank_id: str) -> list[dict]:
    items = client().list_directives(bank_id=bank_id).to_dict().get("items") or []
    return [{"name": d["name"], "content": d["content"], "priority": d.get("priority", 0),
             "active": d.get("is_active", True)} for d in sorted(items, key=lambda d: -d.get("priority", 0))]


def ensure_playbook(bank_id: str, vendor_id: str, vendor_name: str) -> None:
    """Standing per-vendor mental model, rewritten by Hindsight as new outcomes are retained."""
    try:
        client().create_mental_model(
            bank_id=bank_id, id=f"playbook-{vendor_id}", name=f"{vendor_name} negotiation playbook",
            source_query=PLAYBOOK_QUERY, tags=[vtag(vendor_id)], max_tokens=1200,
            trigger={"refresh_after_consolidation": True})
    except Exception:
        pass  # already exists


def episode_text(ep: dict, vendor: dict) -> str:
    return (f"Negotiation with {vendor['name']} ({vendor['category']}) on {ep['date']}, led by "
            f"{ep.get('buyer', 'our buyer')}. Tactic we used: {ep['tactic_used'].replace('_', ' ')}. "
            f"We asked for {ep['ask_discount']*100:.0f}% off and got {ep['final_discount']*100:.1f}% "
            f"({ep['outcome']}). {ep['notes']}"
            + (f" Approver seen: {ep['decision_maker_seen']}." if ep.get("decision_maker_seen") else ""))


def retain_episode(bank_id: str, ep: dict, vendor: dict) -> None:
    client().retain(bank_id=bank_id, content=episode_text(ep, vendor),
                    timestamp=ep["date"], context="Buyer-side negotiation record",
                    tags=[vtag(vendor["id"]), f"category:{vendor['category']}"],
                    document_id=f"ep-{vendor['id']}-{ep['date']}-{ep['tactic_used']}",
                    metadata={"tactic": ep["tactic_used"], "outcome": ep["outcome"],
                              "final_discount": f"{ep['final_discount']:.3f}", "ask_discount": f"{ep['ask_discount']:.3f}",
                              "date": ep["date"]})


def recall_vendor(bank_id: str, vendor_id: str, query: str, limit: int = 12) -> list[dict]:
    res = client().recall(bank_id=bank_id, query=query, tags=[vtag(vendor_id)],
                          tags_match="any_strict", budget="mid", max_tokens=3000,
                          types=["observation", "world", "experience"])
    out = []
    for r in res.results[:limit]:
        out.append({"id": r.id, "text": r.text, "kind": "observation" if r.type == "observation" else "fact",
                    "date": (r.occurred_start or r.mentioned_at or "")[:10] or None})
    return out


def playbook(bank_id: str, vendor_id: str) -> str | None:
    try:
        mm = client().get_mental_model(bank_id=bank_id, mental_model_id=f"playbook-{vendor_id}")
        return getattr(mm, "content", None)
    except Exception:
        return None


def vendor_memory_view(bank_id: str, vendor_id: str) -> dict:
    obs = client().recall(bank_id=bank_id, query="how this vendor negotiates", tags=[vtag(vendor_id)],
                          tags_match="any_strict", types=["observation"], max_tokens=2500)
    facts = client().recall(bank_id=bank_id, query="negotiation history", tags=[vtag(vendor_id)],
                            tags_match="any_strict", types=["world", "experience"], max_tokens=1500)
    return {"observations": [{"text": r.text, "proof_count": len(r.source_fact_ids or [])}
                             for r in obs.results],
            "mental_model": playbook(bank_id, vendor_id), "facts": len(facts.results)}


def reflect_vendor(bank_id: str, vendor_id: str, question: str) -> tuple[str, list[dict]]:
    r = client().reflect(bank_id=bank_id, query=question, tags=[vtag(vendor_id)], tags_match="any_strict",
                         budget="low", include_facts=True)
    facts = []
    based = getattr(r, "based_on", None)
    for f in (getattr(based, "memories", None) or []) if based else []:
        facts.append({"text": getattr(f, "text", str(f)), "kind": "fact",
                      "date": (getattr(f, "occurred_start", None) or "")[:10] or None})
    return r.text, facts


def tactic_scoreboard(bank_id: str, vendor_id: str, all_tactics: list[str]) -> dict:
    """Aggregate this vendor's past negotiations from Hindsight recall. Each retained episode carries
    structured metadata (tactic/outcome/discount); recall returns it on every derived fact, and facts of
    one episode share a document_id, so we de-duplicate on that."""
    res = client().recall(bank_id=bank_id, query="negotiation tactic used and outcome achieved",
                          tags=[vtag(vendor_id)], tags_match="any_strict", types=["world", "experience"],
                          budget="high", max_tokens=8000)
    episodes: dict[str, dict] = {}
    for r in res.results:
        md = r.metadata or {}
        if r.document_id and md.get("tactic") and r.document_id not in episodes:
            episodes[r.document_id] = md
    board: dict[str, dict] = {}
    for md in episodes.values():
        row = board.setdefault(md["tactic"], {"tries": 0, "outcomes": [], "discounts": []})
        row["tries"] += 1
        row["outcomes"].append(md.get("outcome", "?"))
        try:
            row["discounts"].append(float(md["final_discount"]))
        except (KeyError, ValueError):
            pass
    return {"episodes": len(episodes), "board": board, "untried": [t for t in all_tactics if t not in board]}


def recall_bank(bank_id: str, query: str, vendor_id: str | None = None, limit: int = 10) -> list[dict]:
    """Search the whole bank (all vendors) or one vendor. Each hit carries its vendor id, parsed from the
    vendor:<id> tag, so a cross-vendor answer can say which vendor a memory is about."""
    kw = dict(tags=[vtag(vendor_id)], tags_match="any_strict") if vendor_id else {}
    res = client().recall(bank_id=bank_id, query=query, budget="mid", max_tokens=3500,
                          types=["observation", "world", "experience"], **kw)
    out = []
    for r in res.results[:limit]:
        vid = next((t.split(":", 1)[1] for t in (r.tags or []) if t.startswith("vendor:")), None)
        out.append({"id": r.id, "text": r.text, "kind": "observation" if r.type == "observation" else "fact",
                    "date": (r.occurred_start or r.mentioned_at or "")[:10] or None, "vendor_id": vid})
    return out


def playbook_history(bank_id: str, vendor_id: str) -> dict:
    """Every version Hindsight kept of a vendor's playbook. Each history entry holds the content that was
    replaced at `changed_at` and the memories that version was built from; oldest first."""
    mid = f"playbook-{vendor_id}"
    try:
        mm = client().get_mental_model(bank_id=bank_id, mental_model_id=mid)
        hist = client().get_mental_model_history(bank_id=bank_id, mental_model_id=mid) or []
    except Exception:
        return {"vendor_id": vendor_id, "current": {"content": None, "refreshed_at": None}, "versions": []}
    versions = []
    for h in sorted(hist, key=lambda h: h.get("changed_at") or ""):
        if not h.get("previous_content"):
            continue  # the empty placeholder before the first refresh
        based = (h.get("previous_reflect_response") or {}).get("based_on") or {}
        versions.append({"at": h.get("changed_at"), "content": h["previous_content"],
                         "sources": {k: len(based.get(k) or []) for k in ("world", "observation", "experience")}})
    refreshed = getattr(mm, "last_refreshed_at", None)
    return {"vendor_id": vendor_id,
            "current": {"content": getattr(mm, "content", None), "refreshed_at": str(refreshed) if refreshed else None},
            "versions": versions}


def explore_recall(bank_id: str, query: str, vendor_id: str | None = None, as_of: str | None = None,
                   limit: int = 15) -> dict:
    """Recall with Hindsight's retrieval trace, so the UI can show which channels (semantic, keyword,
    graph, temporal) surfaced each memory and how the reranker ordered them. No LLM call is involved."""
    kw = dict(tags=[vtag(vendor_id)], tags_match="any_strict") if vendor_id else {}
    if as_of:
        kw["query_timestamp"] = f"{as_of}T23:59:59Z"
    t0 = time.perf_counter()
    res = client().recall(bank_id=bank_id, query=query, budget="mid", max_tokens=4000, trace=True,
                          include_entities=True, types=["observation", "world", "experience"], **kw).to_dict()
    ms = int((time.perf_counter() - t0) * 1000)
    trace = res.get("trace") or {}
    ranks: dict[str, dict] = {}
    for rr in trace.get("retrieval_results") or []:
        ch = {"semantic": "semantic", "bm25": "bm25", "graph": "graph", "temporal": "temporal"}.get(
            rr.get("method_name"), rr.get("method_name"))
        for hit in rr.get("results") or []:
            cur = ranks.setdefault(hit["node_id"], {})
            if ch not in cur or hit["rank"] < cur[ch]:
                cur[ch] = hit["rank"]
    rerank = {r["node_id"]: r for r in trace.get("reranked") or []}
    out, ent_count = [], {}
    hits = res.get("results") or []
    if as_of:  # time travel: only what had happened by that date (observations are re-derived later, so drop them)
        hits = [r for r in hits if r.get("type") != "observation"
                and ((r.get("occurred_start") or r.get("mentioned_at") or "9999")[:10] <= as_of)]
    for r in hits[:limit]:
        md = r.get("metadata") or {}
        if isinstance(md, str):
            md = json.loads(md or "{}")
        ents = r.get("entities") or []
        for e in ents:
            ent_count[e] = ent_count.get(e, 0) + 1
        ch = ranks.get(r["id"], {})
        rk = rerank.get(r["id"], {})
        out.append({"id": r["id"], "text": r["text"], "type": r.get("type"),
                    "date": (r.get("occurred_start") or r.get("mentioned_at") or "")[:10] or None,
                    "vendor_id": next((t.split(":", 1)[1] for t in (r.get("tags") or []) if t.startswith("vendor:")), None),
                    "tactic": md.get("tactic"), "outcome": md.get("outcome"), "entities": ents,
                    "score": rk.get("rerank_score"),
                    "channels": {c: ch.get(c) for c in ("semantic", "bm25", "graph", "temporal")},
                    "rerank_rank": rk.get("rerank_rank"), "rrf_rank": rk.get("rrf_rank")})
    summ = trace.get("summary") or {}
    tc = (trace.get("query") or {}).get("temporal_constraint")
    return {"results": out,
            "entities": sorted(({"name": k, "count": v} for k, v in ent_count.items()), key=lambda e: -e["count"]),
            "summary": {"visited": summ.get("total_nodes_visited"), "entry_points": summ.get("entry_points_found"),
                        "ms": ms, "returned": len(out),
                        "temporal_constraint": f"as of {as_of}" if as_of else (str(tc) if tc else None)}}
