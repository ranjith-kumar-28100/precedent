# Architecture

## System

```mermaid
flowchart LR
  subgraph Clients
    UI[Dashboard<br/>web/index.html]
    subgraph Band[Band room: band_agents/]
      Scout
      Negotiator
      Ledger
    end
  end

  subgraph API[FastAPI app/main.py :8000]
    Brief[/api/brief/]
    Outcome[/api/outcome/]
    MemView[/api/memory/]
    Eval[/api/eval/]
  end

  subgraph Agent[app/agent.py make_brief]
    Loop[Tool-calling loop<br/>max 7 steps]
    MT[Memory tools:<br/>recall_memory, get_playbook,<br/>reflect_on_vendor]
    BT[Base tools:<br/>market_benchmarks, submit_brief]
  end

  Sim[app/sim.py<br/>hidden vendor profiles]
  Bench[(data/market_benchmarks.json<br/>Estonian procurement register)]
  Seed[scripts/seed.py<br/>data/history.json]

  subgraph HS[Hindsight server :8888]
    Bank[(Bank: facts tagged vendor:id)]
    Obs[Observations]
    MM[Mental models<br/>playbook-vendor]
  end

  AzureAgent[Azure OpenAI<br/>gpt-4.1]
  AzureMini[Azure OpenAI<br/>gpt-4.1-mini]

  UI --> API
  Negotiator --> Brief
  Ledger --> Outcome
  Ledger --> MemView
  Scout --> Bench
  Brief --> Loop
  Loop <--> AzureAgent
  Loop --> MT
  Loop --> BT
  MT -->|app/memory.py| HS
  BT --> Bench
  Outcome -->|retain_episode| Bank
  MemView --> HS
  Eval --> Loop
  Eval --> Sim
  Eval -->|fresh eval bank| HS
  Seed -->|retain_episode| Bank
  Bank -->|consolidation| Obs
  Obs -->|refresh_after_consolidation| MM
  HS <-->|extraction, consolidation| AzureMini
```

## One memory-ON brief, then outcome logging

```mermaid
sequenceDiagram
  participant U as Dashboard / Band
  participant A as FastAPI
  participant G as Agent loop (gpt-4.1)
  participant M as app/memory.py
  participant H as Hindsight
  participant L as gpt-4.1-mini

  U->>A: POST /api/brief {vendor, objective, use_memory: true}
  A->>G: make_brief
  loop up to 7 steps
    G->>M: get_playbook / recall_memory(query) / market_benchmarks
    M->>H: get_mental_model, recall (tags=vendor:id, any_strict)
    H-->>M: playbook, observations, facts
    M-->>G: results with ids m1, m2, ...
  end
  G->>A: submit_brief (tactics cite [mN])
  A-->>U: brief, citations, trace, latency_ms

  Note over U,H: after the negotiation
  U->>A: POST /api/outcome {vendor, tactic, ask, final, outcome, notes}
  A->>M: retain_episode
  M->>H: retain(tags vendor:id, category:...)
  H->>L: extract facts
  H->>L: consolidate observations
  H->>H: refresh playbook mental model
  U->>A: next POST /api/brief
  Note over G,H: recall and playbook now include the new outcome
```

## Evaluation loop

For each episode and vendor, `_eval_loop` in `app/main.py` runs the memory-ON and memory-OFF agents against a fresh bank, applies each arm's top tactic and ask through `sim.respond` (using the hidden profile), records `savings_pct` (discount / hidden floor), and retains only the memory arm's outcome so later episodes can use it.
