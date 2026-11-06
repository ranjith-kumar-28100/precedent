const qs = new URLSearchParams(location.search)
/** Mock mode: `?mock=1` or VITE_MOCK=1. Every endpoint, including the LLM ones, is served from local fixtures. */
export const MOCK = qs.get('mock') === '1' || import.meta.env.VITE_MOCK === '1'

export class ApiError extends Error {}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  if (MOCK) return (await import('../mock/mockApi')).mockApi(path, body) as Promise<T>
  const res = await fetch('/api' + path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = res.statusText
    try { detail = (await res.json()).detail ?? detail } catch { /* not JSON */ }
    throw new ApiError(`${res.status} on ${path}: ${detail}`)
  }
  return res.json() as Promise<T>
}
