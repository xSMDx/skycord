/**
 * The launcher's decisions, apart from the page so they are tested alone.
 */
import type { InstanceProfile } from '../../desktop/src/instanceAddress'
import { hostOf } from '../../desktop/src/servers'

export const HOSTED = 'https://app.skycord.xyz'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Android only lets secure pages use the microphone. An http:// server is
 * fine for chat, so it is allowed — but said up front rather than letting a
 * call fail later. Loopback counts as secure.
 */
export const httpWarning = (origin: string): string | null => {
  const u = new URL(origin)
  if (u.protocol !== 'http:' || LOOPBACK.has(u.hostname)) return null
  return 'This address isn’t secure (http). Chat works, but calls won’t work: Android only gives the microphone to secure (https) addresses.'
}

export const displayName = (p: InstanceProfile, origin: string): string => (p.nameIsAddress ? hostOf(origin) : p.name)

export const iconUrl = (p: InstanceProfile, origin: string): string | null => {
  if (!p.icon) return null
  try {
    const u = new URL(p.icon, origin)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

/** lookupInstance fetches `${origin}/instance`; the native side only ever gets the origin. */
export const originOfInstanceUrl = (url: string): string | null => {
  try {
    const u = new URL(url)
    return u.pathname === '/instance' ? u.origin : null
  } catch {
    return null
  }
}

export type NativeLookup = (origin: string) => Promise<{ status: number; body: string } | { unreachable: true }>

// Statuses a Response may not carry a body with; the constructor throws otherwise.
const NO_BODY = new Set([204, 205, 304])

/**
 * lookupInstance's fetch, done by the app: an https page may not fetch an
 * http:// server. It honours lookupInstance's timeout signal, so a lookup
 * the app never answers still ends in "Couldn't reach" instead of hanging.
 */
export const fetchThroughApp = (lookup: NativeLookup) =>
  async (url: string, init?: { signal?: AbortSignal }): Promise<Response> => {
    const origin = originOfInstanceUrl(url)
    if (!origin) throw new Error('not an instance URL')
    const signal = init?.signal
    const timedOut = new Promise<never>((_, reject) => {
      if (!signal) return
      if (signal.aborted) reject(new Error('timed out'))
      else signal.addEventListener('abort', () => reject(new Error('timed out')), { once: true })
    })
    const r = await Promise.race([lookup(origin), timedOut])
    if ('unreachable' in r) throw new Error('unreachable')
    return new Response(NO_BODY.has(r.status) ? null : r.body, { status: r.status, headers: { 'content-type': 'application/json' } })
  }

/**
 * AbortSignal.timeout arrived in Chromium 103. The app accepts WebView 86 and
 * later, and lookupInstance — shared with the desktop — relies on it.
 */
export const ensureAbortSignalTimeout = (S: { timeout?: (ms: number) => AbortSignal } = AbortSignal): void => {
  if (typeof S.timeout === 'function') return
  S.timeout = (ms: number) => {
    const c = new AbortController()
    setTimeout(() => c.abort(), ms)
    return c.signal
  }
}
