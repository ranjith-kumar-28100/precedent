# How I Tested Whether Hindsight Memory Helps, Without Faking the Data

The hard part of building a negotiation agent with memory was not the memory. It was answering a plain question honestly: does the memory make the agent better, and how would I know?

My teammate wrote about wiring [Hindsight](https://github.com/vectorize-io/hindsight) into Precedent and the prompt bug we hit. I own the other half: the data and the evaluation. This post covers why the history is synthetic, what is real, how the simulator lets me measure memory, and where that measurement stops being trustworthy.

## The data problem

Precedent is a buyer-side agent. Before a vendor renewal it should recall what happened in past negotiations with that vendor: which tactic moved them, which one backfired, who actually signs. That needs a history of call notes and discount outcomes.

No public dataset has that. Procurement registers record awards, not what was said on a call or what the buyer asked for first. The tempting shortcut is to write plausible notes about real companies. I did not do that. Invented call notes about real firms are fabrication, and could say false things about them. So the vendors are fictional.

The history is 12 invented vendors and 61 episodes, hand-authored in `data/generate.py`. Each vendor carries a hidden behaviour profile:

```python
dict(list_markup=0.24, floor_discount=0.22, works="competing_quote",
     fails="escalate_to_exec", decision_maker="Regional Sales Director",
     quirk="Opens with a 'special' 5% discount that expires in 48 hours; ...")
```

The notes are written to be consistent with the profile, but never state it. The agent has to infer "competing quotes work here" from several episodes. I also put deliberate contradictions in over time. In one vendor's history, the company is acquired, the director who approved discounts leaves, and the same tactic gets a worse result until a new approver is won over. A memory system that only counts wins would miss that.

## What is real

The one real-world input is market context. `data/build_benchmarks.py` computes per-category benchmarks from Estonia's public procurement register (datahub.io, nimistu/estonia-public-procurement, 19,133 awards). For SaaS licences, selected by CPV divisions 72 and 48, that gives 1,193 awards, a median of EUR 96,097, and 53% of contracts with a single bidder. The same script computes quartiles, average bidder count and negotiated-procedure share for four other categories.

These numbers say nothing about discounts. They tell the agent that a buyer in SaaS often faces a market with one bidder, so a competing quote is a weaker threat than it sounds. The README labels them as the only real-world numbers in the project.


## A simulator with hidden profiles

Hand-written history shows the agent can read memory. It does not show that memory improves outcomes, because the agent never acts on the world. For that I need something to negotiate against. The simulator in `app/sim.py` is deterministic apart from a small seeded noise term:

```python
def respond(profile: dict, tactic: str, ask: float, rng: random.Random) -> dict:
    floor = profile["floor_discount"]
    noise = rng.uniform(-0.01, 0.01)
    if tactic == profile["works"]:
        got = min(ask, floor) * 0.97 + noise
    elif tactic == profile["fails"]:
        got = floor * 0.12 + noise
    else:
        got = min(ask, floor * 0.40) + noise
    if ask > floor * 1.25:
        got *= 0.6
```

One tactic works, one backfires, everything else gives small concessions, and an absurd ask is penalised. The agent never sees the profile. It only sees the notes of its own earlier negotiations, which are written back into Hindsight after each round.

The metric is the discount achieved as a percentage of that vendor's maximum possible discount:

```python
def savings_pct(profile: dict, final_discount: float) -> float:
    return round(100 * min(1.0, final_discount / profile["floor_discount"]), 1)
```

Normalising by the floor puts vendors with different ceilings on one axis. "Won" means at least 85% of it.

## The experiment

Three simulated vendors, ten negotiations each, starting from an empty memory bank. Two arms run the same model, the same prompt and the same loop. The only difference is whether the memory tools are registered. Each round the arm picks its top tactic and an opening ask, the simulator responds, and the memory arm retains the outcome. The simulator's small noise term comes from one generator seeded with 7 and shared by both arms, so a run is repeatable, but the two arms do not see identical noise draws.

| Measure | Memory ON | Memory OFF |
|---|---|---|
| Mean % of max discount, last 5 negotiations | 75.6 | 39.9 |
| Vendors "won" (at least 85% of max) | 2 of 3, from negotiation 4 | 0 of 3, never |
| Vendors never solved | 1 | 1 |

Episode 1 is a cold start for both arms, so there should be no gap there, and there is not much of one. The gap opens as outcomes accumulate. The third vendor was never solved in ten negotiations by either arm, and I have not dug into why.


## The evaluation bug that taught me the most

An earlier version of the prompt told the agent to anchor its opening ask to the best discount seen so far. In a simulator that rewards asking high enough, this produces a spiral: a low ask gives a low result, the low result lowers the next ask. It also confounded the experiment. A good tactic looked like it had failed because it had been tried with a tiny ask, so the stored outcome taught the wrong lesson.

The measurement was wrong, not the memory. The fix was a stated policy: open at 18% when no tactic is proven, and about 10% above the best achieved when one is. Those numbers are my own heuristics. The agent did not discover them. If your evaluation scores an agent on outcomes, check that the action parameters are not themselves a function of earlier bad outcomes.

## Every claim cites a memory

The last design choice is about trust, not scoring. Each recalled item gets an id such as `[m3]`, and the agent is told to base claims on tool evidence and cite those ids in the final brief. The interface turns each id into a link to the memory and its date.

This helps evaluation as much as it helps the reader. A brief that says "do not escalate to executives, it backfired previously" can be checked against the episode it came from. If the claim has no citation, I treat it as the model's prior, not as memory.

## Limits

I want these to be as visible as the 75.6.

- The simulator is mine. One tactic works, one backfires, the rest are partial. Real vendors are not that tidy, so the curve shows the memory loop works under this model, not real-world savings.
- The opening-ask rule is mine too, as are the 85% win threshold and the profile values.
- One run, three vendors, no confidence intervals. The 2-of-3 result could shift on another seed.
- Costing about $1 of model usage is why it is one run.
- The negotiation history is fictional by design. The Estonian benchmarks are real, but they describe award sizes and bidder counts, not discounts.
- Separately, I built a `band_agents` module (Scout, Negotiator and Ledger as separate agents in a shared room). Its unit tests pass offline. I have not verified it against a live Band room.

## What I would do next

Run several seeds and report intervals, vary the simulator's structure so a profile can change mid-run, and test whether the agent notices. For background on why this memory shape matters, the Vectorize explainer on [what agent memory is](https://vectorize.io/what-is-agent-memory) is a good start, and the [Hindsight documentation](https://hindsight.vectorize.io/) covers retain, recall and tags.

The takeaway I would keep: write the evaluation so that being wrong is possible. A simulator with hidden answers, a no-memory arm, and citations on every claim give the agent room to fail visibly.

Code: https://github.com/ranjith-kumar-28100/precedent
