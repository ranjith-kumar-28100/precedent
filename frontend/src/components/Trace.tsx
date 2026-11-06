import { ChevronRight, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { TraceStep } from '../lib/types'
import { cx } from './ui'

const show = (v: unknown) => {
  if (v === '' || v === null || v === undefined) return ''
  if (typeof v === 'string') {
    try { const o = JSON.parse(v); return Object.keys(o).length ? JSON.stringify(o) : '' } catch { return v }
  }
  return JSON.stringify(v)
}

export function Trace({ steps, label = 'Agent trace' }: { steps: TraceStep[]; label?: string }) {
  const [open, setOpen] = useState(false)
  if (!steps.length) return null
  return (
    <div className="rounded-lg border border-line">
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted hover:text-fg">
        <ChevronRight size={14} className={cx('transition-transform', open && 'rotate-90')} />
        <Wrench size={13} />{label}<span className="num ml-auto font-mono text-faint">{steps.length} tool calls</span>
      </button>
      {open && (
        <ol className="space-y-0 border-t border-line px-3 py-2">
          {steps.map((s) => (
            <li key={s.step} className="relative flex gap-3 py-1.5 pl-1">
              <span className="num mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-subtle font-mono text-[10px] text-muted">{s.step}</span>
              <div className="min-w-0 text-xs">
                <span className="font-mono font-medium text-fg">{s.tool}</span>
                {show(s.args) && <span className="ml-1.5 break-all font-mono text-faint">{show(s.args).slice(0, 120)}</span>}
                {show(s.result) && <div className="mt-0.5 line-clamp-2 break-words text-muted">→ {show(s.result).slice(0, 240)}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
