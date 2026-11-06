# Precedent on Band: Scout, Negotiator, Ledger

Three deterministic (no-LLM) Band agents in one room, sharing the Precedent backend:

| Agent | Command | What it does |
|---|---|---|
| Scout | `@Scout benchmarks for SaaS licences` | Real public-award benchmarks from `../data/market_benchmarks.json` |
| Negotiator | `@Negotiator brief <vendor name or id> [memory off]` | Calls `POST /api/brief`, posts brief + cited memories |
| Ledger | `@Ledger log <vendor> tactic=<t> ask=<pct> got=<pct> outcome=<won\|partial\|lost> <notes>` | Calls `POST /api/outcome` (retained into Hindsight) |
| Ledger | `@Ledger memory <vendor>` | Shows observations from `GET /api/memory/{id}` |

Tactics: competing_quote, volume_commit, multi_year, quarter_end_timing, bundle, escalate_to_exec, payment_terms.

## Setup
1. Start the Precedent backend (and Hindsight) from the parent project so `http://localhost:8000/api/vendors` responds. Override with `PRECEDENT_API=http://host:port`.
2. Sign up / log in at https://app.band.ai.
3. Open **Agents**, click **Connect remote agent**. Do this 3 times, naming them exactly **Scout**, **Negotiator**, **Ledger**. For each, copy the **ID** and **API Key** (the key is shown once).
4. `cd band_agents && cp agent_config.example.yaml agent_config.yaml` and paste the three ID/key pairs (keys `scout`, `negotiator`, `ledger` must stay as is). This file is git-ignored.
5. `uv sync`
6. `uv run pytest` (offline unit tests)
7. `uv run python run.py` and wait for the "Agent started" log lines.
8. In Band **Rooms**, click **+** to create a room and add Scout, Negotiator and Ledger.

## Try it in the room
```
@Scout benchmarks for SaaS licences
@Negotiator brief Northwind Cloudworks
@Negotiator brief v01 memory off
@Ledger log Northwind tactic=multi_year ask=15 got=9 outcome=partial CFO agreed only after quarter end
@Ledger memory Northwind
@Negotiator brief Northwind
```
The last brief should now cite the outcome you just logged. Agents only respond when @mentioned.

## Layout
- `precedent_band/commands.py` pure parsing/formatting/dispatch (tested, no network)
- `precedent_band/api.py` httpx client; `precedent_band/wiring.py` Band LangGraph glue
- `run.py` starts all three in one asyncio process; exits with a clear message if `agent_config.yaml` is missing
