"""Thin wrapper over the Hindsight client: one bank, memories tagged per vendor."""
import json
import threading

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


def client() -> Hindsight:
    """One client per thread: the SDK's sync wrapper binds its HTTP session to the creating thread's
    event loop, so sharing a client across FastAPI worker / eval threads fails intermittently."""
    c = getattr(_local, "client", None)
    if c is None:
        c = _local.client = Hindsight(base_url=config.HINDSIGHT_URL, timeout=600.0)
    return c


def vtag(vendor_id: str) -> str:
    return f"vendor:{vendor_id}"


def ensure_bank(bank_id: str) -> None:
    client().create_bank(bank_id=bank_id, name="Precedent procurement memory",
                         retain_mission=RETAIN_MISSION, retain_extraction_mode=config.env("RETAIN_EXTRACTION_MODE", "concise"),
                         observations_mission=OBSERVATIONS_MISSION,
                         reflect_mission="You advise a procurement team preparing vendor negotiations. "
                                         "Be specific, cite evidence, flag when evidence is thin.")


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
