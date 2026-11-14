import { FileText, Lock, LogIn, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LogoMark } from '../components/Logo'
import { Button, cx, inputCls } from '../components/ui'
import { ApiError, api } from '../lib/api'
import type { AuthUser } from '../lib/types'

const FEATURES: { icon: typeof FileText; text: string }[] = [
  { icon: FileText, text: 'Briefs that cite the memory behind every claim' },
  { icon: ShieldCheck, text: 'Stale or uncited facts flagged before you rely on them' },
  { icon: RefreshCw, text: 'Playbooks rewritten after every outcome' },
]

/** Dark brand panel beside the form. Shown from `lg` up; the tokens inside resolve to the dark palette in both themes. */
function BrandPanel() {
  return (
    <aside aria-label="About Precedent" className="side-dark relative hidden overflow-hidden border-r border-line bg-panel text-fg lg:flex lg:w-[46%] lg:max-w-[640px] lg:flex-col lg:justify-between lg:gap-10 lg:p-12 xl:p-16">
      <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-mem/10 blur-3xl" />
      <div className="relative flex items-center gap-2.5">
        <LogoMark size={30} />
        <span className="text-[16px] font-semibold tracking-tight">Precedent</span>
      </div>

      <div className="rise relative max-w-[30rem]">
        <h2 className="text-[34px] font-semibold leading-[1.12] tracking-tight xl:text-[40px]">Every negotiation makes the next one better.</h2>
        <p className="mt-4 text-[15px] leading-6 text-muted">A buyer-side procurement-negotiation agent that remembers every past deal in Hindsight.</p>

        <figure className="mt-9 rounded-xl border border-line bg-subtle/60 p-5">
          <div className="num flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <div className="text-[44px] font-semibold leading-none tracking-tight text-mem">75.6%</div>
              <div className="mt-2 text-xs font-medium text-mem">with memory</div>
            </div>
            <div>
              <div className="text-[44px] font-semibold leading-none tracking-tight text-muted">39.9%</div>
              <div className="mt-2 text-xs font-medium text-muted">without memory</div>
            </div>
          </div>
          <figcaption className="mt-4 border-t border-line pt-3 text-xs leading-5 text-muted">
            of the best possible discount captured: last 5 of 10 simulated negotiations, one run
          </figcaption>
        </figure>
      </div>

      <ul className="relative space-y-3">
        {FEATURES.map(({ icon: I, text }) => (
          <li key={text} className="flex items-center gap-3 text-[13px] text-muted">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-subtle text-fg"><I size={14} aria-hidden /></span>
            {text}
          </li>
        ))}
      </ul>
    </aside>
  )
}

export default function Login({ onSignedIn }: { onSignedIn: (u: AuthUser) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { first.current?.focus() }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setBusy(true); setError(null)
    try {
      onSignedIn(await api<AuthUser>('/auth/login', { username: username.trim(), password }))
    } catch (err) {
      setPassword('')
      setError(err instanceof ApiError ? err.detail : 'Could not reach the server.')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <BrandPanel />
      <main className="flex min-w-0 flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-[24rem]">
          <div className="mb-6 flex flex-col items-center text-center lg:items-start lg:text-left">
            <div className="lg:hidden"><LogoMark size={44} /></div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight lg:mt-0 lg:text-2xl">Sign in to Precedent</h1>
            <p className="mt-1 text-[13px] text-muted">Buyer-side procurement-negotiation agent</p>
          </div>
          <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-panel p-5 shadow-card" noValidate>
            <label className="block text-xs font-medium text-muted">
              Username
              <input ref={first} className={cx(inputCls, 'mt-1')} autoComplete="username" value={username}
                onChange={(e) => setUsername(e.target.value)} disabled={busy} required />
            </label>
            <label className="block text-xs font-medium text-muted">
              Password
              <input type="password" className={cx(inputCls, 'mt-1')} autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} disabled={busy} required />
            </label>
            {error && <p role="alert" className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-xs text-bad">{error}</p>}
            <Button type="submit" variant="primary" className="w-full justify-center" disabled={busy || !username.trim() || !password}>
              <LogIn size={14} />{busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-2xs text-faint lg:justify-start">
            <Lock size={11} aria-hidden className="shrink-0" />Passwords are hashed with scrypt. Sessions expire after 8 hours.
          </p>
        </div>
      </main>
    </div>
  )
}
