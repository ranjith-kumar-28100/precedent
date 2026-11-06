"""Pure parsing / formatting / dispatch logic. No network, no Band imports."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

TACTICS = ["competing_quote", "volume_commit", "multi_year", "quarter_end_timing",
           "bundle", "escalate_to_exec", "payment_terms"]
OUTCOMES = ["won", "partial", "lost"]

DEFAULT_BENCH = Path(__file__).resolve().parents[2] / "data" / "market_benchmarks.json"


# ---------------- incoming message handling ----------------
def split_sender(raw: str) -> tuple[str, str]:
    """Band delivers '[Sender]: text'. Return (sender, text)."""
    m = re.match(r"^\[([^\]]+)\]:\s*(.*)$", raw, re.S)
    return (m.group(1), m.group(2)) if m else ("", raw)


def strip_mentions(text: str) -> str:
    """Remove leading @mentions (handles '@Name' tokens at the start)."""
    return re.sub(r"^(\s*@[\w.\-]+)+\s*", "", text).strip()


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


# ---------------- vendor resolution ----------------
def resolve_vendor(query: str, vendors: list[dict]) -> dict | None:
    q = norm(query)
    if not q:
        return None
    for v in vendors:
        if q == norm(v["id"]) or q == norm(v["name"]):
            return v
    hits = [v for v in vendors if q in norm(v["name"]) or norm(v["name"]).startswith(q.split()[0])
            and all(w in norm(v["name"]) for w in q.split())]
    return hits[0] if len(hits) == 1 else None


def vendor_hint(vendors: list[dict]) -> str:
    return "Known vendors: " + ", ".join(f"{v['name']} ({v['id']})" for v in vendors)


# ---------------- Scout ----------------
CAT_ALIASES = {
    "SaaS licences": ["saas", "software", "licence", "license", "licences", "licenses", "subscription"],
    "Freight & logistics": ["freight", "logistics", "shipping", "haulage", "transport"],
    "Raw materials": ["raw", "materials", "steel", "alloy", "polymer", "metal"],
    "Contract manufacturing": ["manufacturing", "contract", "assembly", "oem"],
    "Facilities services": ["facilities", "facility", "cleaning", "building", "janitorial"],
}


def load_bench(path: Path = DEFAULT_BENCH) -> dict:
    return json.loads(Path(path).read_text())


def find_category(text: str, bench: dict, vendors: list[dict] | None = None) -> str | None:
    t = norm(text)
    for v in vendors or []:
        if norm(v["name"]) in t or v["id"].lower() in t.split():
            t += " " + norm(v["category"])
    for cat in bench["categories"]:
        if norm(cat) in t:
            return cat
    words = set(t.split())
    scores = {c: sum(a in words or a in t for a in al) for c, al in CAT_ALIASES.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] and best in bench["categories"] else None


def eur(n: float) -> str:
    return f"EUR {n:,.0f}"


def scout_reply(text: str, bench: dict, vendors: list[dict] | None = None) -> str:
    cats = list(bench["categories"])
    if norm(text) in ("", "help", "categories"):
        return ("Scout: ask me about a category, e.g. 'benchmarks for SaaS licences' or 'how many bidders "
                "for freight?'. Categories: " + ", ".join(cats) + ".")
    cat = find_category(text, bench, vendors)
    if not cat:
        return "Scout: I could not match a category. Try one of: " + ", ".join(cats) + "."
    c = bench["categories"][cat]
    return (
        f"Scout market benchmark - {cat} ({c['awards']:,} public awards)\n"
        f"- Award size: p25 {eur(c['award_eur_p25'])} / median {eur(c['award_eur_median'])} / p75 {eur(c['award_eur_p75'])}\n"
        f"- Avg bidders: {c['avg_bidders']}; single-bidder share {c['single_bidder_share']:.0%}\n"
        f"- Negotiated-procedure share: {c['negotiated_procedure_share']:.0%}\n"
        f"Read: {_read(c)}\n"
        f"Source: {bench['source']} ({bench['n_awards']:,} awards)"
    )


def _read(c: dict) -> str:
    if c["single_bidder_share"] >= 0.4:
        return "many awards have a single bidder - competition is thin, so a credible competing quote is a strong lever."
    if c["avg_bidders"] >= 2.8:
        return "markets are fairly contested - expect rivals to quote; use that."
    return "moderate competition - bring a second quote to keep leverage."


# ---------------- Negotiator ----------------
@dataclass
class BriefCmd:
    vendor_query: str
    use_memory: bool = True


def parse_brief(text: str) -> BriefCmd | None:
    m = re.match(r"^brief\s+(.+?)(\s+memory\s+(on|off))?\s*$", text.strip(), re.I | re.S)
    if not m:
        return None
    return BriefCmd(m.group(1).strip(), (m.group(3) or "on").lower() == "on")


def format_brief(res: dict, vendor_name: str) -> str:
    b = res["brief"]
    cites = res.get("citations") or []
    idx = {c["id"]: i + 1 for i, c in enumerate(cites)}
    lines = [f"Brief: {vendor_name} (memory {'ON' if res.get('use_memory') else 'OFF'})",
             b.get("summary", ""),
             f"Opening ask: {b.get('recommended_opening_ask_pct')}% | Decision maker: {b.get('decision_maker', 'unknown')}"]
    if b.get("vendor_profile"):
        lines.append(f"Profile: {b['vendor_profile']}")
    lines.append("Tactics:")
    for i, t in enumerate(b.get("tactics", []), 1):
        lines.append(f"{i}. {t['tactic']} ({t.get('confidence', '?')}) - {t.get('why', '')}")
    if b.get("watch_outs"):
        lines.append("Watch out:")
        lines += [f"- {w}" for w in b["watch_outs"]]
    if cites:
        lines.append("Memories cited:")
        for i, c in enumerate(cites[:8], 1):
            d = f" [{c['date']}]" if c.get("date") else ""
            lines.append(f"[{i}] ({c.get('kind', '?')}){d} {_clip(c['text'])}")
    else:
        lines.append("No memories cited.")
    return "\n".join(lines)


def _clip(s: str, n: int = 220) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1] + "..."


# ---------------- Ledger ----------------
@dataclass
class LogCmd:
    vendor_query: str
    tactic: str
    ask: float
    got: float
    outcome: str
    notes: str = ""


class ParseError(ValueError):
    pass


def _pct(s: str) -> float:
    v = float(s.strip().rstrip("%"))
    return v / 100 if v > 1 else v  # accepts 12 or 12% or 0.12


def parse_log(text: str) -> LogCmd:
    m = re.match(r"^log\s+(.+?)\s+(?=\w+=)(.*)$", text.strip(), re.S | re.I)
    if not m:
        raise ParseError("Usage: log <vendor> tactic=<t> ask=<pct> got=<pct> outcome=<won|partial|lost> <notes>")
    vendor, rest = m.group(1), m.group(2)
    kv: dict[str, str] = {}
    for key in ("tactic", "ask", "got", "outcome"):
        km = re.search(rf"\b{key}=(\S+)", rest, re.I)
        if not km:
            raise ParseError(f"Missing {key}=... (usage: log <vendor> tactic=<t> ask=<pct> got=<pct> outcome=<won|partial|lost> <notes>)")
        kv[key] = km.group(1)
        rest = rest.replace(km.group(0), " ", 1)
    tactic = kv["tactic"].lower()
    if tactic not in TACTICS:
        raise ParseError(f"Unknown tactic '{tactic}'. Use one of: {', '.join(TACTICS)}")
    outcome = kv["outcome"].lower()
    if outcome not in OUTCOMES:
        raise ParseError(f"Unknown outcome '{outcome}'. Use won, partial or lost.")
    try:
        ask, got = _pct(kv["ask"]), _pct(kv["got"])
    except ValueError:
        raise ParseError("ask= and got= must be numbers, e.g. ask=15 got=9")
    return LogCmd(vendor, tactic, ask, got, outcome, " ".join(rest.split()))


def parse_memory(text: str) -> str | None:
    m = re.match(r"^memory\s+(.+)$", text.strip(), re.I | re.S)
    return m.group(1).strip() if m else None


def format_memory(view: dict, vendor_name: str) -> str:
    obs = view.get("observations") or []
    lines = [f"Memory: {vendor_name} - {len(obs)} observations, {view.get('facts', 0)} facts"]
    for o in obs[:8]:
        lines.append(f"- (x{o.get('proof_count', 1)}) {_clip(o['text'])}")
    if view.get("mental_model"):
        lines.append("Mental model: " + _clip(view["mental_model"], 400))
    return "\n".join(lines)


# ---------------- dispatch (injected API client) ----------------
class Api(Protocol):
    async def vendors(self) -> list[dict]: ...
    async def brief(self, vendor_id: str, objective: str, use_memory: bool) -> dict: ...
    async def outcome(self, payload: dict) -> dict: ...
    async def memory(self, vendor_id: str) -> dict: ...


async def _vendor(q: str, api: Api) -> tuple[dict | None, str]:
    vs = await api.vendors()
    v = resolve_vendor(q, vs)
    return v, ("" if v else f"Could not identify vendor '{q}'. {vendor_hint(vs)}")


async def negotiator_reply(text: str, api: Api) -> str:
    cmd = parse_brief(text)
    if not cmd:
        return "Negotiator: usage '@Negotiator brief <vendor name or id> [memory off]'."
    v, err = await _vendor(cmd.vendor_query, api)
    if not v:
        return err
    res = await api.brief(v["id"], f"Get the best commercial terms from {v['name']}", cmd.use_memory)
    return format_brief(res, v["name"])


async def ledger_reply(text: str, api: Api) -> str:
    t = text.strip()
    mq = parse_memory(t)
    if mq:
        v, err = await _vendor(mq, api)
        return err or format_memory(await api.memory(v["id"]), v["name"])
    if not re.match(r"^log\b", t, re.I):
        return ("Ledger: '@Ledger log <vendor> tactic=<t> ask=<pct> got=<pct> outcome=<won|partial|lost> <notes>' "
                "or '@Ledger memory <vendor>'.")
    try:
        cmd = parse_log(t)
    except ParseError as e:
        return f"Ledger: {e}"
    v, err = await _vendor(cmd.vendor_query, api)
    if not v:
        return err
    await api.outcome({"vendor_id": v["id"], "tactic_used": cmd.tactic, "ask_discount": cmd.ask,
                       "final_discount": cmd.got, "outcome": cmd.outcome, "notes": cmd.notes})
    return (f"Ledger: retained to Hindsight memory - {v['name']}: {cmd.tactic}, asked {cmd.ask:.0%}, "
            f"got {cmd.got:.0%}, {cmd.outcome}. Next brief for this vendor will recall it.")
