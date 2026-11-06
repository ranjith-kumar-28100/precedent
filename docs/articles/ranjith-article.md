# My Agent's Memory Worked. My Prompt Was the Bug (Hindsight)

For seven episodes in a row, my negotiation agent with memory did no better than the one without it. The memory was fine. Recall returned the right notes. The bug was one sentence I had written in the system prompt: open your ask "near the best discount this vendor has ever given."

This post is about what I learned wiring [Hindsight](https://github.com/vectorize-io/hindsight) into a procurement agent, and a belief I now hold more firmly: agent memory needs a policy you can state and evidence you can audit. Retrieval alone gives you neither.

## What Precedent does

Precedent is a buyer-side negotiation copilot. Before a vendor renewal it produces a brief: ranked tactics, an opening ask, and watch-outs, with each claim citing the memory behind it. The stack is a FastAPI backend, a single-file dashboard, a Hindsight server, and an LLM (gpt-4.1 for the agent, a smaller gpt-4.1-mini for Hindsight's background extraction and consolidation).

I chose [Hindsight's agent memory](https://hindsight.vectorize.io/) over a plain vector store because I wanted fact extraction from messy notes, consolidation into beliefs that update, and tag-scoped recall without building that pipeline myself. If you want the background, Vectorize has a good explainer on [what agent memory is](https://vectorize.io/what-is-agent-memory).


## Retaining with tags and metadata

Every episode goes into one bank, tagged `vendor:<id>` and `category:<c>`. The bank has a retain mission and an observations mission describing what to extract. I also attach structured metadata at retain time, which turned out to matter later:

```python
def retain_episode(bank_id: str, ep: dict, vendor: dict) -> None:
    client().retain(bank_id=bank_id, content=episode_text(ep, vendor),
                    timestamp=ep["date"], context="Buyer-side negotiation record",
                    tags=[vtag(vendor["id"]), f"category:{vendor['category']}"],
                    document_id=f"ep-{vendor['id']}-{ep['date']}-{ep['tactic_used']}",
                    metadata={"tactic": ep["tactic_used"], "outcome": ep["outcome"],
                              "final_discount": f"{ep['final_discount']:.3f}",
                              "ask_discount": f"{ep['ask_discount']:.3f}",
                              "date": ep["date"]})
```

Hindsight returns that metadata on the facts it recalls, and facts from one episode share a `document_id`. Each vendor also gets a mental model, a standing playbook that Hindsight refreshes after consolidation. Recall is scoped with `tags_match="any_strict"`, so a brief for one vendor cannot quote another vendor's concessions.

## Prose memories were not enough

My first setup gave the agent `recall_memory` and a playbook. With prose-only memories it explored badly. After eight episodes in that run, memory-on scored 43.3 against 33.6 for the baseline, only about 6 to 10 points ahead. The agent could not easily see what it had already tried.

So I added a `tactic_scoreboard` tool. It aggregates the structured metadata from recall, de-duplicating on `document_id`:

```python
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
    row["discounts"].append(float(md["final_discount"]))
return {"episodes": len(episodes), "board": board,
        "untried": [t for t in all_tactics if t not in board]}
```

The tool renders tries, outcomes, best discount, a PROVEN, FAILED or MIXED verdict per tactic, and the list of untried tactics. The agent's other memory tools are `get_playbook` and a sparing `reflect_on_vendor`. Every recalled item gets an id like `[m3]`, the model must cite those ids in `submit_brief`, and the UI makes them clickable.


## The bug was mine

Here is the ask rule I originally wrote: "Set the opening ask near the best discount this vendor has ever given." It sounds sensible. It was a death spiral.

Early asks were around 8%. The winning tactic for Northwind, a competing quote, was tried four times, and each time it "lost" because the ask was tiny. Lower results then pushed the next ask lower. Worse, it confounded learning: a good tactic looks like it failed if you under-ask with it. In that run memory-on sat at 21 to 34% against 10 to 34% for the baseline, with zero wins through seven episodes.

The fix is in the prompt, and the memory layer did not change:

```python
"Opening ask: if a tactic is PROVEN, open about 10%% above the best discount it has achieved; "
"otherwise open at 18%% off list. Never under-ask: a low ask makes a good tactic look like it "
"failed and poisons what we learn. "
```

The tool loop itself is plain. Memory ON versus OFF changes one line, which tools are registered:

```python
registry = {**(MEMORY_TOOLS if use_memory else {}), **BASE_TOOLS}
```

I want to be clear that 18% and +10% are procurement-convention heuristics of mine. The agent did not learn them. What memory gives it is the information to know whether a tactic is proven, and the policy tells it how to act on that.

## Results

The evaluation uses three simulated vendors (Northwind Cloudworks SaaS, Brightline CRM, Halvorsen Freight), ten negotiations each, starting from empty memory. Both agents use gpt-4.1 with the same prompt and loop. A deterministic simulator with hidden per-vendor profiles responds: the tactic that works, the one that backfires, and a maximum discount. The metric is the discount achieved as a percentage of the vendor's maximum possible, averaged over the three vendors.

| Episode | Memory ON | Memory OFF |
|---|---|---|
| 1 | 44.0 | 40.5 |
| 2 | 68.6 | 41.9 |
| 4 | 78.2 | 36.3 |
| 7 | 68.4 | 30.0 |
| 10 | 76.2 | 44.5 |

Episode 1 is a cold start for both, so they are close. Over the last five episodes the means are 75.6% with memory against 39.9% without. Counting a "win" as at least 85% of the maximum, the memory agent wins 1 of 3 vendors at episodes 2 and 3 and 2 of 3 from episode 4 on. The baseline wins 0 of 3 in all ten episodes.


A real before and after, from an earlier build, on a 420-seat Northwind Cloudworks renewal with a $391k rival quote. Memory OFF recommended `escalate_to_exec` at 0.9 confidence with a 25% opening ask. Memory ON ranked `competing_quote` first, warned "do not escalate directly to executives without leverage - this backfired previously [m7][m9]", cited 25 memories, and opened at 21%. It also took about 35 seconds against about 7. That is the price of reading the evidence.

## What went wrong along the way

**A local 8B model was unusable.** A single retain took about four minutes on Ollama, partly because the model spilled out of my 8GB GPU.

**The Groq free tier could not hold the workload.** The limits were 8K tokens per minute and roughly 200K per day on gpt-oss-120b, while one retain call used about 5.4K tokens. Loading 61 episodes plus consolidation was out of reach. I moved to Azure and split the roles: gpt-4.1-mini for Hindsight's background work, gpt-4.1 for the agent.

**The sync client binds to a thread's event loop.** Sharing one Hindsight client across FastAPI workers and evaluation threads gave "Timeout context manager should be used inside a task" and intermittent 502s. The fix is a client per thread:

```python
_local = threading.local()

def client() -> Hindsight:
    c = getattr(_local, "client", None)
    if c is None:
        c = _local.client = Hindsight(base_url=config.HINDSIGHT_URL, timeout=600.0)
    return c
```

**A laptop sleep killed a long evaluation.** The httpx read timeout ended the thread silently and the job kept showing "running". It now retries transport errors, checkpoints after each episode, and sets an explicit error status.

## Lessons

1. **Test your prompt as hard as your memory.** My own prompt was the biggest bug, and it looked like a memory failure.
2. **A good tactic can look like a bad one.** If the action's parameters (here, the ask) are under-set, the outcomes you store teach the wrong lesson.
3. **Give the agent structured views of its own history.** Prose recall was not enough. A scoreboard built from retain-time metadata let it see what it had tried.
4. **Plan for the memory pipeline's cost.** Extraction and consolidation want a cheap model and a generous rate limit, separate from the agent.
5. **Make long jobs survive failure.** Checkpoints and explicit error states beat debugging a job that says "running."

## Limits

The negotiation history is synthetic: 12 fictional vendors and 61 episodes, written to be consistent with hidden profiles. The market benchmarks are real, from Estonia's public procurement register (about 19k awards), but no public dataset contains negotiation notes or discount outcomes. The simulator rules are mine, so the curve shows the mechanism works, not real-world savings. It is one run, three vendors, no confidence intervals, and it cost about $1 of model usage. The third vendor was never solved in ten episodes. I have not investigated why in depth.

There is also a separate `band_agents` module (Scout, Negotiator, Ledger). Its unit tests pass, but I have not verified it against a live Band room.

Code: https://github.com/ranjith-kumar-28100/precedent
