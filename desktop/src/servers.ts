/**
 * The Skycord servers saved in the app, as plain data. Read back defensively
 * from disk and changed only through these functions. Nothing here touches
 * Electron, so it is tested alone.
 */
import { normaliseAddress } from './instanceAddress'

export interface SavedServer { origin: string; name: string; icon: string | null }

const MAX_NAME = 64

export const hostOf = (origin: string): string => new URL(origin).host

const nameFor = (name: unknown, origin: string) => {
  const n = typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : ''
  return n || hostOf(origin)
}

/** Only a web address can be an icon: this is shown in an <img> by the app. */
const iconFor = (icon: unknown): string | null => {
  if (typeof icon !== 'string') return null
  try {
    const u = new URL(icon)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

const entryFrom = (value: unknown): SavedServer | null => {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const origin = typeof v.origin === 'string' ? normaliseAddress(v.origin) : null
  return origin ? { origin, name: nameFor(v.name, origin), icon: iconFor(v.icon) } : null
}

export const readServers = (value: unknown): SavedServer[] => {
  if (!Array.isArray(value)) return []
  const out: SavedServer[] = []
  for (const v of value) {
    const e = entryFrom(v)
    if (e && !out.some(s => s.origin === e.origin)) out.push(e)
  }
  return out
}

/**
 * Save a server. A new one goes last; a known one keeps its place. With
 * `keepName`, a name the member gave it survives: only the default (its
 * address) is replaced by the server's own name.
 */
export const saveServer = (list: SavedServer[], value: unknown, { keepName = false } = {}): SavedServer[] => {
  const e = entryFrom(value)
  if (!e) return list
  const at = list.findIndex(s => s.origin === e.origin)
  if (at < 0) return [...list, e]
  const old = list[at]
  const name = keepName && old.name !== hostOf(old.origin) ? old.name : e.name
  return list.map((s, i) => (i === at ? { origin: e.origin, name, icon: e.icon ?? old.icon } : s))
}

export const renameServer = (list: SavedServer[], origin: string, name: unknown): SavedServer[] =>
  list.map(s => (s.origin === origin ? { ...s, name: nameFor(name, s.origin) } : s))

/** Point a saved server at a new address, in its place. If another entry is
 *  already at that address, the two become one. */
export const readdressServer = (list: SavedServer[], origin: string, next: unknown): SavedServer[] => {
  const e = entryFrom(next)
  if (!e) return list
  return list
    .filter(s => s.origin !== e.origin || s.origin === origin)
    .map(s => (s.origin === origin ? e : s))
}

export const removeServer = (list: SavedServer[], origin: string): SavedServer[] => list.filter(s => s.origin !== origin)
