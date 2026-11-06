import { ArrowRight, BrainCircuit, CalendarClock, CircleOff, FileCheck2, Play, ShieldAlert, Sparkles, UserRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Cited, EvidenceDrawer } from '../components/Evidence'
import { Trace } from '../components/Trace'
import { Badge, Button, Card, CardHeader, Empty, ErrorBanner, Field, Meter, SkeletonLines, cx, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { fmtDate, ms, tacticLabel, usd } from '../lib/format'
import { useApi, useAppData } from '../lib/hooks'
import type { BriefResp, Upcoming } from '../lib/types'

type Run = { data: BriefResp | null; error: string | null; loading: boolean }
const idle: Run = { data: null, error: null, loading: false }

export default function BriefPage() {
  const { vendors, vendorName, refreshHealth } = useAppData()
  const up = useApi<Upcoming[]>('/upcoming')
  const [sel, setSel] = useState(0)
  const [on, setOn] = useState<Run>(idle)
  const [off, setOff] = useState<Run>(idle)
  const [drawer, setDrawer] = useState<string | null | false>(false)
  const deal = up.data?.[sel]
  const vendor = vendors.find((v) => v.id === deal?.vendor_id)

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
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold">Upcoming negotiations</h2>
          <span className="text-xs text-muted">{up.data?.length ?? 0} on the calendar</span>
        </div>
        {up.error && <ErrorBanner error={up.error} onRetry={up.reload} />}
        <div className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1 scroll-thin">
          {(up.data ?? Array.from({ length: 4 }, () => null)).map((u, i) => (
            <button key={i} disabled={!u} onClick={() => setSel(i)} aria-pressed={i === sel}
              className={cx('w-64 shrink-0 snap-start rounded-xl border p-3 text-left transition-colors',
                i === sel && u ? 'border-accent bg-accent-soft/50 ring-1 ring-accent/30' : 'border-line bg-panel hover:border-line2')}>
              {u ? (<>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold">{vendorName(u.vendor_id)}</span>
                  <span className="num shrink-0 font-mono text-2xs text-faint">{fmtDate(u.deadline)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-[18px] text-muted">{u.objective}</p>
              </>) : <SkeletonLines n={2} />}
            </button>
          ))}
        </div>
      </section>

      {deal && (
        <Card>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">{vendorName(deal.vendor_id)}</h2>
                {vendor && <Badge>{vendor.category}</Badge>}
                {vendor && <Badge><span className="num">{vendor.episodes} past negotiations</span></Badge>}
              </div>
              <p className="text-[14px] font-medium">{deal.objective}</p>
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

      {on.data && off.data && <DeltaStrip on={on.data} off={off.data} />}

      {!on.data && !on.loading && !off.data && !off.loading && !on.error && !off.error ? (
        <Empty icon={<BrainCircuit size={22} />} title="Run the same agent twice"
          sub="Same model, same prompt, same tools. The only difference: one run can read Hindsight memory of past negotiations with this vendor." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <BriefCol mode="off" run={off} onCite={() => {}} />
          <BriefCol mode="on" run={on} onCite={(id) => setDrawer(id)} />
        </div>
      )}

      {on.data && (
        <EvidenceDrawer open={drawer !== false} onClose={() => setDrawer(false)} citations={on.data.citations}
          active={drawer || null} title={vendorName(on.data.vendor_id)} />
      )}
      {deal && <OutcomeForm vendorId={deal.vendor_id} />}
    </div>
  )
}

function DeltaStrip({ on, off }: { on: BriefResp; off: BriefResp }) {
  const c = (b: BriefResp) => Math.round(Math.max(...b.brief.tactics.map((t) => t.confidence), 0) * 100)
  const items = [
    { k: 'Top-tactic confidence', a: `${c(off)}%`, b: `${c(on)}%` },
    { k: 'Evidence cited', a: `${off.citations.length}`, b: `${on.citations.length}` },
    { k: 'Opening ask', a: `${off.brief.recommended_opening_ask_pct}%`, b: `${on.brief.recommended_opening_ask_pct}%` },
    { k: 'Lead tactic', a: tacticLabel(off.brief.tactics[0]?.tactic), b: tacticLabel(on.brief.tactics[0]?.tactic) },
  ]
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
      {items.map((x) => (
        <div key={x.k} className="bg-panel px-4 py-3">
          <div className="text-2xs font-medium uppercase tracking-wider text-faint">{x.k}</div>
          <div className="num mt-1 flex flex-wrap items-center gap-x-2 text-[15px] font-semibold">
            <span className="text-muted">{x.a}</span><ArrowRight size={13} className="text-faint" /><span className="text-accent">{x.b}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function BriefCol({ mode, run, onCite }: { mode: 'on' | 'off'; run: Run; onCite: (id: string) => void }) {
  const isOn = mode === 'on'
  const b = run.data?.brief
  const top = b ? Math.max(...b.tactics.map((t) => t.confidence), 0) : 0
  return (
    <Card pad={false} className={cx('flex flex-col overflow-hidden', isOn && 'order-first border-accent/40 ring-1 ring-accent/15 lg:order-none')}>
      <div className={cx('flex items-center justify-between gap-2 border-b px-4 py-3', isOn ? 'border-accent/20 bg-accent-soft/60' : 'border-line bg-subtle/50')}>
        <div className="flex items-center gap-2">
          {isOn ? <Sparkles size={15} className="text-accent" /> : <CircleOff size={15} className="text-faint" />}
          <span className={cx('text-[13px] font-semibold', isOn ? 'text-accent' : 'text-muted')}>Memory {isOn ? 'ON' : 'OFF'}</span>
          <span className="hidden text-xs text-muted sm:inline">{isOn ? '· reads Hindsight' : '· same agent, no memory tools'}</span>
        </div>
        {run.data && <span className="num font-mono text-2xs text-faint">{ms(run.data.latency_ms)}</span>}
      </div>
      <div className="flex-1 space-y-4 p-4 sm:p-5">
        {run.error && <ErrorBanner error={run.error} />}
        {run.loading && <div className="space-y-5"><SkeletonLines n={3} /><SkeletonLines n={4} /><SkeletonLines n={2} /></div>}
        {b && run.data && (<>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-2xs font-medium uppercase tracking-wider text-faint">Opening ask</div>
              <div className={cx('num mt-0.5 text-2xl font-semibold tracking-tight', isOn ? 'text-fg' : 'text-muted')}>{b.recommended_opening_ask_pct}%</div>
            </div>
            <div>
              <div className="text-2xs font-medium uppercase tracking-wider text-faint">Confidence</div>
              <div className={cx('num mt-0.5 text-2xl font-semibold tracking-tight', isOn ? 'text-accent' : 'text-muted')}>{Math.round(top * 100)}%</div>
            </div>
            <div>
              <div className="text-2xs font-medium uppercase tracking-wider text-faint">Evidence</div>
              <div className="mt-1">
                {run.data.citations.length
                  ? <button onClick={() => onCite('m1')} className="num inline-flex items-center gap-1 text-[15px] font-semibold text-accent hover:underline"><FileCheck2 size={15} />{run.data.citations.length} cited</button>
                  : <Badge tone="neutral">No evidence</Badge>}
              </div>
            </div>
          </div>

          <p className="text-[13.5px] leading-6"><Cited text={b.summary} onCite={onCite} /></p>

          <div className="rounded-lg border border-line bg-subtle/50 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-faint"><UserRound size={12} />Who really decides</div>
            <div className={cx('mt-1 text-[13px] font-medium', !isOn && 'text-muted')}><Cited text={b.decision_maker} onCite={onCite} /></div>
            <div className="mt-1 text-xs leading-5 text-muted"><Cited text={b.vendor_profile} onCite={onCite} /></div>
          </div>

          <div>
            <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-faint">Tactics, ranked</div>
            <ol className="space-y-2">
              {b.tactics.map((t, i) => (
                <li key={t.tactic + i} className="rounded-lg border border-line p-3">
                  <div className="flex items-center gap-3">
                    <span className="num font-mono text-xs text-faint">{i + 1}</span>
                    <span className="flex-1 text-[13px] font-semibold">{tacticLabel(t.tactic)}</span>
                    <span className={cx('num font-mono text-xs font-medium', isOn ? 'text-accent' : 'text-muted')}>{Math.round(t.confidence * 100)}%</span>
                  </div>
                  <div className="mt-2 pl-6"><Meter value={t.confidence} tone={isOn ? 'accent' : 'muted'} /></div>
                  <p className="mt-2 pl-6 text-xs leading-5 text-muted"><Cited text={t.why} onCite={onCite} /></p>
                </li>
              ))}
            </ol>
          </div>

          {b.watch_outs.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wider text-faint"><ShieldAlert size={12} />Watch-outs</div>
              <ul className="space-y-1.5">
                {b.watch_outs.map((w, i) => <li key={i} className="flex gap-2 text-xs leading-5"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-warn" /><span><Cited text={w} onCite={onCite} /></span></li>)}
              </ul>
            </div>
          )}
          {run.data.trace && <Trace steps={run.data.trace} />}
        </>)}
      </div>
    </Card>
  )
}

const TACTICS = ['competing_quote', 'multi_year', 'volume_commit', 'quarter_end_timing', 'escalate_to_exec', 'payment_terms']

function OutcomeForm({ vendorId }: { vendorId: string }) {
  const { vendorName, refreshHealth } = useAppData()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ tactic_used: 'competing_quote', ask: '15', got: '12', outcome: 'won', notes: '' })
  const [state, setState] = useState<'idle' | 'saving' | 'done' | string>('idle')
  const valid = useMemo(() => +f.ask >= 0 && +f.got >= 0 && f.notes.trim().length > 5, [f])
  const save = async () => {
    setState('saving')
    try {
      await api('/outcome', { vendor_id: vendorId, tactic_used: f.tactic_used, ask_discount: +f.ask / 100, final_discount: +f.got / 100, outcome: f.outcome, notes: f.notes })
      setState('done'); refreshHealth()
    } catch (e) { setState(String((e as Error).message)) }
  }
  return (
    <Card>
      <CardHeader title="Log the outcome" sub={`Retained to Hindsight as a new episode for ${vendorName(vendorId)}. The playbook re-consolidates from it.`}
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
