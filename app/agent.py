"""Negotiation agent: a tool-calling loop (ReAct style) over Hindsight memory.

The model decides what to look up (recall, playbook, reflect, market data) and when it has enough
evidence to submit a brief. Memory ON/OFF changes only which tools exist, so the comparison is fair:
the baseline agent has the same model, prompt and loop but no memory tools."""
import json
import time
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Callable

from . import config, llm, memory
from .sim import TACTICS

MAX_STEPS = 7


@lru_cache(maxsize=1)
def benchmarks() -> dict:
    return json.loads((config.DATA_DIR / "market_benchmarks.json").read_text())["categories"]


@dataclass
class Run:
    """Mutable state of one agent run: evidence registry, trace, and the submitted brief."""
    bank_id: str
    vendor: dict
    citations: list[dict] = field(default_factory=list)
    trace: list[dict] = field(default_factory=list)
    brief: dict | None = None

    def cite(self, text: str, kind: str, date: str | None = None) -> str:
        cid = f"m{len(self.citations) + 1}"
        self.citations.append({"id": cid, "text": text, "kind": kind, "date": date})
        return cid


# ---- tools -----------------------------------------------------------------------------------
def t_recall(run: Run, query: str, **_) -> str:
    hits = memory.recall_vendor(run.bank_id, run.vendor["id"], query, limit=8)
    if not hits:
        return "No memories found for this vendor."
    return "\n".join(f"[{run.cite(h['text'], h['kind'], h['date'])}] ({h['kind']}"
                     f"{', ' + h['date'] if h['date'] else ''}) {h['text']}" for h in hits)


def t_playbook(run: Run, **_) -> str:
    pb = memory.playbook(run.bank_id, run.vendor["id"])
    return f"[{run.cite(pb, 'mental_model')}] (playbook) {pb}" if pb else "No playbook yet for this vendor."


def t_reflect(run: Run, question: str, **_) -> str:
    text, facts = memory.reflect_vendor(run.bank_id, run.vendor["id"], question)
    ids = [run.cite(f["text"], f["kind"], f["date"]) for f in facts[:5]]
    return f"{text}\n(supporting memories: {', '.join('[' + i + ']' for i in ids) or 'none'})"


def t_scoreboard(run: Run, **_) -> str:
    sb = memory.tactic_scoreboard(run.bank_id, run.vendor["id"], TACTICS)
    if not sb["episodes"]:
        return "No past negotiations on record with this vendor. UNTRIED: " + ", ".join(TACTICS)
    lines = []
    for tactic, row in sorted(sb["board"].items(), key=lambda kv: -max(kv[1]["discounts"] or [0])):
        verdict = ("PROVEN (won)" if "won" in row["outcomes"] else
                   "FAILED (lost)" if row["outcomes"].count("lost") == row["tries"] else "MIXED (partial)")
        best = max(row["discounts"] or [0]) * 100
        lines.append(f"- {tactic}: {row['tries']} tries, outcomes {row['outcomes']}, best discount {best:.1f}% -> {verdict}")
    text = (f"Tactic scoreboard from {sb['episodes']} recorded negotiations with this vendor:\n" + "\n".join(lines)
            + "\nUNTRIED tactics: " + (", ".join(sb["untried"]) or "none"))
    return f"[{run.cite(text, 'fact')}] {text}"


def t_market(run: Run, **_) -> str:
    b = benchmarks().get(run.vendor["category"])
    return json.dumps(b) if b else "No benchmark for this category."


def t_submit(run: Run, **args) -> str:
    tactics = [t for t in args.get("tactics", []) if isinstance(t, dict) and t.get("tactic") in TACTICS][:3]
    if not tactics:
        return f"Rejected: tactics must be a non-empty list using only {TACTICS}."
    try:
        ask = float(args.get("recommended_opening_ask_pct"))
    except (TypeError, ValueError):
        return "Rejected: recommended_opening_ask_pct must be a number (percent off list)."
    run.brief = {"summary": str(args.get("summary", "")), "vendor_profile": str(args.get("vendor_profile", "unknown")),
                 "decision_maker": str(args.get("decision_maker", "unknown")),
                 "recommended_opening_ask_pct": ask, "tactics": tactics,
                 "watch_outs": [str(w) for w in args.get("watch_outs", [])][:4]}
    return "Brief accepted."


def _spec(name: str, desc: str, props: dict, required: list[str]) -> dict:
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {
        "type": "object", "properties": props, "required": required}}}


MEMORY_TOOLS: dict[str, tuple[dict, Callable]] = {
    "recall_memory": (_spec("recall_memory", "Search our memory of past dealings with THIS vendor (calls, emails, "
                            "outcomes). Returns cited memories [mN]. Call several times with different queries.",
                            {"query": {"type": "string"}}, ["query"]), t_recall),
    "tactic_scoreboard": (_spec("tactic_scoreboard", "Structured record of every tactic we have tried on THIS vendor: "
                                "tries, outcomes, best discount, PROVEN/FAILED/MIXED verdicts, and which tactics are "
                                "still UNTRIED. Call this FIRST.", {}, []), t_scoreboard),
    "get_playbook": (_spec("get_playbook", "Read the standing negotiation playbook Hindsight maintains for this vendor.",
                           {}, []), t_playbook),
    "reflect_on_vendor": (_spec("reflect_on_vendor", "Ask Hindsight to reason across all memories of this vendor "
                                "(e.g. 'which tactic backfired and why?'). Slower; use for synthesis.",
                                {"question": {"type": "string"}}, ["question"]), t_reflect),
}
BASE_TOOLS: dict[str, tuple[dict, Callable]] = {
    "market_benchmarks": (_spec("market_benchmarks", "Real public-sector award benchmarks for this spend category "
                                "(median contract size, bidder counts).", {}, []), t_market),
    "submit_brief": (_spec("submit_brief", "Submit the final negotiation brief. Cite evidence ids like [m2] inside "
                           "each tactic's 'why'. Call exactly once when you have enough evidence.", {
        "summary": {"type": "string"}, "vendor_profile": {"type": "string"}, "decision_maker": {"type": "string"},
        "recommended_opening_ask_pct": {"type": "number"},
        "tactics": {"type": "array", "items": {"type": "object", "properties": {
            "tactic": {"type": "string", "enum": TACTICS}, "why": {"type": "string"},
            "confidence": {"type": "number"}}, "required": ["tactic", "why", "confidence"]}},
        "watch_outs": {"type": "array", "items": {"type": "string"}}},
        ["summary", "vendor_profile", "decision_maker", "recommended_opening_ask_pct", "tactics"]), t_submit),
}

SYSTEM = ("You are Precedent, a senior procurement negotiator advising the buyer. Investigate with your tools (start with tactic_scoreboard), "
          "then call submit_brief exactly once. Rules: base claims on tool evidence and cite ids like [m3]; if you "
          "have no evidence about the vendor say so, use low confidence and say 'unknown'; never invent history. "
          "Tactics must come from: " + ", ".join(TACTICS) + ". LEARNING POLICY: every negotiation is also an experiment. "
          "Read the outcomes in memory: a tactic marked PROVEN on the scoreboard is proven, so rank "
          "it first; a tactic that got a small discount or made the vendor harden has FAILED, so do not rank it first "
          "again; if no tactic has proven itself yet, rank first an untried tactic that fits the vendor's behaviour and "
          "say it is an experiment. Opening ask: if a tactic is PROVEN, open about 10%% above the best discount it has achieved; otherwise open at 18%% off list. Never under-ask: a low ask makes a good tactic look like it failed and poisons what we learn. "
          "Use reflect_on_vendor at most once, only if recall and the playbook leave a real gap. Be efficient: at most %d tool rounds." % (MAX_STEPS - 1))


def make_brief(bank_id: str, vendor: dict, objective: str, context: str = "", use_memory: bool = True) -> dict:
    t0 = time.time()
    run = Run(bank_id=bank_id, vendor=vendor)
    registry = {**(MEMORY_TOOLS if use_memory else {}), **BASE_TOOLS}
    specs = [spec for spec, _ in registry.values()]
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": (
                    f"Vendor: {vendor['name']} ({vendor['category']}), list price ${vendor['list_price_usd_annual']:,}/yr, "
                    f"contact {vendor.get('contact', 'unknown')}.\nObjective: {objective}\nContext: {context or 'none'}\n"
                    + ("Memory tools are available." if use_memory else "You have no memory of past dealings."))}]
    for step in range(MAX_STEPS):
        forced = step == MAX_STEPS - 1 and run.brief is None
        if forced:
            messages.append({"role": "user", "content": "Out of time: call submit_brief now with what you have."})
        msg = llm.chat_message(messages, specs)
        calls = msg.get("tool_calls") or []
        messages.append({k: v for k, v in msg.items() if k in ("role", "content", "tool_calls")} | {"role": "assistant"})
        if not calls:
            messages.append({"role": "user", "content": "Call submit_brief to finish."})
            continue
        for c in calls:
            name = c["function"]["name"]
            try:
                args = json.loads(c["function"].get("arguments") or "{}")
                result = registry[name][1](run, **args) if name in registry else f"Unknown tool {name}."
            except Exception as e:  # malformed args / tool failure: tell the model, let it recover
                result = f"Tool error: {str(e)[:200]}"
            run.trace.append({"step": step + 1, "tool": name, "args": c["function"].get("arguments", ""),
                              "result": result[:600]})
            messages.append({"role": "tool", "tool_call_id": c["id"], "content": result})
        if run.brief:
            break
    if run.brief is None:
        run.brief = {"summary": "Agent did not produce a brief.", "vendor_profile": "unknown", "decision_maker": "unknown",
                     "recommended_opening_ask_pct": 10.0, "watch_outs": [],
                     "tactics": [{"tactic": "competing_quote", "why": "Fallback default.", "confidence": 0.1}]}
    return {"vendor_id": vendor["id"], "use_memory": use_memory, "brief": run.brief, "citations": run.citations,
            "trace": run.trace, "latency_ms": int((time.time() - t0) * 1000)}
