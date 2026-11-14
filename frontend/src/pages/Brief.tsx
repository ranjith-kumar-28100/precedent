import { ArrowRight, BrainCircuit, CalendarClock, Check, CheckCircle2, CircleOff, FileCheck2, Loader2, Play, Plus, ShieldAlert, Sparkles, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AddVendorPanel } from '../components/AddVendor'
import { Cited, EvidenceDrawer } from '../components/Evidence'
import { Trace } from '../components/Trace'
import { VerifyCard } from '../components/Verify'
import { Avatar, Badge, Button, Card, CardHeader, CountUp, Empty, ErrorBanner, Field, Meter, SkeletonLines, cx, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { cleanFact, fmtDate, ms, tacticLabel, usd } from '../lib/format'
import { useApi, useAppData } from '../lib/hooks'
import type { BriefResp, Citation, Upcoming, Vendor } from '../lib/types'

type Run = { data: BriefResp | null; error: string | null; loading: boolean }
const idle: Run = { data: null, error: null, loading: false }

/** "in 31 days" / "today" / "3 days ago" for a deal deadline. */
function dueIn(deadline: string): { label: string; soon: boolean } | null {
  const d = new Date(deadline.length === 10 ? deadline + 'T00:00:00' : deadline)
  if (isNaN(+d)) return null
  const days = Math.round((+d - new Date().setHours(0, 0, 0, 0)) / 864e5)
  return { label: days === 0 ? 'today' : days > 0 ? `in ${days} day${days === 1 ? '' : 's'}` : `${-days} day${days === -1 ? '' : 's'} ago`, soon: days <= 14 }
}

/** A newly added vendor has nothing on the calendar yet; give it a first negotiation so a brief can be generated. */
function firstDeal(v: Vendor): Upcoming {
  const due = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)
  return {
    vendor_id: v.id, deadline: due,
    objective: `First negotiation with ${v.name}: agree a discount off the ${usd(v.list_price_usd_annual)}/yr list price`,
    context: `New ${v.category} vendor${v.contact && v.contact !== 'unknown' ? `; contact ${v.contact}` : ''}. No negotiation history in memory yet.`,
  }
}

export default function BriefPage() {
  const app = useAppData()
  const { refreshHealth } = app
  const up = useApi<Upcoming[]>('/upcoming')
  const [sel, setSel] = useState(0)
  const [on, setOn] = useState<Run>(idle)
  const [off, setOff] = useState<Run>(idle)
  const [drawer, setDrawer] = useState<string | null | false>(false)
  // Vendors added on this page: kept locally so their card renders before GET /vendors has refreshed.
  const [added, setAdded] = useState<Vendor[]>([])
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const vendors = useMemo(() => [...app.vendors, ...added.filter((a) => !app.vendors.some((v) => v.id === a.id))], [app.vendors, added])
  const vendorName = useCallback((id: string | null | undefined) => (id && added.find((a) => a.id === id)?.name) || app.vendorName(id), [added, app])
  const deals = useMemo(() => up.data && [...up.data, ...added.filter((a) => !up.data!.some((u) => u.vendor_id === a.id)).map(firstDeal)], [up.data, added])
  const deal = deals?.[sel]
  const vendor = vendors.find((v) => v.id === deal?.vendor_id)

  const onAdded = (v: Vendor) => {
    setAdded((a) => [...a, v])
    setSel(deals?.length ?? 0)
    setAdding(false)
    setNote(`Added ${v.name}. No negotiation history yet — generate a brief to see a cold start, then log an outcome.`)
  }
  useEffect(() => { document.getElementById(`deal-${sel}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }) }, [sel, deals?.length])

  useEffect(() => { setOn(idle); setOff(idle) }, [sel])

  const run = useCallback(async (mode: 'both' | 'on' | 'off') => {
    if (!deal) return
    const go = async (use_memory: boolean, set: (r: Run) => void) => {
      set({ data: null, error: null, loading: true })
      try {
        set({ data: await api<BriefResp>('/brief', { vendor_id: deal.vendor_id, objective: deal.objective, context: deal.context, use_memory }), error: null, loading: false })
      } catch (e) { set({ data: null, error: String((e as Error).message), loading: false }) }
    }
    if (mode !== 'on') setOff(idle)
    if (mode !== 'off') setOn(idle)
    await Promise.all([mode !== 'off' && go(true, setOn), mode !== 'on' && go(false, setOff)])
    refreshHealth()
  }, [deal, refreshHealth])

  const busy = on.loading || off.loading
  return (
    <div className="space-y-5">
      <section aria-label="Upcoming negotiations">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold">Upcoming negotiations</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">{deals?.length ?? 0} on the calendar</span>
            <Button size="sm" onClick={() => { setAdding((a) => !a); setNote(null) }} aria-expanded={adding} aria-controls="add-vendor-panel">
              <Plus size={13} />Add vendor
            </Button>
          </div>
        </div>
        {up.error && <ErrorBanner error={up.error} onRetry={up.reload} />}
        <div className={cx('-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1 scroll-thin', (deals?.length ?? 0) > 4 && 'fade-r pr-10')}>
          {(deals ?? Array.from({ length: 4 }, () => null)).map((u, i) => {
            const due = u && dueIn(u.deadline)
            return (
              <button key={i} id={`deal-${i}`} disabled={!u} onClick={() => setSel(i)} aria-pressed={i === sel}
                className={cx('w-[272px] shrink-0 snap-start rounded-xl border p-3 text-left transition-all',
                  i === sel && u ? 'border-accent bg-accent-soft/50 shadow-card ring-1 ring-accent/30' : 'border-line bg-panel hover:-translate-y-px hover:border-line2 hover:shadow-card')}>
                {u ? (<>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={vendorName(u.vendor_id)} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold">{vendorName(u.vendor_id)}</div>
                      <div className="num flex items-center gap-1.5 text-2xs text-faint">
                        {added.some((a) => a.id === u.vendor_id)
                          ? <Badge tone="accent">New</Badge>
                          : <>{fmtDate(u.deadline)}{due && <span className={cx('font-medium', due.soon ? 'text-warn' : 'text-muted')}>· {due.label}</span>}</>}
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-[18px] text-muted">{u.objective}</p>
                </>) : <SkeletonLines n={2} />}
              </button>
            )
          })}
        </div>
      </section>

      {adding && <AddVendorPanel id="add-vendor-panel" onClose={() => setAdding(false)} onAdded={onAdded} />}
      {note && (
        <div role="status" className="flex items-start gap-2.5 rounded-lg border border-ok/30 bg-ok/5 px-3 py-2.5 text-[13px] text-ok">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">{note}</div>
          <button type="button" onClick={() => setNote(null)} aria-label="Dismiss" className="rounded p-0.5 text-ok/80 hover:bg-ok/10 hover:text-ok"><X size={14} /></button>
        </div>
      )}

      {deal && (
        <Card>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <Avatar name={vendorName(deal.vendor_id)} size={36} />
                <h2 className="text-[22px] font-semibold leading-tight tracking-tight">{vendorName(deal.vendor_id)}</h2>
                {vendor && <Badge>{vendor.category}</Badge>}
                {vendor && <Badge><span className="num">{vendor.episodes} past negotiations</span></Badge>}
              </div>
              <p className="text-[15px] font-medium">{deal.objective}</p>
              <p className="max-w-2xl text-[13px] leading-5 text-muted">{deal.context}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-xs text-muted">
                {vendor && <span className="flex items-center gap-1.5"><UserRound size={13} />{vendor.contact}</span>}
                {vendor && <span className="num">List price {usd(vendor.list_price_usd_annual)}/yr</span>}
                <span className="flex items-center gap-1.5"><CalendarClock size={13} />Deadline {fmtDate(deal.deadline)}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="primary" onClick={() => run('both')} disabled={busy}><Play size={14} />Compare memory ON vs OFF</Button>
              <Button onClick={() => run('on')} disabled={busy}>ON only</Button>
            </div>
          </div>
        </Card>
      )}

      {on.data && off.data && <Verdict on={on.data} off={off.data} listPrice={vendor?.list_price_usd_annual} onEvidence={() => setDrawer(null)} />}

      {!on.data && !on.loading && !off.data && !off.loading && !on.error && !off.error ? (
        <Empty icon={<BrainCircuit size={22} />} title="Run the same agent twice"
          sub="Same model, same prompt, same tools. The only difference: one run can read Hindsight memory of past negotiations with this vendor." />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <BriefCol mode="off" run={off} onCite={() => {}} onRerun={() => run('off')} />
          <BriefCol mode="on" run={on} onCite={(id) => setDrawer(id)} onRerun={() => run('on')} />
        </div>
      )}

      {on.data && (
        <EvidenceDrawer open={drawer !== false} onClose={() => setDrawer(false)} citations={on.data.citations}
          active={drawer || null} title={vendorName(on.data.vendor_id)} />
      )}
      {deal && <OutcomeForm key={deal.vendor_id} vendorId={deal.vendor_id} vendorLabel={vendorName(deal.vendor_id)} />}
    </div>
  )
}

/** The headline of a comparison: what reading memory changed, in numbers taken from the two briefs. */
function Verdict({ on, off, listPrice, onEvidence }: { on: BriefResp; off: BriefResp; listPrice?: number; onEvidence: () => void }) {
  const conf = (b: BriefResp) => Math.round(Math.max(...b.brief.tactics.map((t) => t.confidence), 0) * 100)
  const a = off.brief.recommended_opening_ask_pct, b = on.brief.recommended_opening_ask_pct
  const extra = listPrice && b > a ? Math.round((listPrice * (b - a)) / 100) : 0
  const leadOn = on.brief.tactics[0]?.tactic, leadOff = off.brief.tactics[0]?.tactic
  const n = on.citations.length
  return (
    <section aria-label="What memory changed" className="rise overflow-hidden rounded-xl border border-mem/30 bg-gradient-to-br from-mem-soft via-panel to-panel shadow-card">
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center lg:p-6">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-mem"><Sparkles size={13} />What memory changed</div>
          <div className="num mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[13px] font-medium text-muted">Opening ask</span>
            <span className="text-3xl font-semibold tracking-tight text-faint line-through decoration-1">{a}%</span>
            <ArrowRight size={20} className="self-center text-mem" />
            <span className="text-5xl font-semibold tracking-tight text-mem"><CountUp value={b} />%</span>
            <span className="text-[13px] font-medium text-muted">off list</span>
          </div>
          <p className="mt-2 max-w-xl text-[14px] leading-6">
            {extra > 0
              ? <>With memory the agent asks for <b className="num font-semibold">{usd(extra)} more per year</b>{listPrice ? <> off the {usd(listPrice)} list price</> : null}, </>
              : b < a ? <>With memory the agent asks for less than its blind guess, </> : <>Same ask as the blind guess, but now </>}
            {n > 0
              ? <>backed by <button type="button" onClick={onEvidence} className="num font-semibold text-mem underline decoration-mem/40 underline-offset-2 hover:decoration-mem">{n} cited {n === 1 ? 'memory' : 'memories'}</button> of past negotiations.</>
              : <>with no cited memories yet for this vendor.</>}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line text-center">
          {[
            { k: 'Confidence', from: `${conf(off)}%`, to: <><CountUp value={conf(on)} />%</> },
            { k: 'Evidence', from: `${off.citations.length}`, to: <CountUp value={n} /> },
          ].map((x) => (
            <div key={x.k} className="bg-panel px-2 py-3">
              <dt className="text-2xs font-medium uppercase tracking-wider text-faint">{x.k}</dt>
              <dd className="num mt-1 text-2xl font-semibold tracking-tight text-mem">{x.to}</dd>
              <dd className="num text-2xs text-faint">was {x.from}</dd>
            </div>
          ))}
          <div className="bg-panel px-2 py-3">
            <dt className="text-2xs font-medium uppercase tracking-wider text-faint">Lead tactic</dt>
            <dd className="mt-1.5 text-[13.5px] font-semibold leading-tight text-mem">{tacticLabel(leadOn)}</dd>
            <dd className="mt-0.5 text-2xs text-faint">{leadOn === leadOff ? (n > 0 ? 'same pick, now evidenced' : 'same pick') : `was ${tacticLabel(leadOff)}`}</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}

const STEPS = {
  on: ['Counting tactic wins and losses in code', 'Recalling memories from Hindsight', 'Reading the vendor playbook', 'Reflecting across past negotiations', 'Checking market benchmarks', 'Writing the brief and checking every citation'],
  off: ['Memory tools switched off', 'Checking market benchmarks', 'Writing the brief from general knowledge'],
}

/** Shown while a run is in flight: the agent's usual steps on a timer (the real tool trace arrives with the result). */
function AgentSteps({ mode }: { mode: 'on' | 'off' }) {
  const steps = STEPS[mode]
  const [at, setAt] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setAt((x) => Math.min(x + 1, steps.length - 1)), mode === 'on' ? 1700 : 1500)
    return () => clearInterval(t)
  }, [mode, steps.length])
  return (
    <div role="status" aria-live="polite">
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={s} className={cx('flex items-center gap-2.5 text-[13px] transition-opacity duration-300', i > at && 'opacity-35')}>
            <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full',
              i < at ? (mode === 'on' ? 'bg-mem text-panel' : 'bg-faint text-panel') : i === at ? (mode === 'on' ? 'text-mem' : 'text-muted') : 'border border-line2')}>
              {i < at ? <Check size={12} strokeWidth={3} /> : i === at ? <Loader2 size={16} className="animate-spin" /> : null}
            </span>
            <span className={cx(i === at ? 'font-medium text-fg' : 'text-muted')}>{s}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-2xs text-faint">The agent&rsquo;s usual steps. Its real tool trace appears with the brief.</p>
    </div>
  )
}

function EvidencePeek({ cites, onCite }: { cites: Citation[]; onCite: (id: string) => void }) {
  if (!cites.length) return null
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-faint"><FileCheck2 size={12} />Evidence from memory</div>
        {cites.length > 3 && <button type="button" onClick={() => onCite(cites[0].id)} className="num text-xs font-medium text-mem hover:underline">See all {cites.length}</button>}
      </div>
      <ul className="space-y-1.5">
        {cites.slice(0, 3).map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onCite(c.id)} className="flex w-full gap-2.5 rounded-lg border border-line px-3 py-2 text-left transition-colors hover:border-mem/40 hover:bg-mem-soft/40">
              <span className="mt-0.5 font-mono text-[10.5px] font-semibold text-mem">{c.id}</span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-xs leading-5 text-fg">{cleanFact(c.text)}</span>
                {c.date && <span className="num text-2xs text-faint">{fmtDate(c.date)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function BriefCol({ mode, run, onCite, onRerun }: { mode: 'on' | 'off'; run: Run; onCite: (id: string) => void; onRerun: () => void }) {
  const isOn = mode === 'on'
  const b = run.data?.brief
  const top = b ? Math.max(...b.tactics.map((t) => t.confidence), 0) : 0
  const cites = run.data?.citations ?? []
  return (
    <Card pad={false} className={cx('flex flex-col overflow-hidden', isOn ? 'order-first border-mem/50 shadow-pop ring-1 ring-mem/20 lg:order-none' : 'bg-panel/60 shadow-none')}>
      <div className={cx('flex items-center justify-between gap-2 border-b px-4 py-3', isOn ? 'border-mem/20 bg-mem-soft/70' : 'border-line bg-subtle/50')}>
        <div className="flex items-center gap-2">
          {isOn ? <Sparkles size={16} className="text-mem" /> : <CircleOff size={15} className="text-faint" />}
          <span className={cx('text-[14px] font-semibold', isOn ? 'text-mem' : 'text-muted')}>Memory {isOn ? 'ON' : 'OFF'}</span>
          <span className="hidden text-xs text-muted sm:inline">{isOn ? '· reads Hindsight' : '· same agent, no memory tools'}</span>
        </div>
        {run.data && <span className="num font-mono text-2xs text-faint">{ms(run.data.latency_ms)}</span>}
      </div>
      <div className="flex-1 space-y-4 p-4 sm:p-5">
        {run.error && <ErrorBanner error={run.error} />}
        {run.loading && <AgentSteps mode={mode} />}
        {b && run.data && (<div className="rise space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-2xs font-medium uppercase tracking-wider text-faint">Opening ask</div>
              <div className={cx('num mt-0.5 font-semibold tracking-tight', isOn ? 'text-3xl text-fg' : 'text-2xl text-muted')}>{b.recommended_opening_ask_pct}%</div>
            </div>
            <div>
              <div className="text-2xs font-medium uppercase tracking-wider text-faint">Confidence</div>
              <div className={cx('num mt-0.5 font-semibold tracking-tight', isOn ? 'text-3xl text-mem' : 'text-2xl text-muted')}>{Math.round(top * 100)}%</div>
            </div>
            <div>
              <div className="text-2xs font-medium uppercase tracking-wider text-faint">Evidence</div>
              <div className="mt-1">
                {run.data.citations.length
                  ? <button onClick={() => onCite('m1')} className="num inline-flex items-center gap-1 text-[15px] font-semibold text-mem hover:underline"><FileCheck2 size={15} />{run.data.citations.length} cited</button>
                  : <Badge tone="neutral">No evidence</Badge>}
              </div>
            </div>
          </div>

          <p className={cx('text-[13.5px] leading-6', !isOn && 'text-muted')}><Cited text={b.summary} onCite={onCite} cites={cites} /></p>

          <div className="rounded-lg border border-line bg-subtle/50 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-faint"><UserRound size={12} />Who really decides</div>
            <div className={cx('mt-1 text-[13px] font-medium', !isOn && 'text-muted')}><Cited text={b.decision_maker} onCite={onCite} cites={cites} /></div>
            <div className="mt-1 text-xs leading-5 text-muted"><Cited text={b.vendor_profile} onCite={onCite} cites={cites} /></div>
          </div>

          {!!b.needs_verification?.length && (
            <VerifyCard key={b.needs_verification.map((v) => v.claim).join('|')} vendorId={run.data.vendor_id} items={b.needs_verification} onRerun={onRerun} />
          )}

          <div>
            <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-faint">Tactics, ranked</div>
            {isOn ? (
              <ol className="space-y-2">
                {b.tactics.map((t, i) => (
                  <li key={t.tactic + i} className={cx('rounded-lg border p-3', i === 0 ? 'border-mem/40 bg-mem-soft/40' : 'border-line')}>
                    <div className="flex items-center gap-3">
                      <span className={cx('num grid h-5 w-5 place-items-center rounded-full font-mono text-[11px]', i === 0 ? 'bg-mem font-semibold text-panel' : 'text-faint')}>{i + 1}</span>
                      <span className="flex-1 text-[13.5px] font-semibold">{tacticLabel(t.tactic)}</span>
                      <span className="num font-mono text-xs font-semibold text-mem">{Math.round(t.confidence * 100)}%</span>
                    </div>
                    <div className="mt-2 pl-8"><Meter value={t.confidence} tone="mem" /></div>
                    <p className="mt-2 pl-8 text-xs leading-5 text-muted"><Cited text={t.why} onCite={onCite} cites={cites} /></p>
                  </li>
                ))}
              </ol>
            ) : (
              <ol className="divide-y divide-line rounded-lg border border-line">
                {b.tactics.map((t, i) => (
                  <li key={t.tactic + i} className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <span className="num w-3 font-mono text-xs text-faint">{i + 1}</span>
                      <span className="flex-1 text-[13px] font-medium text-muted">{tacticLabel(t.tactic)}</span>
                      <span className="hidden w-20 sm:block"><Meter value={t.confidence} tone="muted" /></span>
                      <span className="num w-8 text-right font-mono text-xs text-muted">{Math.round(t.confidence * 100)}%</span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 pl-6 text-xs text-faint" title={t.why}>{t.why}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {b.watch_outs.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-faint"><ShieldAlert size={12} />Watch-outs</div>
              <ul className="space-y-1.5">
                {b.watch_outs.map((w, i) => <li key={i} className="flex gap-2 text-xs leading-5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-warn" /><span><Cited text={w} onCite={onCite} cites={cites} /></span></li>)}
              </ul>
            </div>
          )}
          {isOn && <EvidencePeek cites={run.data.citations} onCite={onCite} />}
          {run.data.trace && <Trace steps={run.data.trace} />}
        </div>)}
      </div>
    </Card>
  )
}

const TACTICS = ['competing_quote', 'multi_year', 'volume_commit', 'quarter_end_timing', 'escalate_to_exec', 'payment_terms']

function OutcomeForm({ vendorId, vendorLabel }: { vendorId: string; vendorLabel: string }) {
  const { refreshHealth, refreshVendors } = useAppData()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ tactic_used: 'competing_quote', ask: '15', got: '12', outcome: 'won', notes: '' })
  const [state, setState] = useState<'idle' | 'saving' | 'done' | string>('idle')
  const valid = useMemo(() => +f.ask >= 0 && +f.got >= 0 && f.notes.trim().length > 5, [f])
  const save = async () => {
    setState('saving')
    try {
      await api('/outcome', { vendor_id: vendorId, tactic_used: f.tactic_used, ask_discount: +f.ask / 100, final_discount: +f.got / 100, outcome: f.outcome, notes: f.notes })
      setState('done'); refreshHealth(); refreshVendors()
    } catch (e) { setState(String((e as Error).message)) }
  }
  return (
    <Card>
      <CardHeader title="Log the outcome" sub={`Retained to Hindsight as a new episode for ${vendorLabel}. The playbook re-consolidates from it.`}
        right={<Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide' : 'Open form'}</Button>} />
      {open && (
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => { e.preventDefault(); if (valid) save() }}>
          <Field label="Tactic used">
            <select className={inputCls} value={f.tactic_used} onChange={(e) => setF({ ...f, tactic_used: e.target.value })}>
              {TACTICS.map((t) => <option key={t} value={t}>{tacticLabel(t)}</option>)}
            </select>
          </Field>
          <Field label="Asked (% off)"><input className={inputCls} inputMode="decimal" value={f.ask} onChange={(e) => setF({ ...f, ask: e.target.value })} /></Field>
          <Field label="Got (% off)"><input className={inputCls} inputMode="decimal" value={f.got} onChange={(e) => setF({ ...f, got: e.target.value })} /></Field>
          <Field label="Outcome">
            <select className={inputCls} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>
              {['won', 'partial', 'lost'].map((o) => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Call notes" className="sm:col-span-2 lg:col-span-4">
            <textarea className={cx(inputCls, 'h-20 py-2')} placeholder="Who approved, what they said, what moved them…" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
            <Button variant="primary" type="submit" disabled={!valid || state === 'saving'}>{state === 'saving' ? 'Retaining…' : 'Retain to memory'}</Button>
            {state === 'done' && <span className="text-xs text-ok">Retained. Hindsight will extract facts and refresh the playbook.</span>}
            {state !== 'idle' && state !== 'saving' && state !== 'done' && <span className="text-xs text-bad">{state}</span>}
            <span className="ml-auto text-2xs text-faint">Uses the LLM for fact extraction</span>
          </div>
        </form>
      )}
    </Card>
  )
}
