/**
 * Voice servers the INSTANCE offers, as opposed to the ones a guild owner
 * registers for their own server.
 *
 * Declared in a file rather than the database on purpose. These belong to
 * whoever runs the build, not to the app — so they cannot be edited from inside
 * it, their secrets never enter Mongo, and an admin rotating a key changes one
 * file instead of asking every guild owner to re-paste it.
 *
 * Read once at boot and validated there. A bad entry stops the process, for the
 * same reason the rest of config/env.ts does: a media server that turns out to
 * be misconfigured at the moment someone joins a call is worse than one that
 * never let the process start.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export interface InstanceVoiceServer {
  /** `instance:<slug>`. The prefix is what lets one resolver read two stores,
   *  and it makes a stored reference self-describing in the database. */
  id: string
  name: string
  url: string
  apiKey: string
  apiSecret: string
  isDefault: boolean
}

/** Same rule as the per-guild form: `ws://` only for loopback, because a page
 *  served over HTTPS cannot open a plaintext websocket to anywhere else. */
const validUrl = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol === 'wss:') return u.toString().replace(/\/$/, '')
  if (u.protocol === 'ws:') {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname)
    return local ? u.toString().replace(/\/$/, '') : null
  }
  return null
}

export const slugify = (name: string): string =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Annotated on the CONST, not just the arrow: TypeScript only treats a call as
// an assertion (and narrows what follows) when the callee's type is declared
// this way. Without it, `raw` stays `{}` after the Array.isArray guard.
const fail: (msg: string) => never = msg => {
  throw new Error(`Refusing to start: ${msg} (voice servers file)`)
}

/**
 * Parse and validate the file's contents.
 *
 * Separated from reading it so the validation can be tested without touching a
 * disk — every rule below is a way a real file gets written wrong.
 */
export const parseInstanceVoiceServers = (raw: unknown): InstanceVoiceServer[] => {
  if (raw === null || raw === undefined) return []
  if (!Array.isArray(raw)) fail('the file must contain a JSON array')

  const out: InstanceVoiceServer[] = []
  const seenIds = new Set<string>()

  raw.forEach((entry: any, i: number) => {
    const where = `entry ${i + 1}`
    if (!entry || typeof entry !== 'object') fail(`${where} is not an object`)

    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (!name) fail(`${where} has no name`)
    if (name.length > 40) fail(`${where}'s name is longer than 40 characters`)

    const url = validUrl(entry.url)
    if (!url) {
      fail(`${where} ("${name}") has an unusable url — it must be wss://, or ws:// for localhost`)
    }

    const apiKey = typeof entry.apiKey === 'string' ? entry.apiKey.trim() : ''
    const apiSecret = typeof entry.apiSecret === 'string' ? entry.apiSecret : ''
    if (!apiKey) fail(`${where} ("${name}") has no apiKey`)
    if (!apiSecret) fail(`${where} ("${name}") has no apiSecret`)

    const id = `instance:${slugify(name)}`
    if (!slugify(name)) fail(`${where}'s name has no letters or digits to make an id from`)
    // Two entries sharing an id would make one of them permanently unreachable,
    // and which one you got would depend on array order.
    if (seenIds.has(id)) fail(`two entries are both named "${name}"`)
    seenIds.add(id)

    out.push({ id, name, url: url!, apiKey, apiSecret, isDefault: entry.default === true })
  })

  const defaults = out.filter(s => s.isDefault)
  if (defaults.length > 1) {
    fail(`${defaults.length} entries are marked default — there can be at most one`)
  }
  // Zero marked is fine and common; the first entry becomes the default so that
  // "the instance default" always means something.
  if (out.length && defaults.length === 0) out[0].isDefault = true

  return out
}

let cache: InstanceVoiceServer[] | null = null

/**
 * @param path Where the file lives. Absent or missing file means no instance
 * servers, which is the normal case for a deployment using only LIVEKIT_URL.
 */
export const loadInstanceVoiceServers = (path: string | undefined): InstanceVoiceServer[] => {
  if (!path) return []
  const full = resolve(path)
  if (!existsSync(full)) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(full, 'utf8'))
  } catch (e) {
    // Named explicitly: a JSON syntax error reported without the path is one of
    // the least helpful messages a self-hoster can be given.
    throw new Error(`Refusing to start: ${full} is not valid JSON — ${(e as Error).message}`)
  }
  return parseInstanceVoiceServers(parsed)
}

export const setInstanceVoiceServers = (list: InstanceVoiceServer[]): void => { cache = list }

export const instanceVoiceServers = (): InstanceVoiceServer[] => cache ?? []

export const findInstanceVoiceServer = (id: string): InstanceVoiceServer | undefined =>
  instanceVoiceServers().find(s => s.id === id)

export const isInstanceVoiceId = (id: unknown): id is string =>
  typeof id === 'string' && id.startsWith('instance:')

/** Test seam. */
export const _resetInstanceVoiceForTests = (): void => { cache = null }
