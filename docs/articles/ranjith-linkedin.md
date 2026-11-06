# LinkedIn post

My agent had memory and still learned nothing. The bug was my own prompt.

I told it to open its ask "near the best discount this vendor has ever given." Asks shrank, a winning tactic looked like a failure, and the spiral never broke.

What fixed it:
- Never under-ask: 18% off list when nothing is proven, ~10% above the best result when something is
- A tactic scoreboard built from structured metadata attached at retain time
- Tag-scoped recall per vendor, [m3]-style citations on every claim

Simulated, 3 vendors, 10 episodes each: last-5 mean 75.6% of max discount with memory vs 39.9% without.

Hindsight agent memory handled extraction and consolidation, so I could debug the policy.

Code: https://github.com/ranjith-kumar-28100/precedent

#AIAgents #AgentMemory #Hindsight #LLM

---

## First comment

Here's a link to Hindsight if you want to check it out: https://github.com/vectorize-io/hindsight

Full write-up: link in the comments once published
