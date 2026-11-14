import { Activity, BookOpen, Database, FileText, Info, LineChart, LogOut, Menu, MessageSquare, Monitor, Moon, Search, Sun, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MOCK } from '../lib/api'
import { useAppData } from '../lib/hooks'
import { LogoMark } from './Logo'
import { Badge, cx } from './ui'

export type Route = 'brief' | 'vendor' | 'explorer' | 'chat' | 'curve' | 'activity'
export const NAV: { id: Route; label: string; icon: typeof FileText; group: string; hint: string }[] = [
  { id: 'brief', label: 'Brief', icon: FileText, group: 'Negotiate', hint: 'Memory ON vs OFF for an upcoming deal' },
  { id: 'chat', label: 'Ask memory', icon: MessageSquare, group: 'Negotiate', hint: 'Chat over every past negotiation' },
  { id: 'vendor', label: 'Vendor memory', icon: BookOpen, group: 'Hindsight', hint: 'Playbook, versions, episodes' },
  { id: 'explorer', label: 'Memory explorer', icon: Search, group: 'Hindsight', hint: 'Recall with retrieval trace' },
  { id: 'activity', label: 'Memory activity', icon: Activity, group: 'Hindsight', hint: 'Every retain, recall, reflect' },
  { id: 'curve', label: 'Learning curve', icon: LineChart, group: 'Evaluate', hint: 'Does memory improve outcomes?' },
]

type ThemePref = 'light' | 'system' | 'dark'
function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(() => {
    try { return (localStorage.getItem('precedent-theme') as ThemePref) || 'system' } catch { return 'system' }
  })
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', pref === 'dark' || (pref === 'system' && mq.matches))
    apply()
    try { pref === 'system' ? localStorage.removeItem('precedent-theme') : localStorage.setItem('precedent-theme', pref) } catch { /* storage blocked */ }
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [pref])
  return [pref, setPref]
}

function ThemeSwitch() {
  const [pref, setPref] = useTheme()
  const opts: { v: ThemePref; icon: typeof Sun; label: string }[] = [
    { v: 'light', icon: Sun, label: 'Light' }, { v: 'system', icon: Monitor, label: 'System' }, { v: 'dark', icon: Moon, label: 'Dark' }]
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
      {opts.map(({ v, icon: I, label }) => (
        <button key={v} role="radio" aria-checked={pref === v} aria-label={label} title={label} onClick={() => setPref(v)}
          className={cx('grid h-6 w-7 place-items-center rounded-md', pref === v ? 'bg-panel text-fg shadow-card' : 'text-faint hover:text-fg')}>
          <I size={13} />
        </button>
      ))}
    </div>
  )
}

function Sidebar({ route, go, onClose }: { route: Route; go: (r: Route) => void; onClose?: () => void }) {
  const { health } = useAppData()
  const groups = [...new Set(NAV.map((n) => n.group))]
  return (
    <nav className="side-dark flex h-full flex-col gap-5 bg-panel px-3 py-4 text-fg" aria-label="Main">
      <div className="flex items-center justify-between px-2">
        <a href="#brief" className="flex items-center gap-2.5" onClick={() => go('brief')}>
          <LogoMark size={26} />
          <div className="leading-tight">
            <div className="text-[14px] font-semibold tracking-tight text-fg">Precedent</div>
            <div className="text-2xs text-muted">Negotiation memory</div>
          </div>
        </a>
        {onClose && <button onClick={onClose} aria-label="Close menu" className="rounded-md p-1 text-muted hover:bg-subtle hover:text-fg lg:hidden"><X size={16} /></button>}
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto scroll-thin">
        {groups.map((g) => (
          <div key={g}>
            <div className="px-2 pb-1.5 text-2xs font-medium uppercase tracking-wider text-muted/80">{g}</div>
            <ul className="space-y-0.5">
              {NAV.filter((n) => n.group === g).map(({ id, label, icon: I }) => (
                <li key={id}>
                  <a href={`#${id}`} onClick={() => go(id)} aria-current={route === id ? 'page' : undefined}
                    className={cx('flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] font-medium transition-colors',
                      route === id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-subtle hover:text-fg')}>
                    <I size={15} strokeWidth={2} />{label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <SignedIn />
      <div className="space-y-2 rounded-lg border border-mem/25 bg-mem-soft/40 p-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-medium text-fg"><Database size={13} className="text-mem" aria-hidden />Hindsight</span>
          <Badge tone={health?.hindsight ? 'ok' : health ? 'bad' : 'neutral'} dot>{health ? (health.hindsight ? 'Online' : 'Offline') : '…'}</Badge>
        </div>
        <div className="num truncate font-mono text-2xs text-muted">{health?.bank_id ?? 'precedent-procurement'}</div>
        {(health?.bank_stats || health?.ledger_counts) && (() => {
          const b = health.bank_stats, l = health.ledger_counts
          // Lifetime totals from Hindsight's own stats when available; the in-process ledger resets on API restart.
          const tiles: [number, string, string][] = b
            ? [[b.documents, 'retained', 'Documents retained into this bank'],
               [b.memories, 'memories', `Facts and observations Hindsight extracted (${b.observations} observations)`],
               [b.reflect, 'reflect', 'Playbook rewrites Hindsight ran with reflect']]
            : [[l!.retain, 'retain', ''], [l!.recall, 'recall', ''], [l!.reflect, 'reflect', '']]
          return (<>
            <div className="num grid grid-cols-3 gap-1 pt-1 text-center">
              {tiles.map(([n, k, tip]) => (
                <div key={k} title={tip} className="rounded-md bg-panel/70 py-1.5">
                  <div className="text-[15.5px] font-semibold leading-5 tracking-tight text-mem">{n}</div>
                  <div className="text-[10px] text-muted">{k}</div>
                </div>
              ))}
            </div>
            {b && l && <div className="num text-[10px] text-muted">{l.recall} recalls · {l.retain} retains this session</div>}
          </>)
        })()}
      </div>
    </nav>
  )
}

function SignedIn() {
  const { user, signOut } = useAppData()
  if (!user || !signOut) return null
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-xs">
      <UserRound size={14} className="shrink-0 text-muted" aria-hidden />
      <div className="min-w-0 flex-1"><div className="truncate font-medium text-fg">{user.display_name}</div><div className="truncate text-2xs text-muted">signed in</div></div>
      <button onClick={signOut} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-2xs font-medium text-muted hover:bg-subtle hover:text-fg"><LogOut size={12} />Sign out</button>
    </div>
  )
}

/** Header popover: where the data comes from, which model is running and what it has cost this session. */
function DataInfo() {
  const { health } = useAppData()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  const spend = health?.agent_spend_usd, budget = health?.agent_budget_usd
  const mono = 'num font-mono text-[12px]'
  return (
    <div ref={wrap} className="relative">
      <button ref={btn} type="button" aria-label="About this data" title="About this data" aria-haspopup="dialog" aria-expanded={open} aria-controls="data-info-panel"
        onClick={() => setOpen((o) => !o)}
        className={cx('grid h-7 w-7 place-items-center rounded-lg border border-line', open ? 'bg-subtle text-fg' : 'bg-panel text-muted hover:bg-subtle hover:text-fg')}>
        <Info size={14} />
      </button>
      {open && (
        <div id="data-info-panel" role="dialog" aria-label="About this data"
          className="rise absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-panel p-3 text-xs shadow-pop">
          <dl className="space-y-2">
            <div>
              <dt className="text-2xs font-medium uppercase tracking-wider text-faint">Data</dt>
              <dd className="mt-0.5 text-fg">synthetic negotiation history · real market benchmarks</dd>
            </div>
            <div>
              <dt className="text-2xs font-medium uppercase tracking-wider text-faint">Model</dt>
              <dd className={cx('mt-0.5 break-words text-fg', mono)}>{health?.llm ?? '…'}</dd>
            </div>
            <div>
              <dt className="text-2xs font-medium uppercase tracking-wider text-faint">Agent spend this session</dt>
              <dd className={cx('mt-0.5 text-fg', mono)}>
                {spend === undefined ? '…' : `$${spend.toFixed(2)}${budget === undefined ? '' : ` of $${budget.toFixed(0)}`}`}
              </dd>
            </div>
          </dl>
          <p className="num mt-2.5 border-t border-line pt-2 text-muted">{health ? `${health.llm_calls ?? 0} agent LLM calls this session` : '…'}</p>
        </div>
      )}
    </div>
  )
}

export function Layout({ route, go, children }: { route: Route; go: (r: Route) => void; children: ReactNode }) {
  const { health } = useAppData()
  const [open, setOpen] = useState(false)
  const cur = NAV.find((n) => n.id === route)!
  return (
    <div className="flex min-h-full">
      <aside className="side-dark hidden w-60 shrink-0 border-r border-line bg-panel text-fg lg:block"><div className="sticky top-0 h-screen"><Sidebar route={route} go={go} /></div></aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-fg/30" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 shadow-pop"><Sidebar route={route} go={(r) => { go(r); setOpen(false) }} onClose={() => setOpen(false)} /></div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="-ml-1 rounded-md p-1.5 text-muted hover:bg-subtle lg:hidden"><Menu size={18} /></button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[16.5px] font-semibold leading-tight tracking-tight">{cur.label}</h1>
            <p className="hidden truncate text-xs text-muted sm:block">{cur.hint}</p>
          </div>
          <div className="flex items-center gap-2">
            {MOCK && <Badge tone="warn">Mock data</Badge>}
            <span className="hidden sm:inline-flex"><Badge tone={!health ? 'neutral' : health.hindsight ? 'ok' : 'bad'} dot>{!health ? 'Hindsight…' : health.hindsight ? 'Hindsight online' : 'Hindsight offline'}</Badge></span>
            <DataInfo />
            <ThemeSwitch />
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
  )
}
