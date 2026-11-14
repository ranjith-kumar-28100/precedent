import json
import random
import threading
import time
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import agent, chat as chat_mod, config, llm, memory, sim

app = FastAPI(title="Precedent")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _load(name):
    return json.loads((config.DATA_DIR / name).read_text())


CUSTOM_VENDORS = config.DATA_DIR / "custom_vendors.json"  # vendors added from the UI


def _load_custom() -> list[dict]:
    try:
        data = json.loads(CUSTOM_VENDORS.read_text())
        return [v for v in data if isinstance(v, dict) and "id" in v] if isinstance(data, list) else []
    except (OSError, ValueError):
        return []  # missing or corrupt: start without custom vendors


def _load_vendors() -> dict[str, dict]:
    return {v["id"]: v for v in _load("vendors.json") + _load_custom()}


def _save_custom(vendors: list[dict]) -> None:
    tmp = CUSTOM_VENDORS.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(vendors, indent=2))
    tmp.replace(CUSTOM_VENDORS)  # atomic: a crash never leaves a half-written file


VENDORS = _load_vendors()
HISTORY = _load("history.json")
UPCOMING = _load("upcoming.json")
JOBS: dict[str, dict] = {}
CACHE = config.DATA_DIR / "eval_cache.json"


def vendor_or_404(vid: str) -> dict:
    if vid not in VENDORS:
        raise HTTPException(404, "unknown vendor")
    return VENDORS[vid]


def public(v: dict) -> dict:  # never leak the hidden simulator profile
    return {k: v[k] for k in ("id", "name", "category", "contact", "list_price_usd_annual")}


@app.get("/api/health")
def health():
    try:
        memory.client().get_version()
        ok = True
    except Exception:
        ok = False
    return {"hindsight": ok, "bank_id": config.BANK_ID, "llm": config.LLM_MODEL, "llm_calls": llm.CALLS["agent"],
            "agent_spend_usd": round(llm.SPEND["usd"], 3), "agent_budget_usd": llm.BUDGET_USD,
            "ledger_counts": memory.ledger_counts(), "bank_stats": memory.bank_stats(config.BANK_ID) if ok else None}


@app.get("/api/vendors")
def vendors():
    n = {}
    for e in HISTORY:
        n[e["vendor_id"]] = n.get(e["vendor_id"], 0) + 1
    return [{**public(v), "episodes": n.get(v["id"], 0)} for v in VENDORS.values()]


class VendorReq(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    category: str = Field(min_length=2, max_length=60)
    contact: str = Field("unknown", max_length=120)
    list_price_usd_annual: int = Field(gt=0, le=1_000_000_000)
    notes: str = Field("", max_length=1000)  # what we already know about the vendor

    @field_validator("name", "category", "contact", "notes", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v


def _next_id() -> str:
    nums = [int(k[1:]) for k in VENDORS if k[:1] == "v" and k[1:].isdigit()]
    return f"v{max(nums, default=0) + 1:02d}"


_ADD_LOCK = threading.Lock()  # concurrent adds must not get the same id


@app.post("/api/vendors")
def add_vendor(req: VendorReq):
    with _ADD_LOCK:
        return _add_vendor(req)


def _add_vendor(req: VendorReq) -> dict:
    from datetime import date
    if req.name.lower() in {v["name"].strip().lower() for v in VENDORS.values()}:
        raise HTTPException(409, "vendor already exists")
    vid = _next_id()
    v = {"id": vid, "name": req.name, "category": req.category, "contact": req.contact or "unknown",
         "list_price_usd_annual": req.list_price_usd_annual, "added": date.today().isoformat()}
    memory.ensure_playbook(config.BANK_ID, vid, v["name"])
    try:
        memory.retain_profile(config.BANK_ID, v, req.notes, date.today().isoformat())
    except Exception as e:  # not in memory -> not added, so the UI never shows a vendor Hindsight lacks
        raise HTTPException(502, f"could not save vendor to memory: {type(e).__name__}: {e}")
    VENDORS[vid] = v
    _save_custom([x for x in VENDORS.values() if "hidden" not in x])
    return {**public(v), "episodes": 0}


@app.get("/api/upcoming")
def upcoming():
    """Calendar deals, plus a first deal for every vendor added from the UI (so it has a card on the Brief page)."""
    from datetime import date, timedelta
    have = {u["vendor_id"] for u in UPCOMING}
    extra = [{"vendor_id": v["id"], "objective": f"First negotiation with {v['name']}: open at 18% off list",
              "context": "New vendor: no negotiation history on record yet.",
              "deadline": (date.fromisoformat(v.get("added") or date.today().isoformat()) + timedelta(days=30)).isoformat()}
             for v in VENDORS.values() if "hidden" not in v and v["id"] not in have]
    return UPCOMING + extra


class BriefReq(BaseModel):
    vendor_id: str
    objective: str
    context: str = ""
    use_memory: bool = True


@app.post("/api/brief")
def brief(req: BriefReq):
    v = vendor_or_404(req.vendor_id)
    try:
        return agent.make_brief(config.BANK_ID, v, req.objective, req.context, req.use_memory)
    except Exception as e:
        raise HTTPException(502, f"brief failed: {type(e).__name__}: {e}")


class OutcomeReq(BaseModel):
    vendor_id: str
    tactic_used: str
    ask_discount: float
    final_discount: float
    outcome: str
    notes: str = ""
    date: str | None = None


@app.post("/api/outcome")
def outcome(req: OutcomeReq):
    from datetime import date
    v = vendor_or_404(req.vendor_id)
    ep = req.model_dump() | {"date": req.date or date.today().isoformat(), "buyer": "our team"}
    memory.ensure_playbook(config.BANK_ID, v["id"], v["name"])
    memory.retain_episode(config.BANK_ID, ep, v)
    HISTORY.append(ep | {"vendor_id": v["id"]})
    return {"retained": True}


@app.get("/api/memory/{vendor_id}")
def memory_view(vendor_id: str):
    vendor_or_404(vendor_id)
    view = memory.vendor_memory_view(config.BANK_ID, vendor_id)
    view["episodes"] = sorted((e for e in HISTORY if e["vendor_id"] == vendor_id), key=lambda e: e["date"])
    return view


class ChatMsg(BaseModel):
    role: str
    content: str


class ChatReq(BaseModel):
    messages: list[ChatMsg]
    vendor_id: str | None = None
    use_memory: bool = True


@app.post("/api/chat")
def chat_endpoint(req: ChatReq):
    if not req.messages or req.messages[-1].role != "user":
        raise HTTPException(400, "last message must be from the user")
    try:
        return chat_mod.chat(config.BANK_ID, VENDORS, [m.model_dump() for m in req.messages], req.vendor_id,
                              req.use_memory)
    except llm.BudgetExceeded as e:
        raise HTTPException(402, str(e))
    except Exception as e:
        raise HTTPException(502, f"chat failed: {type(e).__name__}: {e}")


# ---- learning-curve evaluation -------------------------------------------------------------
class EvalReq(BaseModel):
    episodes: int = 10
    vendors: int = 3
    fresh: bool = False  # True only works when ALLOW_FRESH_EVAL=1 (a fresh run costs real money)


def _retry(fn, tries=3):
    for i in range(tries):
        try:
            return fn()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(8 * (i + 1))


def _run_eval(job_id: str, episodes: int, n_vendors: int):
    job = JOBS[job_id]
    try:
        _eval_loop(job, job_id, episodes, n_vendors)
        job["status"], job["progress"] = "done", 1.0
        CACHE.write_text(json.dumps({"episodes": episodes, "vendors": n_vendors, "series": job["series"]}))
    except Exception as e:  # never leave a job "running" forever
        job["status"], job["error"] = "error", f"{type(e).__name__}: {e}"


def _eval_loop(job, job_id, episodes, n_vendors):
    bank = f"precedent-eval-{job_id}"
    memory.ensure_bank(bank)
    ids = [k for k, v in VENDORS.items() if "hidden" in v][:n_vendors]  # simulator vendors only
    rng = random.Random(7)
    series = job["series"]
    total = episodes * len(ids)
    done = 0
    for ep_i in range(1, episodes + 1):
        row = {"memory": [], "baseline": []}
        for vid in ids:
            v = VENDORS[vid]
            obj = f"Renew {v['category']} contract at the best price"
            for arm in ("memory", "baseline"):
                b = _retry(lambda: agent.make_brief(bank, v, obj, use_memory=(arm == "memory")))
                top = b["brief"]["tactics"][0]["tactic"]
                ask = max(0.02, min(0.6, b["brief"]["recommended_opening_ask_pct"] / 100))
                r = sim.respond(v["hidden"], top, ask, rng)
                row[arm].append((sim.savings_pct(v["hidden"], r["final_discount"]), r["outcome"] == "won"))
                if arm == "memory":
                    _retry(lambda: memory.ensure_playbook(bank, vid, v["name"]))
                    _retry(lambda: memory.retain_episode(bank, {
                        "date": f"2026-{(ep_i - 1) % 12 + 1:02d}-15", "buyer": "sim buyer", "tactic_used": top,
                        "ask_discount": ask, "final_discount": r["final_discount"], "outcome": r["outcome"],
                        "notes": r["notes"]}, v))
            done += 1
            job["progress"] = done / total
        for arm in row:
            series[arm].append({"episode": ep_i,
                                "savings_pct": round(sum(s for s, _ in row[arm]) / len(row[arm]), 1),
                                "won": sum(w for _, w in row[arm])})
        (config.DATA_DIR / "eval_partial.json").write_text(json.dumps(series))  # checkpoint


@app.post("/api/eval/run")
def eval_run(req: EvalReq):
    job_id = uuid.uuid4().hex[:8]
    if req.fresh and config.env("ALLOW_FRESH_EVAL") != "1":
        if not CACHE.exists():
            raise HTTPException(403, "fresh evaluation disabled (set ALLOW_FRESH_EVAL=1 to spend LLM budget)")
        req.fresh = False
    if not req.fresh and CACHE.exists():
        JOBS[job_id] = {"status": "done", "progress": 1.0, "series": json.loads(CACHE.read_text())["series"]}
        return {"job_id": job_id}
    JOBS[job_id] = {"status": "running", "progress": 0.0, "series": {"memory": [], "baseline": []}}
    threading.Thread(target=_run_eval, args=(job_id, req.episodes, req.vendors), daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/eval/cached")
def eval_cached():
    partial = config.DATA_DIR / "eval_partial.json"
    if CACHE.exists():
        return json.loads(CACHE.read_text()) | {"status": "done"}
    if partial.exists():  # an interrupted run: show what finished
        return {"status": "partial", "series": json.loads(partial.read_text())}
    raise HTTPException(404, "no cached evaluation yet")


@app.get("/api/eval/{job_id}")
def eval_status(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "unknown job")
    return JOBS[job_id]


@app.get("/api/directives")
def get_directives():
    return memory.directives(config.BANK_ID)


@app.get("/api/ledger")
def ledger(limit: int = 100):
    return {"counts": memory.ledger_counts(), "ops": memory.ledger(limit)}


@app.get("/api/memory/{vendor_id}/playbook/history")
def playbook_history(vendor_id: str):
    vendor_or_404(vendor_id)
    return memory.playbook_history(config.BANK_ID, vendor_id)


class RecallReq(BaseModel):
    query: str
    vendor_id: str | None = None
    as_of: str | None = None
    limit: int = 15


@app.post("/api/memory/recall")
def memory_recall(req: RecallReq):
    if req.vendor_id:
        vendor_or_404(req.vendor_id)
    return memory.explore_recall(config.BANK_ID, req.query, req.vendor_id, req.as_of, req.limit)


DIST = config.WEB_DIR / "dist"
if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/legacy")
def legacy():
    return FileResponse(config.WEB_DIR / "index.html")


@app.get("/{path:path}")
def index(path: str = ""):
    """The React build when present (any non-API path falls through to it for client-side routing),
    otherwise the original single-file dashboard."""
    if path.startswith("api/"):
        raise HTTPException(404)
    if (DIST / "index.html").exists():
        f = (DIST / path).resolve()
        inside = f.is_relative_to(DIST.resolve())
        return FileResponse(f if path and inside and f.is_file() else DIST / "index.html")
    return FileResponse(config.WEB_DIR / "index.html")
