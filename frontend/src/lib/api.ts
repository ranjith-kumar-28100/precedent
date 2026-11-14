const qs = new URLSearchParams(location.search)
/** Mock mode: `?mock=1` or VITE_MOCK=1. Every endpoint, including the LLM ones, is served from local fixtures. */
export const MOCK = qs.get('mock') === '1' || import.meta.env.VITE_MOCK === '1'

/** `status` is the HTTP code (0 if unknown); `detail` is the server's message, flattened to readable text. */
export class ApiError extends Error {
  constructor(message: string, readonly status = 0, readonly detail = message) { super(message) }
}

/** FastAPI sends `detail` as a string, or as a list of `{loc, msg}` for 422 validation errors. */
function detailText(d: unknown): string | null {
  if (typeof d === 'string') return d
  if (Array.isArray(d))
    return d.map((x) => {
      const field = Array.isArray(x?.loc) ? x.loc.filter((p: unknown) => p !== 'body').join('.') : ''
      return field ? `${field}: ${x?.msg ?? x}` : String(x?.msg ?? x)
    }).join('; ')
  return null
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  if (MOCK) return (await import('../mock/mockApi')).mockApi(path, body) as Promise<T>
  const res = await fetch('/api' + path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = res.statusText
    try { detail = detailText((await res.json()).detail) ?? detail } catch { /* not JSON */ }
    // a lapsed or revoked session anywhere in the app sends the user back to the sign-in page
    if (res.status === 401 && !path.startsWith('/auth/')) dispatchEvent(new Event('precedent:signed-out'))
    throw new ApiError(`${res.status} on ${path}: ${detail}`, res.status, detail)
  }
  return res.json() as Promise<T>
}
