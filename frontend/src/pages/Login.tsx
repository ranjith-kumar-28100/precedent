import { Lock, LogIn } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LogoMark } from '../components/Logo'
import { Button, cx, inputCls } from '../components/ui'
import { ApiError, api } from '../lib/api'
import type { AuthUser } from '../lib/types'

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
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <LogoMark size={44} />
          <h1 className="mt-3 text-xl font-semibold tracking-tight">Sign in to Precedent</h1>
          <p className="mt-1 text-[13px] text-muted">Buyer-side procurement-negotiation agent</p>
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-panel p-5 shadow-sm" noValidate>
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
        <p className="mt-4 flex items-center justify-center gap-1.5 text-2xs text-faint">
          <Lock size={11} />Passwords are hashed with scrypt. Sessions expire after 8 hours.
        </p>
      </div>
    </main>
  )
}
