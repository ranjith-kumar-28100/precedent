import { Clock, GitBranch, Hash, Search, Sparkles, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, Card, CardHeader, Empty, ErrorBanner, Field, SkeletonLines, cx, inputCls, outcomeTone } from '../components/ui'
import { cleanFact, fmtDate, tacticLabel } from '../lib/format'
import { useAction, useAppData } from '../lib/hooks'
import type { Channels, RecallResp } from '../lib/types'

const EXAMPLES = [
  { q: 'Who approves discounts?', v: 'v01', asOf: '' },
  { q: 'Who approves discounts?', v: 'v01', asOf: '2026-01-01' },
  { q: 'Which tactic backfired?', v: null, asOf: '' },
  { q: 'Multi-year commitment outcome', v: 'v05', asOf: '' },
]

const CH: { k: keyof Channels; label: string; icon: typeof Search; tip: string }[] = [
  { k: 'semantic', label: 'Semantic', icon: Sparkles, tip: 'Embedding similarity' },
  { k: 'bm25', label: 'Keyword', icon: Hash, tip: 'BM25 full-text match' },
  { k: 'graph', label: 'Graph', icon: GitBranch, tip: 'Reached via linked entities' },
  { k: 'temporal', label: 'Temporal', icon: Clock, tip: 'Matched the time constraint' },
]
const TYPE_TONE: Record<string, 'accent' | 'neutral' | 'warn'> = { observation: 'accent', world: 'neutral', experience: 'warn' }

export default function Explorer() {
  const { vendors, vendorName } = useAppData()
  const [q, setQ] = useState('Who approves discounts?')
  const [vid, setVid] = useState<string>('v01')
  const [asOf, setAsOf] = useState('')
  const rec = useAction<object, RecallResp>('/memory/recall')
  const search = (query = q, v = vid, a = asOf) => query.trim() && rec.run({ query, vendor_id: v || null, as_of: a || null, limit: 20 })
  useEffect(() => { search() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <Card>
        <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px_160px_auto] md:items-end" onSubmit={(e) => { e.preventDefault(); search() }}>
          <Field label="Recall query">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input className={cx(inputCls, 'pl-8')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask the memory bank anything…" />
            </div>
          </Field>
          <Field label="Scope">
            <select className={inputCls} value={vid} onChange={(e) => setVid(e.target.value)}>
              <option value="">All vendors (bank-wide)</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="As of (time travel)">
            <input type="date" className={inputCls} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
          <Button variant="primary" type="submit" disabled={rec.loading}>{rec.loading ? 'Recalling…' : 'Recall'}</Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-faint">Try:</span>
          {EXAMPLES.map((x, i) => (
            <button key={i} onClick={() => { setQ(x.q); setVid(x.v ?? ''); setAsOf(x.asOf); search(x.q, x.v ?? '', x.asOf) }}
              className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted hover:border-line2 hover:text-fg">
              {x.q}{x.v ? ` · ${vendorName(x.v).split(' ')[0]}` : ' · all'}{x.asOf ? ` · as of ${x.asOf.slice(0, 7)}` : ''}
            </button>
          ))}
        </div>
      </Card>

      {rec.error && <ErrorBanner error={rec.error} onRetry={() => search()} />}

      {rec.data && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-5">
          {[
            ['Returned', rec.data.summary.returned],
            ['Nodes visited', rec.data.summary.visited],
            ['Entry points', rec.data.summary.entry_points],
            ['Latency', `${rec.data.summary.ms} ms`],
            ['Time constraint', rec.data.summary.temporal_constraint ? fmtDate(rec.data.summary.temporal_constraint) : 'none'],
          ].map(([k, v]) => (
            <div key={k} className="bg-panel px-4 py-3">
              <div className="text-2xs font-medium uppercase tracking-wider text-faint">{k}</div>
              <div className="num mt-1 text-[15px] font-semibold">{v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Card pad={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="text-[13.5px] font-semibold">Results</div>
            <div className="flex flex-wrap items-center gap-3 text-2xs text-faint">
              {CH.map(({ k, label, icon: I, tip }) => <span key={k} title={tip} className="flex items-center gap-1"><I size={11} />{label}</span>)}
              <span>· rank per channel, fused (RRF) then cross-encoder reranked</span>
            </div>
          </div>
          {rec.loading && !rec.data ? <div className="p-5"><SkeletonLines n={8} /></div> : !rec.data?.results.length ? (
            <div className="p-5"><Empty title="No memories matched" sub={asOf ? 'Nothing was recorded before that date for this scope.' : 'Try a broader query or the whole bank.'} /></div>
          ) : (
            <ol className={cx('divide-y divide-line', rec.loading && 'opacity-60')}>
              {rec.data.results.map((r, i) => (
                <li key={r.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[28px_minmax(0,1fr)_auto]">
                  <span className="num hidden font-mono text-xs text-faint sm:block">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone={TYPE_TONE[r.type] ?? 'neutral'}>{r.type}</Badge>
                      {r.date && <span className="num font-mono text-2xs text-muted">{fmtDate(r.date)}</span>}
                      {!vid && r.vendor_id && <span className="text-2xs text-muted">· {vendorName(r.vendor_id)}</span>}
                      {r.tactic && <Badge>{tacticLabel(r.tactic)}</Badge>}
                      {r.outcome && <Badge tone={outcomeTone(r.outcome)}>{r.outcome}</Badge>}
                    </div>
                    <p className="text-[13px] leading-5">{cleanFact(r.text)}</p>
                    {r.entities.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">{r.entities.slice(0, 5).map((e) => <span key={e} className="rounded bg-subtle px-1.5 py-0.5 text-[10.5px] text-muted">{e}</span>)}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
                    <div className="flex gap-1" aria-label="Retrieval channels">
                      {CH.map(({ k, icon: I, label }) => {
                        const rank = r.channels[k]
                        return (
                          <span key={k} title={rank ? `${label} rank ${rank}` : `${label}: not found`}
                            className={cx('num inline-flex h-6 min-w-[34px] items-center justify-center gap-0.5 rounded-md border px-1 font-mono text-[10px]',
                              rank ? 'border-accent/30 bg-accent-soft text-accent' : 'border-line text-faint/60')}>
                            <I size={10} />{rank ?? '–'}
                          </span>
                        )
                      })}
                    </div>
                    <div className="num font-mono text-2xs text-faint">score <b className="text-fg">{r.score.toFixed(2)}</b>{r.rrf_rank && r.rerank_rank && r.rrf_rank !== r.rerank_rank ? ` · ${r.rrf_rank}→${r.rerank_rank}` : ''}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader icon={<Users size={15} className="text-faint" />} title="Entities in results" sub="From Hindsight’s entity graph" />
            {rec.data?.entities.length ? (
              <ul className="space-y-1">
                {rec.data.entities.slice(0, 14).map((e) => (
                  <li key={e.name} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    <span className="h-1.5 rounded-full bg-accent/60" style={{ width: `${Math.min(80, e.count * 12)}px` }} />
                    <span className="num w-5 text-right font-mono text-faint">{e.count}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted">{rec.loading ? 'Loading…' : 'None.'}</p>}
          </Card>
          <Card className="text-xs leading-5 text-muted">
            <div className="mb-1 text-[13px] font-semibold text-fg">How recall works</div>
            Hindsight searches four ways in parallel: embeddings, BM25 keywords, the entity graph and time. It fuses the ranks, then a cross-encoder reranks the merged list.
            <b className="text-fg"> As of</b> sets the query timestamp, so you see what the team knew on that date.
            None of this calls an LLM.
          </Card>
        </div>
      </div>
    </div>
  )
}
