export type Vendor = { id: string; name: string; category: string; contact: string; list_price_usd_annual: number; episodes: number }
export type Upcoming = { vendor_id: string; objective: string; context: string; deadline: string }
export type Citation = { id: string; kind: string; date?: string | null; text: string; vendor?: string | null; vendor_id?: string | null }
export type TraceStep = { step: number; tool: string; args: unknown; result: unknown }
export type Tactic = { tactic: string; why: string; confidence: number }
export type Brief = {
  summary: string; vendor_profile: string; decision_maker: string; recommended_opening_ask_pct: number
  tactics: Tactic[]; watch_outs: string[]
}
export type BriefResp = { vendor_id: string; use_memory: boolean; brief: Brief; citations: Citation[]; trace?: TraceStep[]; latency_ms: number }
export type ChatResp = { answer: string; use_memory: boolean; citations: Citation[]; trace: TraceStep[]; latency_ms: number }
export type Episode = {
  vendor_id?: string; date: string; buyer?: string; tactic_used: string; ask_discount: number; final_discount: number
  outcome: string; notes: string; decision_maker_seen?: string
}
export type MemoryView = { observations: { text: string; proof_count: number }[]; mental_model: string | null; facts: number; episodes: Episode[] }
export type OpCounts = { recall: number; retain: number; reflect: number; mental_model: number; other: number }
export type Health = {
  hindsight: boolean; llm: string; llm_calls?: number; agent_spend_usd?: number; agent_budget_usd?: number
  ledger_counts?: OpCounts; bank_id?: string
}
export type LedgerOp = { t: string; op: string; vendor_id: string | null; ms: number; ok: boolean; detail: string; error: string | null }
export type Ledger = { counts: OpCounts; ops: LedgerOp[] }
export type PlaybookVersion = { at: string; content: string; sources: { world: number; observation: number; experience: number } }
export type PlaybookHistory = { vendor_id: string; current: { content: string | null; refreshed_at: string | null }; versions: PlaybookVersion[] }
export type Channels = { semantic: number | null; bm25: number | null; graph: number | null; temporal: number | null }
export type RecallHit = {
  id: string; text: string; type: string; date: string | null; vendor_id: string | null; tactic: string | null; outcome: string | null
  entities: string[]; score: number; channels: Channels; rerank_rank: number | null; rrf_rank: number | null
}
export type RecallResp = {
  results: RecallHit[]; entities: { name: string; count: number }[]
  summary: { visited: number; entry_points: number; ms: number; returned: number; temporal_constraint: string | null }
}
export type EvalPoint = { episode: number; savings_pct: number; won: number | boolean }
export type EvalResp = { status: string; episodes?: number; vendors?: number; series: { memory: EvalPoint[]; baseline: EvalPoint[] } }
