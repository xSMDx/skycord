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
