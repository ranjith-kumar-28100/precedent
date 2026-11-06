import { Activity, BookOpen, Database, FileText, LineChart, Menu, MessageSquare, Monitor, Moon, Search, Sun, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
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
    <nav className="flex h-full flex-col gap-5 bg-panel px-3 py-4" aria-label="Main">
      <div className="flex items-center justify-between px-2">
        <a href="#brief" className="flex items-center gap-2.5" onClick={() => go('brief')}>
          <LogoMark size={26} />
          <div className="leading-tight">
            <div className="text-[14px] font-semibold tracking-tight">Precedent</div>
            <div className="text-2xs text-faint">Negotiation memory</div>
          </div>
        </a>
        {onClose && <button onClick={onClose} aria-label="Close menu" className="rounded-md p-1 text-muted hover:bg-subtle lg:hidden"><X size={16} /></button>}
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto scroll-thin">
        {groups.map((g) => (
          <div key={g}>
            <div className="px-2 pb-1.5 text-2xs font-medium uppercase tracking-wider text-faint">{g}</div>
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
      <div className="space-y-2 rounded-lg border border-line bg-subtle/60 p-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-medium"><Database size={13} className="text-faint" />Hindsight</span>
          <Badge tone={health?.hindsight ? 'ok' : health ? 'bad' : 'neutral'} dot>{health ? (health.hindsight ? 'Online' : 'Offline') : '…'}</Badge>
        </div>
        <div className="num font-mono text-2xs text-faint">{health?.bank_id ?? 'precedent-procurement'}</div>
        {health?.ledger_counts && (
          <div className="num grid grid-cols-3 gap-1 pt-1 text-center">
            {(['retain', 'recall', 'reflect'] as const).map((k) => (
              <div key={k} className="rounded-md bg-panel py-1">
                <div className="text-[13px] font-semibold text-fg">{health.ledger_counts![k]}</div>
                <div className="text-[10px] text-faint">{k}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}

export function Layout({ route, go, children }: { route: Route; go: (r: Route) => void; children: ReactNode }) {
  const { health } = useAppData()
  const [open, setOpen] = useState(false)
  const cur = NAV.find((n) => n.id === route)!
  const spend = health?.agent_spend_usd
  return (
    <div className="flex min-h-full">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-panel lg:block"><div className="sticky top-0 h-screen"><Sidebar route={route} go={go} /></div></aside>
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
            <h1 className="truncate text-[14px] font-semibold">{cur.label}</h1>
            <p className="hidden truncate text-xs text-muted sm:block">{cur.hint}</p>
          </div>
          <div className="flex items-center gap-2">
            {MOCK && <Badge tone="warn">Mock data</Badge>}
            <span className="hidden md:inline-flex"><Badge>Synthetic history · Real market data</Badge></span>
            <span className="hidden sm:inline-flex"><Badge tone={!health ? 'neutral' : health.hindsight ? 'ok' : 'bad'} dot>{!health ? 'Hindsight…' : health.hindsight ? 'Hindsight online' : 'Hindsight offline'}</Badge></span>
            {spend !== undefined && (
              <span className="hidden xl:inline-flex" title={`${health?.llm_calls ?? 0} agent LLM calls this session`}>
                <Badge><span className="num font-mono">{health?.llm} · ${spend.toFixed(2)} / ${health?.agent_budget_usd?.toFixed(0)}</span></Badge>
              </span>
            )}
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
