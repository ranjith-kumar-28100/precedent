import { BookMarked, Lightbulb, Quote, X } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cleanFact, fmtDate } from '../lib/format'
import type { Citation } from '../lib/types'
import { Badge, Markdown, cx } from './ui'

const KIND: Record<string, { label: string; icon: typeof Quote }> = {
  fact: { label: 'Fact', icon: Quote },
  observation: { label: 'Observation', icon: Lightbulb },
  mental_model: { label: 'Playbook', icon: BookMarked },
}

/** Evidence chip. With `cite`, hovering or focusing it previews the memory; clicking opens the full evidence list. */
export function CiteChip({ id, onClick, active, cite }: { id: string; onClick?: (id: string) => void; active?: boolean; cite?: Citation }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const show = (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, innerWidth - 328))
    setPos(r.bottom + 190 > innerHeight ? { left, bottom: innerHeight - r.top + 6 } : { left, top: r.bottom + 6 })
  }
  const hide = () => setPos(null)
  const k = cite ? KIND[cite.kind] ?? KIND.fact : null
  return (
    <>
      <button type="button" onClick={() => onClick?.(id)}
        onMouseEnter={cite ? show : undefined} onMouseLeave={hide} onFocus={cite ? show : undefined} onBlur={hide}
        className={cx('mx-0.5 inline-flex h-[18px] -translate-y-px items-center rounded px-1 align-middle font-mono text-[10.5px] font-semibold transition-colors',
          active ? 'bg-mem text-panel' : 'bg-mem-soft text-mem hover:bg-mem hover:text-panel')}
        aria-label={`Show evidence ${id}`}>{id}</button>
      {pos && cite && k && createPortal(
        <div role="tooltip" style={pos} className="rise pointer-events-none fixed z-[60] w-80 rounded-lg border border-mem/30 bg-panel p-3 text-left shadow-pop">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] font-semibold text-mem">{cite.id}</span>
            <Badge tone={cite.kind === 'mental_model' ? 'mem' : 'neutral'}><k.icon size={11} />{k.label}</Badge>
            {cite.date && <span className="num text-2xs text-faint">{fmtDate(cite.date)}</span>}
          </div>
          <p className="line-clamp-5 text-[12.5px] font-normal leading-5 text-fg">{cleanFact(cite.text)}</p>
          <p className="mt-1.5 text-2xs font-normal text-faint">Memory from Hindsight · click to see all evidence</p>
        </div>, document.body)}
    </>
  )
}

/** Turn "… [m2][m4] …" into text with clickable evidence chips. */
export function Cited({ text, onCite, active, cites }: { text: string; onCite?: (id: string) => void; active?: string | null; cites?: Citation[] }): ReactNode {
  const parts = text.split(/\[(m\d+)\]/g)
  return parts.map((p, i) => (i % 2
    ? <CiteChip key={i} id={p} onClick={onCite} active={active === p} cite={cites?.find((c) => c.id === p)} />
    : <Fragment key={i}>{p}</Fragment>))
}

export function EvidenceItem({ c, active, vendorName }: { c: Citation; active?: boolean; vendorName?: string }) {
  const k = KIND[c.kind] ?? KIND.fact
  const I = k.icon
  return (
    <li id={`ev-${c.id}`} className={cx('rounded-lg border p-3 transition-colors', active ? 'border-mem bg-mem-soft/60' : 'border-line bg-panel')}>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] font-semibold text-mem">{c.id}</span>
        <Badge tone={c.kind === 'mental_model' ? 'mem' : 'neutral'}><I size={11} />{k.label}</Badge>
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
