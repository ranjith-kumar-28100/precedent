import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { Health, Vendor } from './types'

export type AsyncState<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void }

/** GET-style fetch keyed on `path`; pass null to skip. */
export function useApi<T>(path: string | null, deps: unknown[] = []): AsyncState<T> {
  const [state, set] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!path })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!path) return
    let live = true
    set((s) => ({ ...s, loading: true, error: null }))
    api<T>(path).then(
      (data) => live && set({ data, error: null, loading: false }),
      (e) => live && set({ data: null, error: String(e.message ?? e), loading: false }),
    )
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps])
  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) }
}

/** POST action with its own loading/error state; stale responses are dropped. */
export function useAction<B, T>(path: string) {
  const [state, set] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: false })
  const seq = useRef(0)
  const run = useCallback(async (body: B) => {
    const n = ++seq.current
    set((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await api<T>(path, body)
      if (n === seq.current) set({ data, error: null, loading: false })
      return data
    } catch (e) {
      if (n === seq.current) set({ data: null, error: String((e as Error).message ?? e), loading: false })
      return null
    }
  }, [path])
  const reset = useCallback(() => set({ data: null, error: null, loading: false }), [])
  return { ...state, run, reset }
}

export type AppData = { vendors: Vendor[]; vendorName: (id: string | null | undefined) => string; health: Health | null; refreshHealth: () => void }
export const AppCtx = createContext<AppData>({ vendors: [], vendorName: (id) => id ?? '', health: null, refreshHealth: () => {} })
export const useAppData = () => useContext(AppCtx)
