/**
 * Rebyte API client. Ported from `functions/rebyte.ts` — the only change
 * is the env source (module-level `env` rather than an injected Cloudflare
 * `Env` binding on the context). Function signatures drop the `env`
 * parameter since it's now available as a module import.
 */

import { env } from '../../env.js'

/** Proxy a JSON request to the Rebyte API, injecting the API key.
 *  Pass `apiKey` to use a per-user key; omit to use the global partner key.
 *  Pass `signal` (via RequestInit) to abort the request (e.g. read-through
 *  reconcile timeout). */
export async function rebyteFetch(
  path: string,
  opts: RequestInit & { apiKey?: string } = {},
): Promise<Response> {
  const { apiKey, ...init } = opts
  const headers = new Headers(init.headers)
  headers.set('API_KEY', apiKey ?? env.REBYTE_API_KEY)
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json')
  }

  return fetch(`${env.REBYTE_API_URL}${path}`, { ...init, headers })
}

export class RebyteError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Fetch JSON from Rebyte and return parsed data, or throw RebyteError. */
export async function rebyteJSON<T = unknown>(
  path: string,
  opts: RequestInit & { apiKey?: string } = {},
): Promise<T> {
  const res = await rebyteFetch(path, opts)
  const text = await res.text()
  if (!res.ok) {
    let msg: string
    try {
      const data = JSON.parse(text)
      msg = data?.error?.message ?? text
    } catch {
      msg = text || `HTTP ${res.status}`
    }
    throw new RebyteError(res.status, msg)
  }
  if (!text) {
    console.warn(`[rebyte] Empty body on ${res.status} for ${path}`)
    return {} as T
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new RebyteError(res.status, `Unexpected non-JSON response for ${path}`)
  }
}
