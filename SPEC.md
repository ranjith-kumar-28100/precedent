# Precedent — procurement negotiation copilot with Hindsight memory

A buyer-side agent that preps procurement negotiations. It remembers every vendor interaction
(calls, emails, quotes, outcomes) in a Hindsight bank, learns each vendor's real behaviour
(opening tactics, when they concede, who actually decides) and which of OUR tactics worked,
then produces a negotiation brief that cites the memories behind each recommendation.

## Components
- `app/` FastAPI backend + Hindsight client (owner: main)
- `data/` realistic synthetic dataset (owner: data agent)
- `web/index.html` single-file dashboard, no build step (owner: frontend agent)
- `.env` all model/server config (see `.env.example`)

## Domain model
Vendor categories: SaaS licences, freight/logistics, raw materials, contract manufacturing, facilities services.
Each vendor has a HIDDEN behaviour profile (used only by the simulator, never given to the agent):
- `list_markup`: how inflated the opening quote is (e.g. 0.18 = 18% above their floor)
- `floor_discount`: the max discount they will ever give vs list (e.g. 0.22)
- `works`: the buyer tactic that moves them (`competing_quote` | `volume_commit` | `multi_year` | `quarter_end_timing` | `bundle` | `escalate_to_exec` | `payment_terms`)
- `fails`: a tactic that backfires (they harden)
- `decision_maker`: role that really approves discounts
- `quirk`: free-text habit (e.g. "always sends revised quote 2 days before quarter end")

Tactics list is exactly the 7 above.

## Data files (data/)
- `vendors.json`: list of 12 vendors: `{id, name, category, contact, list_price_usd_annual, hidden:{...profile above}}`
- `history.json`: per vendor 4-8 past negotiation episodes, dated over the last 18 months, each
  `{vendor_id, date, buyer, tactic_used, ask_discount, final_discount, outcome("won"|"partial"|"lost"), notes (2-4 realistic sentences of call/email notes mentioning names, numbers, quirks), decision_maker_seen}`
  The notes must be consistent with the hidden profile (they are how the agent can infer it) but NOT state it
  outright. Include 2-3 contradictions/changes over time (e.g. vendor changes decision maker after an acquisition).
- `upcoming.json`: 6 upcoming negotiations `{vendor_id, objective, context, deadline}` for demos.
All names/numbers real-sounding. Deterministic (seeded) generation script `data/generate.py` is optional;
the committed JSON files are what matter.

## Backend API (JSON, CORS open, base `/api`)
- `GET /api/vendors` -> `[{id,name,category,list_price_usd_annual,episodes:int}]`
- `GET /api/upcoming` -> upcoming.json
- `POST /api/brief` body `{vendor_id, objective, context?, use_memory:bool}` ->
  `{vendor_id, use_memory, brief:{summary, vendor_profile, recommended_opening_ask_pct, tactics:[{tactic,why,confidence}], watch_outs:[str], decision_maker}, citations:[{id,text,kind("fact"|"observation"|"mental_model"),date?}], latency_ms}`
- `POST /api/outcome` body `{vendor_id, tactic_used, ask_discount, final_discount, outcome, notes}` -> `{retained:true}` (retains into the bank)
- `GET /api/memory/{vendor_id}` -> `{observations:[{text,proof_count}], mental_model:str|null, facts:int}`
- `POST /api/eval/run` body `{episodes:int=12, vendors:int=4}` -> starts job `{job_id}`
- `GET /api/eval/{job_id}` -> `{status("running"|"done"), progress:0-1, series:{memory:[{episode,savings_pct,won}], baseline:[...]}}`
  `savings_pct` = discount achieved as % of that vendor's maximum possible (floor_discount); averaged per episode index across vendors.
- `GET /api/health` -> `{hindsight:bool, llm:str}`

## Frontend (web/index.html)
Single static file served at `/` by the backend. Vanilla JS + inline CSS; may use Chart.js from cdnjs.
Views (tabs): 1) **Brief** — pick upcoming negotiation, memory ON/OFF toggle, run, show brief with
clickable citations side panel ("memories recalled"), and a side-by-side compare button (runs both, shows the two briefs).
2) **Learning curve** — run eval, live-updating line chart memory vs baseline savings% by episode.
3) **Vendor memory** — per vendor observations + mental model + episode timeline, and a "log outcome" form.
Polished, dark/light via prefers-color-scheme, responsive. Must degrade gracefully with fetch errors (show message).

## Config (.env)
Azure OpenAI v1: `LLM_MODEL` (gpt-4.1 deployment), `LLM_BASE_URL`, `LLM_API_KEY` for the agent; `HINDSIGHT_API_LLM_*` (gpt-4.1-mini deployment) for Hindsight;
`HINDSIGHT_URL`, `HINDSIGHT_BANK_ID`; spend guards `AGENT_BUDGET_USD`, `ALLOW_FRESH_EVAL`.
