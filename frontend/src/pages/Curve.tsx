import { FlaskConical, Info, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, Card, CardHeader, ErrorBanner, Skeleton, Stat } from '../components/ui'
import { useApi } from '../lib/hooks'
import type { EvalResp } from '../lib/types'

/** Read a CSS colour token so the chart follows the theme. */
const tok = (n: string) => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim().split(' ').join(',')})`

function useThemeTick() {
  const [t, setT] = useState(0)
  useEffect(() => {
    const o = new MutationObserver(() => setT((x) => x + 1))
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => o.disconnect()
  }, [])
  return t
}

export default function Curve() {
  const ev = useApi<EvalResp>('/eval/cached')
  useThemeTick()
  const s = ev.data?.series
  const rows = s ? s.memory.map((m, i) => ({ ep: m.episode, on: m.savings_pct, off: s.baseline[i]?.savings_pct })) : []
  const last5 = (arr: { savings_pct: number }[]) => arr.slice(-5).reduce((a, b) => a + b.savings_pct, 0) / Math.min(5, arr.length || 1)
  const firstWin = s?.memory.find((m) => Number(m.won) > 0)?.episode
  const finalWins = (arr?: { won: number | boolean }[]) => (arr?.length ? Number(arr[arr.length - 1].won) : 0)
  const allWon = s?.memory.find((m) => Number(m.won) === finalWins(s.memory))?.episode
  const c = { accent: tok('accent'), faint: tok('faint'), line: tok('line'), muted: tok('muted'), panel: tok('panel'), fg: tok('fg') }

  return (
    <div className="space-y-5">
      {ev.error && <ErrorBanner error={ev.error} onRetry={ev.reload} />}
      <Card className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <Stat label="Memory ON · last 5" value={s ? `${last5(s.memory).toFixed(1)}%` : '–'} sub="of max possible discount" tone="accent" />
        <Stat label="Memory OFF · last 5" value={s ? `${last5(s.baseline).toFixed(1)}%` : '–'} sub="same agent, no memory" tone="muted" />
        <Stat label="Vendors won" value={s ? `${finalWins(s.memory)} of ${ev.data?.vendors ?? 3}` : '–'} sub={firstWin ? `first at negotiation ${firstWin}, all ${finalWins(s?.memory)} by ${allWon}; baseline ${finalWins(s?.baseline)}` : ''} />
        <Stat label="Setup" value={s ? `${ev.data?.episodes ?? s.memory.length} × ${ev.data?.vendors ?? 3}` : '–'} sub="negotiations × simulated vendors" />
      </Card>

      <Card>
        <CardHeader title="Savings captured per negotiation" sub="Mean across vendors, % of each vendor’s best possible discount. Starts from an empty memory bank."
          right={<span title="A fresh run calls the LLM about 300 times. Disabled in the dashboard to protect the budget."><Button size="sm" disabled><Lock size={12} />Run fresh evaluation</Button></span>} />
        <div className="h-[340px]">
          {!s ? <Skeleton className="h-full w-full" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 12, left: -8, bottom: 4 }}>
                <CartesianGrid stroke={c.line} vertical={false} />
                <XAxis dataKey="ep" tick={{ fill: c.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: c.line }} label={{ value: 'Negotiation #', position: 'insideBottomRight', offset: -2, fill: c.faint, fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: c.muted, fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={44} />
                <ReferenceLine y={85} stroke={c.faint} strokeDasharray="4 4" label={{ value: 'win ≥ 85%', fill: c.faint, fontSize: 10, position: 'insideTopLeft' }} />
                <Tooltip contentStyle={{ background: c.panel, border: `1px solid ${c.line}`, borderRadius: 8, fontSize: 12, color: c.fg }}
                  formatter={(v: number, n) => [`${v.toFixed(1)}%`, n]} labelFormatter={(l) => `Negotiation ${l}`} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Line name="Memory ON" dataKey="on" stroke={c.accent} strokeWidth={2.5} dot={{ r: 3, fill: c.accent }} activeDot={{ r: 5 }} />
                <Line name="Memory OFF" dataKey="off" stroke={c.faint} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2.5, fill: c.faint }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader icon={<FlaskConical size={15} className="text-faint" />} title="How it was measured" />
          <ul className="space-y-1.5 text-xs leading-5 text-muted">
            <li>Each simulated vendor has hidden rules: one tactic works, one backfires, and a discount floor. The agent never sees them.</li>
            <li>Both arms use the same model, prompt and loop. Only memory differs: the ON arm retains every outcome into Hindsight and recalls it next time.</li>
            <li>Score = discount achieved ÷ the vendor’s maximum. “Won” means at least 85% of the maximum.</li>
          </ul>
        </Card>
        <Card>
          <CardHeader icon={<Info size={15} className="text-faint" />} title="Limits, stated plainly" />
          <ul className="space-y-1.5 text-xs leading-5 text-muted">
            <li>One run, three vendors, one seed. No confidence intervals.</li>
            <li>The simulator and the opening-ask rule are ours. This shows the memory loop works under that model, not real-world savings.</li>
            <li>One of the three vendors was never solved by either arm.</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
