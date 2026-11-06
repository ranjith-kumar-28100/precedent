const TACTIC_LABEL: Record<string, string> = {
  competing_quote: 'Competing quote', escalate_to_exec: 'Escalate to exec', quarter_end_timing: 'Quarter-end timing',
  multi_year: 'Multi-year commit', volume_commit: 'Volume commit', payment_terms: 'Payment terms',
}

export function tacticLabel(t: string | null | undefined): string {
  if (!t) return '—'
  return TACTIC_LABEL[t] ?? t.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`

export const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${n}`)

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s)
  if (isNaN(+d)) return s
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtTime(s: string): string {
  const d = new Date(s)
  return isNaN(+d) ? s : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function timeAgo(s: string): string {
  const sec = (Date.now() - new Date(s).getTime()) / 1000
  if (!isFinite(sec)) return ''
  if (sec < 60) return `${Math.max(1, Math.round(sec))}s ago`
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`
  return `${Math.round(sec / 86400)}d ago`
}

export const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`)

/** Strip the "| When: … | Involving: …" suffix Hindsight appends to extracted facts. */
export function cleanFact(t: string): string {
  return t.split(' | When:')[0].split(' | Involving:')[0]
}
