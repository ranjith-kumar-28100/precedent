import { AlertTriangle, Inbox } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad'
const TONE: Record<Tone, string> = {
  neutral: 'bg-subtle text-muted border-line',
  accent: 'bg-accent-soft text-accent border-accent/25',
  ok: 'bg-ok/10 text-ok border-ok/25',
  warn: 'bg-warn/10 text-warn border-warn/25',
  bad: 'bg-bad/10 text-bad border-bad/25',
}

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap', TONE[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export const outcomeTone = (o: string | null | undefined): Tone => (o === 'won' ? 'ok' : o === 'lost' ? 'bad' : o === 'partial' ? 'warn' : 'neutral')

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={cx('rounded-xl border border-line bg-panel shadow-card', pad && 'p-4 sm:p-5', className)}>{children}</section>
}

export function CardHeader({ title, sub, right, icon }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-fg">{icon}{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' }
export function Button({ variant = 'secondary', size = 'md', className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-[13px]',
        variant === 'primary' && 'bg-accent text-accent-fg hover:bg-accent/90',
        variant === 'secondary' && 'border border-line bg-panel text-fg hover:bg-subtle',
        variant === 'ghost' && 'text-muted hover:bg-subtle hover:text-fg',
        className,
      )}
    />
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx('h-7 rounded-md px-2.5 text-xs font-medium transition-colors',
            value === o.value ? 'bg-panel text-fg shadow-card' : 'text-muted hover:text-fg')}
        >{o.label}</button>
      ))}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cx('relative overflow-hidden rounded-md bg-subtle', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-panel/60 to-transparent" />
    </div>
  )
}

export function SkeletonLines({ n = 4 }: { n?: number }) {
  return <div className="space-y-2.5">{Array.from({ length: n }, (_, i) => <Skeleton key={i} className={cx('h-3.5', i === n - 1 ? 'w-2/3' : 'w-full')} />)}</div>
}

export function Empty({ title, sub, icon }: { title: string; sub?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <div className="text-faint">{icon ?? <Inbox size={20} />}</div>
      <p className="text-[13px] font-medium text-fg">{title}</p>
      {sub && <p className="max-w-sm text-xs text-muted">{sub}</p>}
    </div>
  )
}

export function ErrorBanner({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-bad/30 bg-bad/5 px-3 py-2.5 text-[13px] text-bad">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{error}</div>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'accent' | 'muted' }) {
  return (
    <div className="min-w-0">
      <div className="text-2xs font-medium uppercase tracking-wider text-faint">{label}</div>
      <div className={cx('num mt-1 text-xl font-semibold tracking-tight', tone === 'accent' ? 'text-accent' : tone === 'muted' ? 'text-muted' : 'text-fg')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  )
}

export function Meter({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'muted' }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-subtle" role="meter" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full', tone === 'accent' ? 'bg-accent' : 'bg-faint')} style={{ width: `${Math.max(2, value * 100)}%` }} />
    </div>
  )
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return <div className={cx('md', className)}><ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown></div>
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-2xs font-medium uppercase tracking-wider text-faint">{label}</span>
      {children}
    </label>
  )
}

export const inputCls = 'h-9 w-full min-w-0 rounded-lg border border-line bg-panel px-3 text-[13px] text-fg placeholder:text-faint hover:border-line2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20'

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-subtle px-1 font-mono text-[10px] text-muted">{children}</kbd>
}
