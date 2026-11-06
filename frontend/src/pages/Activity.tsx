import { BookMarked, Brain, Database, RefreshCw, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Empty, ErrorBanner, Segmented, SkeletonLines, cx } from '../components/ui'
import { fmtTime, ms, timeAgo } from '../lib/format'
import { useApi, useAppData } from '../lib/hooks'
import type { Ledger, OpCounts } from '../lib/types'

const KINDS: { k: keyof OpCounts; label: string; icon: typeof Search; desc: string }[] = [
  { k: 'retain', label: 'Retain', icon: Database, desc: 'Episodes written, facts extracted' },
  { k: 'recall', label: 'Recall', icon: Search, desc: 'Multi-channel memory search' },
  { k: 'reflect', label: 'Reflect', icon: Brain, desc: 'Reasoning over memories' },
  { k: 'mental_model', label: 'Mental models', icon: BookMarked, desc: 'Playbook reads and history' },
]
const kindOf = (op: string): keyof OpCounts =>
  op === 'retain' || op === 'recall' || op === 'reflect' ? op : op.includes('mental_model') ? 'mental_model' : 'other'

export default function Activity() {
  const { vendorName } = useAppData()
  const led = useApi<Ledger>('/ledger?limit=100')
  const [filter, setFilter] = useState<'all' | keyof OpCounts>('all')
  useEffect(() => {
    const t = setInterval(led.reload, 10000)
    return () => clearInterval(t)
  }, [led.reload])
  const ops = useMemo(() => (led.data?.ops ?? []).filter((o) => filter === 'all' || kindOf(o.op) === filter), [led.data, filter])
  const failed = led.data?.ops.filter((o) => !o.ok).length ?? 0
  const avg = (k: keyof OpCounts) => {
    const xs = (led.data?.ops ?? []).filter((o) => kindOf(o.op) === k && o.ok)
    return xs.length ? Math.round(xs.reduce((a, b) => a + b.ms, 0) / xs.length) : null
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KINDS.map(({ k, label, icon: I, desc }) => (
          <Card key={k} className="!p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[13px] font-medium"><I size={14} className="text-accent" />{label}</span>
              {avg(k) !== null && <span className="num font-mono text-2xs text-faint">avg {ms(avg(k)!)}</span>}
            </div>
            <div className="num mt-2 text-2xl font-semibold tracking-tight">{led.data ? led.data.counts[k] : '–'}</div>
            <div className="text-xs text-muted">{desc}</div>
          </Card>
        ))}
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <div className="text-[13.5px] font-semibold">Operation log</div>
            <div className="text-xs text-muted">Every call this server made to Hindsight, newest first{failed ? ` · ${failed} failed` : ''}. Refreshes every 10 s.</div>
          </div>
          <div className="flex items-center gap-2">
            <Segmented label="Filter" value={filter} onChange={setFilter} options={[
              { value: 'all', label: 'All' }, { value: 'recall', label: 'Recall' }, { value: 'retain', label: 'Retain' },
              { value: 'reflect', label: 'Reflect' }, { value: 'mental_model', label: 'Models' }]} />
            <Button size="sm" variant="ghost" onClick={led.reload} aria-label="Refresh"><RefreshCw size={13} className={cx(led.loading && 'animate-spin')} /></Button>
          </div>
        </div>
        {led.error && <div className="p-4"><ErrorBanner error={led.error} onRetry={led.reload} /></div>}
        {!led.data && led.loading ? <div className="p-5"><SkeletonLines n={8} /></div> : !ops.length ? (
          <div className="p-5"><Empty title="No operations yet" sub="Open a brief, the vendor memory or the explorer and calls appear here." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-2xs uppercase tracking-wider text-faint">
                  <th className="px-4 py-2 font-medium">Time</th><th className="px-2 py-2 font-medium">Operation</th>
                  <th className="px-2 py-2 font-medium">Vendor</th><th className="px-2 py-2 font-medium">Detail</th>
                  <th className="px-2 py-2 text-right font-medium">Latency</th><th className="px-4 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ops.map((o, i) => (
                  <tr key={i} className="hover:bg-subtle/50">
                    <td className="num whitespace-nowrap px-4 py-2 font-mono text-xs text-muted" title={timeAgo(o.t)}>{fmtTime(o.t)}</td>
                    <td className="px-2 py-2"><span className="font-mono text-xs font-medium">{o.op}</span></td>
                    <td className="max-w-[160px] truncate px-2 py-2 text-xs text-muted">{o.vendor_id ? vendorName(o.vendor_id) : 'bank-wide'}</td>
                    <td className="max-w-[340px] px-2 py-2 text-xs text-muted">
                      <div className="truncate" title={o.detail}>{o.detail}</div>
                      {o.error && <div className="truncate text-bad" title={o.error}>{o.error}</div>}
                    </td>
                    <td className="num whitespace-nowrap px-2 py-2 text-right font-mono text-xs">{ms(o.ms)}</td>
                    <td className="px-4 py-2 text-right"><Badge tone={o.ok ? 'ok' : 'bad'} dot>{o.ok ? 'ok' : 'failed'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
