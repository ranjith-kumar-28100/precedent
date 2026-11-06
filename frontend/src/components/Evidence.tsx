import { BookMarked, Lightbulb, Quote, X } from 'lucide-react'
import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import { cleanFact, fmtDate } from '../lib/format'
import type { Citation } from '../lib/types'
import { Badge, Markdown, cx } from './ui'

const KIND: Record<string, { label: string; icon: typeof Quote }> = {
  fact: { label: 'Fact', icon: Quote },
  observation: { label: 'Observation', icon: Lightbulb },
  mental_model: { label: 'Playbook', icon: BookMarked },
}

export function CiteChip({ id, onClick, active }: { id: string; onClick?: (id: string) => void; active?: boolean }) {
  return (
    <button type="button" onClick={() => onClick?.(id)}
      className={cx('mx-0.5 inline-flex h-[18px] -translate-y-px items-center rounded px-1 align-middle font-mono text-[10.5px] font-semibold transition-colors',
        active ? 'bg-accent text-accent-fg' : 'bg-accent-soft text-accent hover:bg-accent hover:text-accent-fg')}
      aria-label={`Show evidence ${id}`}>{id}</button>
  )
}

/** Turn "… [m2][m4] …" into text with clickable evidence chips. */
export function Cited({ text, onCite, active }: { text: string; onCite?: (id: string) => void; active?: string | null }): ReactNode {
  const parts = text.split(/\[(m\d+)\]/g)
  return parts.map((p, i) => (i % 2 ? <CiteChip key={i} id={p} onClick={onCite} active={active === p} /> : <Fragment key={i}>{p}</Fragment>))
}

export function EvidenceItem({ c, active, vendorName }: { c: Citation; active?: boolean; vendorName?: string }) {
  const k = KIND[c.kind] ?? KIND.fact
  const I = k.icon
  return (
    <li id={`ev-${c.id}`} className={cx('rounded-lg border p-3 transition-colors', active ? 'border-accent bg-accent-soft/60' : 'border-line bg-panel')}>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] font-semibold text-accent">{c.id}</span>
        <Badge tone={c.kind === 'mental_model' ? 'accent' : 'neutral'}><I size={11} />{k.label}</Badge>
        {c.date && <span className="num text-2xs text-faint">{fmtDate(c.date)}</span>}
        {vendorName && <span className="text-2xs text-muted">· {vendorName}</span>}
      </div>
      {c.kind === 'mental_model' && c.text.includes('\n') ? <Markdown className="!text-[12.5px] !leading-5">{c.text}</Markdown>
        : <p className="text-[12.5px] leading-5 text-fg">{cleanFact(c.text)}</p>}
    </li>
  )
}

export function EvidenceDrawer({ open, onClose, citations, active, title, vendorName }: {
  open: boolean; onClose: () => void; citations: Citation[]; active: string | null; title: string; vendorName?: (id: string | null | undefined) => string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    ref.current?.focus()
    return () => removeEventListener('keydown', k)
  }, [open, onClose])
  useEffect(() => {
    if (open && active) document.getElementById(`ev-${active}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [open, active])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-fg/20" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-label="Evidence"
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line bg-bg shadow-pop outline-none">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="text-[13.5px] font-semibold">Evidence from Hindsight</div>
            <div className="text-xs text-muted">{title} · {citations.length} memories</div>
          </div>
          <button onClick={onClose} aria-label="Close evidence" className="rounded-md p-1.5 text-muted hover:bg-subtle"><X size={16} /></button>
        </div>
        <ul className="flex-1 space-y-2 overflow-y-auto p-4 scroll-thin">
          {citations.map((c) => <EvidenceItem key={c.id} c={c} active={c.id === active} vendorName={vendorName && (c.vendor || c.vendor_id) ? vendorName(c.vendor || c.vendor_id) : undefined} />)}
        </ul>
      </div>
    </div>
  )
}
