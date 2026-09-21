/**
 * An instance address, as someone types it, turned into an origin the app can
 * open — and checked against the server before it is saved.
 *
 * The check asks `<origin>/instance`, the public profile every Skycord server
 * answers with open CORS. A server that does not answer as Skycord is refused
 * with a reason a person can act on, never a stack trace.
 *
 * Pure apart from the injected fetch, so the tests never touch the network.
 */

export interface InstanceProfile {
  software: 'skycord'
  name: string
  nameIsAddress: boolean
  icon: string | null
  operator: string | null
  version: string
}

export type Lookup =
  | { ok: true; origin: string; profile: InstanceProfile }
  | { ok: false; reason: string }

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

/** The address reduced to its origin, or null if it is not an http(s) address. */
export const normaliseAddress = (input: string): string | null => {
  const text = input.trim()
  if (!text || /\s/.test(text)) return null
  // No scheme written: assume https. An explicit http:// is kept — a server
  // on the local network often has no certificate.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  let url: URL
  try { url = new URL(withScheme) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname) return null
  return url.origin
}

const isProfile = (body: unknown): body is InstanceProfile =>
  !!body && typeof body === 'object' && (body as { software?: unknown }).software === 'skycord'
  && typeof (body as { name?: unknown }).name === 'string'

export const lookupInstance = async (input: string, fetchImpl: FetchLike = fetch): Promise<Lookup> => {
  const origin = normaliseAddress(input)
  if (!origin) return { ok: false, reason: 'That doesn\'t look like a server address. Try something like chat.example.com.' }

  let res: Response
  try {
    res = await fetchImpl(`${origin}/instance`, { signal: AbortSignal.timeout(5000) })
  } catch {
    return { ok: false, reason: `Couldn't reach ${new URL(origin).host}. Check the address, and that the server is running.` }
  }
  if (!res.ok) {
    return { ok: false, reason: `${new URL(origin).host} answered, but not as a Skycord server (it said ${res.status}).` }
  }
  let body: unknown
  try { body = await res.json() } catch { body = null }
  if (!isProfile(body)) {
    return { ok: false, reason: `${new URL(origin).host} is online, but it isn't a Skycord server.` }
  }
  return { ok: true, origin, profile: body }
}
