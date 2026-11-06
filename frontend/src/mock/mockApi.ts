// Mock backend for ?mock=1. Builds answers from the same public data files the server uses,
// plus a snapshot of real Hindsight reads, so mock screens show real vendor history.
import { EVAL, HISTORY, UPCOMING, VENDORS } from './data'
import { MEMORY } from './memory'
import { tacticLabel } from '../lib/format'
import type { BriefResp, Citation, Episode, Ledger, LedgerOp, RecallHit, RecallResp } from '../lib/types'

const sleep = (t: number) => new Promise((r) => setTimeout(r, t))
const H = HISTORY as Episode[]
const vendorName = (id: string) => VENDORS.find((v) => v.id === id)?.name ?? id
const episodesOf = (vid: string) => H.filter((e) => e.vendor_id === vid).sort((a, b) => a.date.localeCompare(b.date))

function stats(vid: string) {
  const by: Record<string, { tries: number; won: number; lost: number; best: number }> = {}
  for (const e of episodesOf(vid)) {
    const r = (by[e.tactic_used] ??= { tries: 0, won: 0, lost: 0, best: 0 })
    r.tries++
    if (e.outcome === 'won') r.won++
    if (e.outcome === 'lost') r.lost++
    r.best = Math.max(r.best, e.final_discount)
  }
  return by
}

const OPS: LedgerOp[] = []
function log(op: string, vendor_id: string | null, ms: number, detail: string, ok = true, error: string | null = null) {
  OPS.unshift({ t: new Date().toISOString(), op, vendor_id, ms, ok, detail, error })
}
;(function seedLedger() {
  const now = Date.now()
  const seed: [string, string | null, number, string, boolean, string | null][] = [
    ['retain', 'v01', 4120, 'Episode 2026-09-09 · competing_quote · won', true, null],
    ['get_mental_model', 'v01', 38, 'playbook-v01', true, null],
    ['recall', 'v05', 312, 'tags=vendor:v05 · 12 results · budget mid', true, null],
    ['recall', 'v05', 1840, 'tactic scoreboard · 5 episodes · budget high', true, null],
    ['reflect', 'v05', 6120, 'Who really approves discounts above 4%?', true, null],
    ['mental_model_history', 'v04', 44, 'playbook-v04 · 3 versions', true, null],
    ['recall', null, 401, 'bank-wide · "which tactic backfired" · 10 results', true, null],
    ['retain', 'v08', 9020, 'Episode 2026-10-02 · payment_terms', false, 'HTTP 429 from LLM provider, retried 6x'],
    ['recall', 'v03', 288, 'tags=vendor:v03 · 12 results · budget mid', true, null],
  ]
  seed.forEach(([op, v, ms, d, ok, err], i) =>
    OPS.push({ t: new Date(now - (i + 1) * 97_000).toISOString(), op, vendor_id: v, ms, ok, detail: d, error: err }))
})()

function counts(): Ledger['counts'] {
  const c = { recall: 0, retain: 0, reflect: 0, mental_model: 0, other: 0 }
  for (const o of OPS) {
    if (o.op === 'recall' || o.op === 'retain' || o.op === 'reflect') c[o.op]++
    else if (o.op.includes('mental_model')) c.mental_model++
    else c.other++
  }
  return c
}

function citationsFor(vid: string): Citation[] {
  const snap = MEMORY[vid]
  const out: Citation[] = []
  if (snap) {
    for (const r of (snap.recall.results as RecallHit[]).slice(0, 6))
      out.push({ id: '', kind: r.type === 'observation' ? 'observation' : 'fact', date: r.date, text: r.text.split(' | When:')[0] })
  } else {
    for (const e of episodesOf(vid).slice(-5))
      out.push({ id: '', kind: 'fact', date: e.date, text: e.notes })
  }
  out.push({ id: '', kind: 'mental_model', date: null, text: `${vendorName(vid)} negotiation playbook (Hindsight mental model)` })
  return out.map((c, i) => ({ ...c, id: `m${i + 1}` }))
}

function briefOn(vid: string): BriefResp {
  const st = stats(vid)
  const ranked = Object.entries(st).sort((a, b) => b[1].won - a[1].won || b[1].best - a[1].best)
  const best = ranked[0]
  const worst = Object.entries(st).sort((a, b) => b[1].lost - a[1].lost)[0]
  const eps = episodesOf(vid)
  const approvers = [...new Set(eps.map((e) => e.decision_maker_seen).filter(Boolean))]
  const bestPct = best ? best[1].best * 100 : 10
  const cites = citationsFor(vid)
  return {
    vendor_id: vid, use_memory: true, latency_ms: 14200, citations: cites,
    brief: {
      summary: `${vendorName(vid)} has moved for ${tacticLabel(best?.[0]).toLowerCase()} (${best?.[1].won} of ${best?.[1].tries} won, best ${bestPct.toFixed(0)}% off) [m1][m2]. ${worst && worst[1].lost ? `${tacticLabel(worst[0])} has backfired ${worst[1].lost}× [m3].` : ''} Lead with the proven tactic and ask above the best result we have achieved.`,
      vendor_profile: `Day-to-day contact concedes small amounts; larger discounts go to ${approvers[approvers.length - 1] ?? 'a senior approver'} [m4]. The playbook is consolidated from ${eps.length} recorded negotiations [m${cites.length}].`,
      decision_maker: approvers.length > 1 ? `${approvers[0]} day to day; ${approvers[approvers.length - 1]} signs larger discounts` : approvers[0] ?? 'Unknown',
      recommended_opening_ask_pct: Math.round(Math.min(30, bestPct * 1.1 + 1)),
      tactics: ranked.slice(0, 3).map(([t, r], i) => ({
        tactic: t, confidence: Math.max(0.2, Math.min(0.95, 0.3 + 0.65 * (r.won / r.tries) - 0.1 * r.lost)),
        why: r.won ? `Won ${r.won} of ${r.tries} tries, best ${(r.best * 100).toFixed(0)}% off [m${i + 1}].` : `Tried ${r.tries}×, never won (best ${(r.best * 100).toFixed(0)}% off); secondary lever only [m${i + 2}].`,
      })),
      watch_outs: [
        worst && worst[1].lost ? `Do not lead with ${tacticLabel(worst[0]).toLowerCase()}: lost ${worst[1].lost} of ${worst[1].tries} [m3].` : 'Evidence on failures is thin.',
        'Never ask below the best discount already achieved with this vendor.',
      ],
    },
    trace: [
      { step: 1, tool: 'tactic_scoreboard', args: {}, result: `${eps.length} episodes across ${Object.keys(st).length} tactics` },
      { step: 2, tool: 'recall_memory', args: { query: 'who approves discounts and how far they go' }, result: '6 memories: m1..m6' },
      { step: 3, tool: 'get_playbook', args: {}, result: 'playbook loaded (mental model)' },
      { step: 4, tool: 'market_benchmarks', args: {}, result: 'Estonian register benchmarks for category' },
      { step: 5, tool: 'submit_brief', args: {}, result: 'brief submitted' },
    ],
  }
}

function briefOff(vid: string): BriefResp {
  return {
    vendor_id: vid, use_memory: false, latency_ms: 6100, citations: [],
    brief: {
      summary: 'No history with this vendor is available, so every tactic below is an experiment. Open at 18% off list and adjust from the first counter.',
      vendor_profile: 'Unknown: no recorded negotiations.', decision_maker: 'Unknown (assume the account contact)',
      recommended_opening_ask_pct: 18,
      tactics: [
        { tactic: 'competing_quote', why: 'A common lever in most categories; untested with this vendor.', confidence: 0.5 },
        { tactic: 'multi_year', why: 'Term length often trades for price; untested here.', confidence: 0.45 },
        { tactic: 'volume_commit', why: 'Volume tiers sometimes unlock discounts; untested here.', confidence: 0.4 },
      ],
      watch_outs: ['No evidence: confirm who approves discounts early.', 'Benchmark the price against the market data before the call.'],
    },
    trace: [
      { step: 1, tool: 'market_benchmarks', args: {}, result: 'Estonian register benchmarks for category' },
      { step: 2, tool: 'submit_brief', args: {}, result: 'brief submitted' },
    ],
  }
}

function recall(body: { query: string; vendor_id: string | null; as_of: string | null; limit?: number }): RecallResp {
  const ids = body.vendor_id ? [body.vendor_id] : Object.keys(MEMORY)
  let results: RecallHit[] = []
  for (const id of ids) {
    const snap = MEMORY[id]
    if (snap) results.push(...(snap.recall.results as RecallHit[]))
    else
      results.push(...episodesOf(id).map((e, i) => ({
        id: `${id}-${i}`, text: e.notes, type: 'world', date: e.date, vendor_id: id, tactic: e.tactic_used, outcome: e.outcome,
        entities: [], score: 0.6 - i * 0.03, channels: { semantic: i + 1, bm25: i % 2 ? i + 2 : null, graph: null, temporal: null },
        rerank_rank: i + 1, rrf_rank: i + 1,
      })))
  }
  if (body.as_of) results = results.filter((r) => !r.date || r.date <= body.as_of!)
  results = results.sort((a, b) => b.score - a.score).slice(0, body.limit ?? 20)
  const ents: Record<string, number> = {}
  results.forEach((r) => r.entities.forEach((e) => (ents[e] = (ents[e] ?? 0) + 1)))
  return {
    results, entities: Object.entries(ents).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    summary: { visited: results.length * 3 + 2, entry_points: Math.min(10, results.length), ms: 286, returned: results.length, temporal_constraint: body.as_of },
  }
}

function chat(body: { messages: { role: string; content: string }[]; vendor_id: string | null; use_memory: boolean }) {
  const q = body.messages[body.messages.length - 1].content.toLowerCase()
  if (!body.use_memory)
    return {
      latency_ms: 2100, use_memory: false, citations: [], trace: [{ step: 1, tool: 'list_vendors', args: {}, result: `${VENDORS.length} vendors` }],
      answer: 'Memory is off, so I can’t see any of our past negotiations and won’t guess about specific vendors.\n\nIn general, the tactics that backfire most often are **escalating over the contact’s head** (it damages the working relationship) and **quarter-end pressure** when the vendor’s quarter is already booked. Turn memory on for an answer based on our own history.',
    }
  const lost: Record<string, Set<string>> = {}
  H.filter((e) => e.outcome === 'lost').forEach((e) => (lost[e.tactic_used] ??= new Set()).add(e.vendor_id!))
  const [t, vs] = Object.entries(lost).sort((a, b) => b[1].size - a[1].size)[0]
  const names = [...vs].map(vendorName)
  const cites: Citation[] = [...vs].slice(0, 4).map((vid, i) => {
    const e = episodesOf(vid).find((x) => x.outcome === 'lost' && x.tactic_used === t)!
    return { id: `m${i + 1}`, kind: 'fact', date: e.date, vendor: vid, text: e.notes }
  })
  const answer = q.includes('backfire') || q.includes('fail')
    ? `**${tacticLabel(t)}** has backfired most often: ${vs.size} losses across ${names.length} vendors.\n\n${names.map((n, i) => `- ${n}${i < cites.length ? ` [m${i + 1}]` : ''}`).join('\n')}\n\nThis count comes from the structured outcome metadata on every retained negotiation, not from a model estimate.`
    : `Across our history, **competing quotes** are the most reliable lever when the vendor has real alternatives [m1]. Where a tactic failed, the notes usually show the approver was not in the room [m2].`
  return {
    latency_ms: 5400, use_memory: true, citations: cites,
    trace: [
      { step: 1, tool: 'cross_vendor_stats', args: { metric: 'lost_by_tactic' }, result: `${t}: ${vs.size} losses` },
      { step: 2, tool: 'search_each_vendor', args: { query: q.slice(0, 60) }, result: `${cites.length} memories` },
    ],
    answer,
  }
}

export async function mockApi(path: string, body?: any): Promise<unknown> {
  await sleep(200 + Math.random() * 250)
  const vid = path.split('/')[2]
  switch (true) {
    case path === '/health':
      return { hindsight: true, llm: 'gpt-4.1 (mock)', llm_calls: 0, agent_spend_usd: 0, agent_budget_usd: 3, bank_id: 'precedent-procurement', ledger_counts: counts() }
    case path === '/vendors': return VENDORS
    case path === '/upcoming': return UPCOMING
    case path === '/eval/cached': return { ...EVAL, status: 'done' }
    case path.startsWith('/ledger'): return { counts: counts(), ops: OPS.slice(0, 100) }
    case path === '/brief':
      await sleep(body.use_memory ? 1400 : 800)
      log('recall', body.vendor_id, 1840, `tactic scoreboard · tags=vendor:${body.vendor_id}`, true)
      return body.use_memory ? briefOn(body.vendor_id) : briefOff(body.vendor_id)
    case path === '/chat':
      await sleep(1200)
      if (body.use_memory) log('recall', body.vendor_id, 401, 'bank-wide chat search', true)
      return chat(body)
    case path === '/outcome':
      log('retain', body.vendor_id, 3900, `Episode · ${body.tactic_used} · ${body.outcome}`, true)
      return { retained: true }
    case path === '/memory/recall':
      log('recall', body.vendor_id, 286, `"${String(body.query).slice(0, 40)}"${body.as_of ? ` · as of ${body.as_of}` : ''}`, true)
      return recall(body)
    case path.endsWith('/playbook/history'): {
      const snap = MEMORY[vid]
      log('mental_model_history', vid, 44, `playbook-${vid}`, true)
      return snap?.history ?? { vendor_id: vid, current: { content: null, refreshed_at: null }, versions: [] }
    }
    case path.startsWith('/memory/'): {
      const snap = MEMORY[vid]
      const eps = episodesOf(vid)
      return snap ? { ...snap.memory, episodes: eps } : {
        facts: eps.length * 3, episodes: eps, observations: [],
        mental_model: `## ${vendorName(vid)}\n\nPlaybook snapshot not included in mock mode for this vendor. Episodes below are the recorded history.`,
      }
    }
  }
  throw new Error('mock: unknown endpoint ' + path)
}
