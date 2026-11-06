"""Chat over the whole vendor memory: a tool-calling agent that searches Hindsight across vendors,
reads scoreboards and playbooks, and answers with citations. Same loop shape as agent.make_brief."""
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from . import config, llm, memory
from .agent import benchmarks, t_scoreboard  # noqa: F401  (benchmarks reused for market questions)
from .sim import TACTICS

MAX_STEPS = 6


@dataclass
class Ctx:
    bank_id: str
    vendors: dict[str, dict]
    history: list[dict]
    scope: str | None = None  # vendor_id the user pinned in the UI, if any
    citations: list[dict] = field(default_factory=list)
    trace: list[dict] = field(default_factory=list)

    def cite(self, text: str, kind: str, date: str | None, vendor: str | None) -> str:
        cid = f"m{len(self.citations) + 1}"
        self.citations.append({"id": cid, "text": text, "kind": kind, "date": date, "vendor": vendor})
        return cid

    def resolve(self, ref: str | None) -> dict | None:
        """Vendor by id, exact name or unambiguous name fragment ('kestrel')."""
        if not ref:
            return self.vendors.get(self.scope) if self.scope else None
        ref_l = ref.strip().lower()
        if ref_l in self.vendors:
            return self.vendors[ref_l]
        hits = [v for v in self.vendors.values() if ref_l in v["name"].lower() or v["name"].lower() in ref_l]
        return hits[0] if len(hits) == 1 else None


def _vname(ctx: Ctx, vid: str | None) -> str:
    return ctx.vendors[vid]["name"] if vid in ctx.vendors else "unknown vendor"


def c_search(ctx: Ctx, query: str, vendor: str | None = None, **_) -> str:
    v = ctx.resolve(vendor) if (vendor or ctx.scope) else None
    if vendor and v is None:
        return f"No vendor matches '{vendor}'. Use list_vendors to see valid names."
    hits = memory.recall_bank(ctx.bank_id, query, v["id"] if v else None, limit=10)
    if not hits:
        return "No matching memories."
    return "\n".join(f"[{ctx.cite(h['text'], h['kind'], h['date'], _vname(ctx, h['vendor_id']))}] "
                     f"({_vname(ctx, h['vendor_id'])}, {h['kind']}{', ' + h['date'] if h['date'] else ''}) {h['text']}"
                     for h in hits)


def c_scoreboard(ctx: Ctx, vendor: str | None = None, **_) -> str:
    v = ctx.resolve(vendor)
    if v is None:
        return "Name a vendor (see list_vendors)."
    sb = memory.tactic_scoreboard(ctx.bank_id, v["id"], TACTICS)
    if not sb["episodes"]:
        return f"No recorded negotiations with {v['name']}."
    rows = [f"- {t}: {r['tries']} tries, outcomes {r['outcomes']}, best {max(r['discounts'] or [0]) * 100:.1f}%"
            for t, r in sorted(sb["board"].items(), key=lambda kv: -max(kv[1]["discounts"] or [0]))]
    text = f"{v['name']} tactic scoreboard ({sb['episodes']} negotiations):\n" + "\n".join(rows) \
        + "\nUntried: " + (", ".join(sb["untried"]) or "none")
    return f"[{ctx.cite(text, 'fact', None, v['name'])}] {text}"


def c_playbook(ctx: Ctx, vendor: str | None = None, **_) -> str:
    v = ctx.resolve(vendor)
    if v is None:
        return "Name a vendor (see list_vendors)."
    pb = memory.playbook(ctx.bank_id, v["id"])
    return f"[{ctx.cite(pb, 'mental_model', None, v['name'])}] {v['name']} playbook:\n{pb}" if pb \
        else f"No playbook yet for {v['name']}."


def c_sweep(ctx: Ctx, query: str, per_vendor: int = 3, **_) -> str:
    """Run the same search inside EVERY vendor so a cross-vendor question gets coverage, not just the top hits."""
    per_vendor = max(1, min(int(per_vendor or 3), 5))
    def one(v):
        return v, memory.recall_bank(ctx.bank_id, query, v["id"], limit=per_vendor)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(one, ctx.vendors.values()))
    lines = []
    for v, hits in results:
        for h in hits:
            lines.append(f"[{ctx.cite(h['text'], h['kind'], h['date'], v['name'])}] ({v['name']}"
                         f"{', ' + h['date'] if h['date'] else ''}) {h['text']}")
    return "\n".join(lines) or "No matching memories in any vendor."


def c_stats(ctx: Ctx, **_) -> str:
    """Exact cross-vendor counts of tactic outcomes, aggregated from structured episode metadata."""
    def one(v):
        return v, memory.tactic_scoreboard(ctx.bank_id, v["id"], TACTICS)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(one, ctx.vendors.values()))
    totals: dict[str, dict] = {}
    for v, sb in results:
        for tactic, row in sb["board"].items():
            t = totals.setdefault(tactic, {"tries": 0, "won": 0, "partial": 0, "lost": 0, "lost_with": {}, "won_with": {}})
            for o in row["outcomes"]:
                t["tries"] += 1
                if o in ("won", "partial", "lost"):
                    t[o] += 1
                if o == "lost":
                    t["lost_with"][v["name"]] = t["lost_with"].get(v["name"], 0) + 1
                if o == "won":
                    t["won_with"][v["name"]] = t["won_with"].get(v["name"], 0) + 1
    n = sum(sb["episodes"] for _, sb in results)
    lines = [f"- {t}: {d['tries']} tries; won {d['won']}, partial {d['partial']}, lost {d['lost']}; "
             f"lost with {sorted(d['lost_with'].items(), key=lambda kv: -kv[1]) or 'none'}; "
             f"won with {sorted(d['won_with'].items(), key=lambda kv: -kv[1]) or 'none'}"
             for t, d in sorted(totals.items(), key=lambda kv: -kv[1]["lost"])]
    text = f"Exact outcome counts over {n} recorded negotiations across {len(ctx.vendors)} vendors:\n" + "\n".join(lines)
    return f"[{ctx.cite(text, 'fact', None, None)}] {text}"


def c_list(ctx: Ctx, **_) -> str:
    return "\n".join(f"- {v['name']} ({v['id']}), {v['category']}" for v in ctx.vendors.values())


def c_market(ctx: Ctx, category: str | None = None, **_) -> str:
    b = benchmarks()
    if category:
        hit = next((k for k in b if category.lower() in k.lower()), None)
        return json.dumps({hit: b[hit]}) if hit else f"Unknown category. Known: {', '.join(b)}"
    return json.dumps(b)


def _spec(name, desc, props, required):
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {
        "type": "object", "properties": props, "required": required}}}


VENDOR_P = {"vendor": {"type": "string", "description": "Vendor name or id (fragments like 'kestrel' work)"}}
TOOLS = {
    "search_memory": (_spec("search_memory", "Semantic search over negotiation memory. Searches ALL vendors unless "
                            "'vendor' is given. Use for any question about what happened, who, when, why. Try several "
                            "phrasings if the first search is thin.", {"query": {"type": "string"}, **VENDOR_P},
                            ["query"]), c_search),
    "search_each_vendor": (_spec("search_each_vendor", "Run the SAME search inside every vendor and return the best hits "
                                 "per vendor. Use for 'which vendors...' questions so no vendor is missed.",
                                 {"query": {"type": "string"}, "per_vendor": {"type": "integer"}}, ["query"]), c_sweep),
    "cross_vendor_stats": (_spec("cross_vendor_stats", "EXACT counts of wins/partials/losses per tactic across all "
                                 "vendors, with which vendors they happened with. Use for any 'how many / most / "
                                 "least / which tactic works or fails' question - never estimate these.", {}, []), c_stats),
    "vendor_scoreboard": (_spec("vendor_scoreboard", "Per-tactic tries, outcomes and best discount for one vendor.",
                                VENDOR_P, ["vendor"]), c_scoreboard),
    "vendor_playbook": (_spec("vendor_playbook", "Hindsight's standing negotiation playbook for one vendor.",
                              VENDOR_P, ["vendor"]), c_playbook),
    "list_vendors": (_spec("list_vendors", "All vendors with ids and categories.", {}, []), c_list),
    "market_benchmarks": (_spec("market_benchmarks", "Real public-sector award benchmarks by spend category.",
                                {"category": {"type": "string"}}, []), c_market),
}

SYSTEM = ("You are Precedent's assistant for a procurement team. Answer questions about vendors and past negotiations "
          "using your tools; the memory is the only source of truth about vendors. Rules: search before answering. "
          "For questions that count or rank (how many, most, least, which tactic) call cross_vendor_stats. For 'which "
          "vendors...' questions call search_each_vendor so no vendor is missed. Never claim a list is complete or "
          "that 'no other' vendors have something unless a sweep covered every vendor; otherwise say 'in the memories "
          "I found'. Cite evidence inline like [m3]; if memory has nothing "
          "relevant say so plainly, never guess or invent history, names or numbers; keep answers short, use bullet "
          "points for lists, and name the vendor each fact belongs to. If the user pinned a vendor scope, stay within "
          "it. Tactics are: " + ", ".join(TACTICS) + ". At most %d tool rounds." % (MAX_STEPS - 1))


NO_MEMORY_TOOLS = {"list_vendors", "market_benchmarks"}
SYSTEM_NO_MEMORY = ("You are Precedent's assistant for a procurement team, running with memory switched OFF. You have NO "
                    "access to any record of past negotiations, calls, outcomes or vendor behaviour. You can only list the "
                    "vendors and read real public-sector award benchmarks. Answer from general procurement knowledge, and "
                    "whenever a question needs vendor-specific history say plainly that you have no memory of it; never "
                    "invent names, dates, tactics, outcomes or numbers about a specific vendor. Keep answers short. "
                    "At most %d tool rounds." % (MAX_STEPS - 1))


def chat(bank_id: str, vendors: dict[str, dict], messages: list[dict], scope: str | None = None,
         use_memory: bool = True) -> dict:
    t0 = time.time()
    ctx = Ctx(bank_id=bank_id, vendors=vendors, history=messages, scope=scope if scope in vendors else None)
    convo = [{"role": "system", "content": SYSTEM + (f" Pinned vendor scope: {vendors[ctx.scope]['name']}." if ctx.scope else "")}]
    convo += [{"role": m["role"], "content": str(m["content"])[:4000]} for m in messages[-8:]
              if m.get("role") in ("user", "assistant") and m.get("content")]
    # Memory OFF removes every tool that reads Hindsight; same model, loop and step limit otherwise.
    tools = TOOLS if use_memory else {k: v for k, v in TOOLS.items() if k in NO_MEMORY_TOOLS}
    if not use_memory:
        convo[0]["content"] = SYSTEM_NO_MEMORY
    specs = [s for s, _ in tools.values()]
    answer = ""
    for step in range(MAX_STEPS):
        if step == MAX_STEPS - 1:
            convo.append({"role": "user", "content": "Answer now with what you have found."})
        msg = llm.chat_message(convo, None if step == MAX_STEPS - 1 else specs, max_tokens=900)
        calls = msg.get("tool_calls") or []
        if not calls:
            answer = (msg.get("content") or "").strip()
            break
        convo.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        for c in calls:
            name = c["function"]["name"]
            try:
                args = json.loads(c["function"].get("arguments") or "{}")
                result = tools[name][1](ctx, **args) if name in tools else f"Unknown tool {name}."
            except Exception as e:  # tell the model, let it recover
                result = f"Tool error: {str(e)[:200]}"
            ctx.trace.append({"step": step + 1, "tool": name, "args": c["function"].get("arguments", ""),
                              "result": result[:600]})
            convo.append({"role": "tool", "tool_call_id": c["id"], "content": result})
    used = set(re.findall(r"\[(m\d+)\]", answer))
    cites = [c for c in ctx.citations if c["id"] in used] or ctx.citations[:6]
    return {"answer": answer or "I couldn't produce an answer.", "use_memory": use_memory, "citations": cites if use_memory else [],
            "trace": ctx.trace,
            "latency_ms": int((time.time() - t0) * 1000)}
