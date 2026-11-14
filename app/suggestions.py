"""Suggested questions for the Chat page.

A vendor with negotiation history gets questions built from that history (no LLM). A vendor with none (added
from the UI) gets one short mini-model completion from its public profile; anything that goes wrong there falls
back to generic questions. Callers cache the result.
"""
import json
import re

from . import llm

CROSS_VENDOR = [
    "Which tactic has backfired most often, and with whom?",
    "Which vendors changed owner or contact recently?",
    "What works best with Kestrel Alloys?",
    "Summarise every vendor where a competing quote beat 15%",
]

# plain-words noun phrases, so a question reads "Why did a competing quote backfire ..."
TACTIC_WORDS = {
    "competing_quote": "a competing quote", "escalate_to_exec": "escalating to their execs",
    "quarter_end_timing": "quarter-end timing", "multi_year": "a multi-year commit",
    "volume_commit": "a volume commit", "payment_terms": "payment terms", "bundle": "bundling",
}

_APPROVER = re.compile(r"sign-?off|signs|approv|director|decision", re.I)


def tactic_words(t: str) -> str:
    return TACTIC_WORDS.get(t, t.replace("_", " "))


def _pct(x: float) -> str:
    return f"{round(x * 100)}%"


def _contact_person(contact: str) -> str:
    person = (contact or "").split(",")[0].strip()
    return "" if person.lower() in ("", "unknown", "n/a") else person


def generic(v: dict) -> list[str]:
    name, cat = v["name"], v.get("category") or "similar"
    return [
        f"What do we know about {name} so far?",
        f"Who should we expect to negotiate with at {name}?",
        f"Which tactics work best with other {cat} vendors?",
        f"What opening ask makes sense for {name}?",
    ]


def from_history(v: dict, episodes: list[dict], objective: str | None = None) -> list[str]:
    """Four questions about this vendor, each grounded in something the history actually contains."""
    name = v["name"]
    eps = sorted(episodes, key=lambda e: e.get("date", ""))
    qs: list[str] = []
    good = [e for e in eps if e.get("outcome") in ("won", "partial") and e.get("final_discount", 0) > 0]
    if good:
        qs.append(f"Which tactic has worked best with {name}, and at what discount?")
    losses: dict[str, tuple[int, int]] = {}  # tactic -> (losses, index of latest loss)
    for i, e in enumerate(eps):
        if e.get("outcome") == "lost" and e.get("tactic_used"):
            losses[e["tactic_used"]] = (losses.get(e["tactic_used"], (0, 0))[0] + 1, i)
    if losses:  # most losses; ties go to the most recent
        worst = max(losses, key=lambda t: losses[t])
        qs.append(f"Why did {tactic_words(worst)} backfire with {name}?")
    if any(e.get("decision_maker_seen") or _APPROVER.search(e.get("notes") or "") for e in eps):
        qs.append(f"Who actually approves discounts at {name} today?")
    if objective:
        qs.append(f"How should we approach '{objective.rstrip('.')}' with {name}?")
    years = {e["date"][:4] for e in eps if e.get("date")}
    if len(eps) >= 2 and years:
        qs.append(f"What has changed at {name} since {min(years)}?")
    person = _contact_person(v.get("contact", ""))
    if person:
        qs.append(f"How does {person} at {name} usually negotiate?")
    best = max((e.get("final_discount", 0) for e in eps), default=0)
    if best > 0:
        qs.append(f"Can we beat our best {_pct(best)} off with {name}?")
    for q in generic(v):
        if len(qs) >= 4:
            break
        if q not in qs:
            qs.append(q)
    return qs[:4]


def parse_questions(text: str) -> list[str]:
    """Accept a JSON list, {"questions": [...]}, or one question per line (bullets/numbers stripped)."""
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()
    items: list = []
    m = re.search(r"[\[{].*[\]}]", text, flags=re.S)
    if m:
        try:
            data = json.loads(m.group(0))
            items = data.get("questions", []) if isinstance(data, dict) else data
        except ValueError:
            items = []
    if not isinstance(items, list) or not items:  # prose: keep only lines that are questions, so "Here you go:" is dropped
        items = [ln for ln in text.splitlines() if ln.strip().endswith("?")]
    out: list[str] = []
    for q in items:
        if not isinstance(q, str):
            continue
        q = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", q).strip().strip('"').strip()
        if 8 <= len(q) <= 160 and q not in out:
            out.append(q)
    return out


def from_llm(v: dict) -> list[str]:
    """One mini-model call. Raises on any failure (budget, network, unusable output)."""
    profile = (f"Vendor: {v['name']}\nCategory: {v.get('category', 'unknown')}\nContact: {v.get('contact', 'unknown')}\n"
               f"List price (annual, USD): {v.get('list_price_usd_annual', 'unknown')}")
    msgs = [
        {"role": "system", "content": "You write short questions a procurement buyer would ask a negotiation-memory "
         "assistant about one vendor we have not negotiated with yet. Return only a JSON array of 4 strings, each under "
         "100 characters, each naming the vendor. Do not invent facts about the vendor."},
        {"role": "user", "content": profile},
    ]
    qs = parse_questions(llm.mini_chat(msgs, max_tokens=250))
    if len(qs) < 2:
        raise ValueError("mini model returned too few questions")
    for q in generic(v):  # pad a short answer with grounded generic questions
        if len(qs) >= 4:
            break
        if q not in qs:
            qs.append(q)
    return qs[:4]
