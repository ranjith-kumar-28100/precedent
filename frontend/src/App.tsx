import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layout, NAV, type Route } from './components/Layout'
import { AppCtx, useApi } from './lib/hooks'
import { ApiError, api } from './lib/api'
import type { AuthMe, AuthUser, Health, Vendor } from './lib/types'
import Login from './pages/Login'
import Activity from './pages/Activity'
import BriefPage from './pages/Brief'
import Chat from './pages/Chat'
import Curve from './pages/Curve'
import Explorer from './pages/Explorer'
import VendorMemory from './pages/VendorMemory'

const routeFromHash = (): Route => {
  const h = location.hash.slice(1) as Route
  return NAV.some((n) => n.id === h) ? h : 'brief'
}

/** Checks the session first; the app (and its data requests) only mounts once signed in, or when sign-in is off. */
export default function App() {
  const [auth, setAuth] = useState<{ checked: boolean; enabled: boolean; user: AuthUser | null }>({ checked: false, enabled: false, user: null })
  const check = useCallback(() => {
    api<AuthMe>('/auth/me')
      .then((m) => setAuth({ checked: true, enabled: m.auth_enabled, user: m.user }))
      .catch((e) => setAuth({ checked: true, enabled: e instanceof ApiError && e.status === 401, user: null }))
  }, [])
  useEffect(() => { check() }, [check])
  useEffect(() => {
    const out = () => setAuth((a) => ({ ...a, user: null }))
    addEventListener('precedent:signed-out', out)
    return () => removeEventListener('precedent:signed-out', out)
  }, [])
  const signOut = useCallback(async () => {
    try { await api('/auth/logout', {}) } finally { setAuth((a) => ({ ...a, user: null })) }
  }, [])
  if (!auth.checked) return null
  if (auth.enabled && !auth.user) return <Login onSignedIn={(u) => setAuth({ checked: true, enabled: true, user: u })} />
  return <Shell user={auth.user} signOut={auth.enabled ? signOut : undefined} />
}

function Shell({ user, signOut }: { user: AuthUser | null; signOut?: () => void }) {
  const [route, setRoute] = useState<Route>(routeFromHash)
  useEffect(() => {
    const on = () => setRoute(routeFromHash())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  const go = useCallback((r: Route) => setRoute(r), [])
  useEffect(() => { window.scrollTo(0, 0) }, [route])

  const vendors = useApi<Vendor[]>('/vendors')
  const health = useApi<Health>('/health')
  // Refresh status (spend, ledger counts) every 5 s and on every screen change; the health endpoint never calls the LLM.
  useEffect(() => {
    const t = setInterval(health.reload, 5000)
    return () => clearInterval(t)
  }, [health.reload])
  useEffect(() => { health.reload() }, [route, health.reload])

  const ctx = useMemo(() => {
    const list = vendors.data ?? []
    const byId = new Map(list.map((v) => [v.id, v.name]))
    return { vendors: list, vendorName: (id: string | null | undefined) => (id ? byId.get(id) ?? id : 'All vendors'), health: health.data, refreshHealth: health.reload, refreshVendors: vendors.reload, user, signOut }
  }, [vendors.data, vendors.reload, health.data, health.reload, user, signOut])

  return (
    <AppCtx.Provider value={ctx}>
      <Layout route={route} go={go}>
        {route === 'brief' && <BriefPage />}
        {route === 'vendor' && <VendorMemory />}
        {route === 'explorer' && <Explorer />}
        {route === 'chat' && <Chat />}
        {route === 'curve' && <Curve />}
        {route === 'activity' && <Activity />}
      </Layout>
    </AppCtx.Provider>
  )
}
