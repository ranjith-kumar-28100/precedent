import { BookMarked, GitCompare, History, Lightbulb, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge, Card, CardHeader, Empty, ErrorBanner, Markdown, Segmented, SkeletonLines, Stat, cx, inputCls, outcomeTone } from '../components/ui'
import { api } from '../lib/api'
import { diffLines } from '../lib/diff'
import { cleanFact, fmtDate, pct, tacticLabel, timeAgo } from '../lib/format'
import { useApi, useAppData } from '../lib/hooks'
import type { MemoryView, PlaybookHistory, RecallResp } from '../lib/types'

export default function VendorMemory() {
  const { vendors } = useAppData()
  const [vid, setVid] = useState<string>(() => new URLSearchParams(location.search).get('vendor') ?? 'v01')
  const mem = useApi<MemoryView>(`/memory/${vid}`)
  const hist = useApi<PlaybookHistory>(`/memory/${vid}/playbook/history`)
  const [people, setPeople] = useState<RecallResp['entities'] | null>(null)
  useEffect(() => {
    setPeople(null)
    api<RecallResp>('/memory/recall', { query: 'who approves discounts, contacts and decision makers', vendor_id: vid, as_of: null, limit: 25 })
      .then((r) => setPeople(r.entities), () => setPeople([]))
  }, [vid])

  const eps = mem.data?.episodes ?? []
  const won = eps.filter((e) => e.outcome === 'won').length
  const best = eps.reduce((m, e) => Math.max(m, e.final_discount), 0)
  const vendor = vendors.find((v) => v.id === vid)

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div className="lg:hidden">
        <select className={inputCls} value={vid} onChange={(e) => setVid(e.target.value)} aria-label="Vendor">
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <nav aria-label="Vendors" className="hidden lg:block">
        <div className="sticky top-20 space-y-0.5">
          <div className="px-2 pb-1.5 text-2xs font-medium uppercase tracking-wider text-faint">{vendors.length} vendors</div>
          {vendors.map((v) => (
            <button key={v.id} onClick={() => setVid(v.id)} aria-current={v.id === vid}
              className={cx('flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]',
                v.id === vid ? 'bg-panel font-medium text-fg shadow-card ring-1 ring-line' : 'text-muted hover:bg-subtle hover:text-fg')}>
              <span className="truncate">{v.name}</span><span className="num font-mono text-2xs text-faint">{v.episodes}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{vendor?.name ?? vid}</h2>
            <p className="text-xs text-muted">{vendor?.category} · {vendor?.contact} · tag <span className="font-mono">vendor:{vid}</span></p>
          </div>
        </div>
        {mem.error && <ErrorBanner error={mem.error} onRetry={mem.reload} />}

        <Card className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="Episodes" value={mem.data ? eps.length : '–'} sub="retained negotiations" />
          <Stat label="Facts" value={mem.data?.facts ?? '–'} sub="extracted by Hindsight" />
          <Stat label="Observations" value={mem.data?.observations.length ?? '–'} sub="consolidated beliefs" />
          <Stat label="Win rate" value={mem.data ? `${won}/${eps.length}` : '–'} sub={mem.data ? `best ${pct(best, 0)} off` : 'won / tried'} />
          <Stat label="Playbook versions" value={hist.data ? hist.data.versions.length + (hist.data.current.content ? 1 : 0) : '–'}
            sub={hist.data?.current.refreshed_at ? `refreshed ${timeAgo(hist.data.current.refreshed_at)}` : 'mental model'} tone="accent" />
        </Card>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Playbook hist={hist.data} loading={hist.loading} error={hist.error} fallback={mem.data?.mental_model ?? null} />
          <div className="space-y-5">
            <Card>
              <CardHeader icon={<Users size={15} className="text-faint" />} title="People & roles" sub="Entities Hindsight linked to this vendor’s memories" />
              {!people ? <SkeletonLines n={2} /> : people.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {people.slice(0, 16).map((p) => (
                    <span key={p.name} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-subtle/60 px-2.5 py-1 text-xs">
                      {p.name}<span className="num font-mono text-[10px] text-faint">{p.count}</span>
                    </span>
                  ))}
                </div>
              ) : <p className="text-xs text-muted">No entities returned.</p>}
            </Card>
            <Card>
              <CardHeader icon={<Lightbulb size={15} className="text-faint" />} title="Observations" sub="Durable beliefs consolidated from several facts" />
              {mem.loading ? <SkeletonLines n={5} /> : mem.data?.observations.length ? (
                <ul className="max-h-[340px] space-y-2 overflow-y-auto pr-1 scroll-thin">
                  {mem.data.observations.slice(0, 12).map((o, i) => (
                    <li key={i} className="flex gap-2.5 text-xs leading-5">
                      {o.proof_count > 0
                        ? <span className="num mt-0.5 shrink-0 rounded bg-subtle px-1 font-mono text-[10px] text-muted" title="Supporting facts">×{o.proof_count}</span>
                        : <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-faint" />}
                      <span>{cleanFact(o.text)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-muted">No observations yet.</p>}
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader icon={<History size={15} className="text-faint" />} title="Negotiation timeline" sub="Every episode retained for this vendor, oldest first" />
          {mem.loading ? <SkeletonLines n={6} /> : eps.length ? (
            <ol className="relative space-y-0 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line">
              {eps.map((e, i) => (
                <li key={i} className="relative grid gap-1 py-2.5 pl-6 sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-4">
                  <span className={cx('absolute left-0 top-[15px] h-[11px] w-[11px] rounded-full border-2 border-panel',
                    e.outcome === 'won' ? 'bg-ok' : e.outcome === 'lost' ? 'bg-bad' : 'bg-warn')} />
                  <div className="num font-mono text-xs text-muted">{fmtDate(e.date)}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold">{tacticLabel(e.tactic_used)}</span>
                      <Badge tone={outcomeTone(e.outcome)}>{e.outcome}</Badge>
                      <span className="num font-mono text-xs text-muted">asked {pct(e.ask_discount)} → got <b className="text-fg">{pct(e.final_discount, 1)}</b></span>
                      {e.decision_maker_seen && <span className="text-xs text-faint">· approver: {e.decision_maker_seen}</span>}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted">{e.notes}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : <Empty title="No episodes" />}
        </Card>
      </div>
    </div>
  )
}

function Playbook({ hist, loading, error, fallback }: { hist: PlaybookHistory | null; loading: boolean; error: string | null; fallback: string | null }) {
  const [view, setView] = useState<'current' | 'history'>('current')
  const versions = useMemo(() => {
    if (!hist) return []
    const v = hist.versions.map((x, i) => ({ ...x, label: `v${i + 1}` }))
    if (hist.current.content) v.push({ at: hist.current.refreshed_at ?? '', content: hist.current.content, sources: { world: 0, observation: 0, experience: 0 }, label: `v${v.length + 1}` })
    return v
  }, [hist])
  const [pick, setPick] = useState<number | null>(null)
  useEffect(() => { setPick(null); setView('current') }, [hist])
  const cur = hist?.current.content ?? fallback
  const base = pick ?? Math.max(0, versions.length - 2)
  const diff = useMemo(() => (versions.length > 1 ? diffLines(versions[base].content, versions[versions.length - 1].content) : []), [versions, base])
  const added = diff.filter((d) => d.kind === 'add').length
  const removed = diff.filter((d) => d.kind === 'del').length

  return (
    <Card>
      <CardHeader icon={<BookMarked size={15} className="text-accent" />} title="Negotiation playbook"
        sub="A Hindsight mental model, rewritten automatically after each consolidation"
        right={<Segmented label="Playbook view" value={view} onChange={setView}
          options={[{ value: 'current', label: 'Current' }, { value: 'history', label: <span className="flex items-center gap-1"><GitCompare size={12} />History</span> }]} />} />
      {error && !cur && <ErrorBanner error={error} />}
      {loading && !cur ? <SkeletonLines n={10} /> : view === 'current' ? (
        cur ? <div className="max-h-[560px] overflow-y-auto pr-2 scroll-thin"><Markdown>{cur}</Markdown></div> : <Empty title="No playbook yet" sub="It appears after the first consolidation." />
      ) : versions.length < 2 ? <Empty title="Only one version so far" sub="History appears once the playbook has been refreshed after new outcomes." /> : (
        <div className="space-y-3">
          <ol className="flex flex-wrap items-center gap-1.5" aria-label="Versions">
            {versions.map((v, i) => (
              <li key={i}>
                <button disabled={i === versions.length - 1} onClick={() => setPick(i)}
                  className={cx('rounded-md border px-2 py-1 text-left text-xs',
                    i === versions.length - 1 ? 'border-accent/40 bg-accent-soft text-accent' : i === base ? 'border-fg/30 bg-subtle font-medium' : 'border-line hover:bg-subtle')}>
                  <span className="font-mono font-semibold">{v.label}</span>
                  <span className="num ml-1.5 text-faint">{v.at ? new Date(v.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  {v.sources.world + v.sources.observation > 0 && <span className="num ml-1.5 text-faint">· {v.sources.world + v.sources.observation} src</span>}
                </button>
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-2 text-xs text-muted">
            Comparing <b className="font-mono text-fg">{versions[base].label}</b> → <b className="font-mono text-accent">{versions[versions.length - 1].label}</b>
            <span className="num font-mono text-ok">+{added}</span><span className="num font-mono text-bad">−{removed}</span>
          </div>
          <pre className="max-h-[480px] overflow-auto rounded-lg border border-line bg-subtle/40 py-2 font-mono text-[11.5px] leading-5 scroll-thin">
            {diff.map((d, i) => (
              <div key={i} className={cx('whitespace-pre-wrap px-3', d.kind === 'add' && 'bg-ok/10 text-fg', d.kind === 'del' && 'bg-bad/[0.07] text-muted')}>
                <span className="mr-2 select-none text-faint">{d.kind === 'add' ? '+' : d.kind === 'del' ? '−' : ' '}</span>{d.text || ' '}
              </div>
            ))}
          </pre>
        </div>
      )}
    </Card>
  )
}
