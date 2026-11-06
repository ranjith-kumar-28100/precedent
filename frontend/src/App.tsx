import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layout, NAV, type Route } from './components/Layout'
import { AppCtx, useApi } from './lib/hooks'
import type { Health, Vendor } from './lib/types'
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

export default function App() {
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
    return { vendors: list, vendorName: (id: string | null | undefined) => (id ? byId.get(id) ?? id : 'All vendors'), health: health.data, refreshHealth: health.reload }
  }, [vendors.data, health.data, health.reload])

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
