import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { API_PREFIXES } from '../utils/serveClient'

/**
 * Three lists have to agree about what a path is, and nothing made them.
 *
 * A new API route has to be added in three places:
 *
 *   1. `server/app.ts`         — mounted, or it does not exist
 *   2. `serveClient.ts`        — in API_PREFIXES, or the single-container
 *                                deployment answers it with the SPA index
 *   3. `vite.config.ts`        — in the dev proxy, or the dev server does
 *                                the same thing on port 5500
 *
 * Both of the failures look identical from the client: a 200 of HTML where
 * JSON was expected, which surfaces as "Unexpected token '<'" or as a
 * generic "could not be added" once a caller is careful enough to catch it.
 * `/internal` was missed once and `/music` once, each costing a debugging
 * session that ended in a one-line diff.
 *
 * So the lists are compared here instead of being remembered.
 */

const read = (p: string): string => readFileSync(resolve(__dirname, '..', '..', p), 'utf8')

/** Mount paths in app.ts: `app.use('/x', ...)`. */
const mounted = (): string[] => {
  const src = read('server/app.ts')
  const out: string[] = []
  for (const m of src.matchAll(/app\.use\(\s*'(\/[a-z0-9-]+)'/gi)) out.push(m[1])
  return [...new Set(out)]
}

/** Proxy keys in vite.config.ts: `'/x': { target: api`. */
const proxied = (): string[] => {
  const src = read('vite.config.ts')
  const block = /proxy:\s*\{([\s\S]*?)\n\s*\}/.exec(src)?.[1] ?? ''
  const out: string[] = []
  for (const m of block.matchAll(/'(\/[a-z0-9-.]+)'\s*:/gi)) out.push(m[1])
  return [...new Set(out)]
}

describe('the three lists that decide what is an API path', () => {
  it('finds the mounts, the prefixes and the proxy entries at all', () => {
    // If a regex stops matching because the file was reformatted, every
    // assertion below passes vacuously. This is the canary for that.
    expect(mounted().length).toBeGreaterThan(8)
    expect(proxied().length).toBeGreaterThan(8)
    expect(API_PREFIXES.length).toBeGreaterThan(8)
  })

  it('serves every mounted route as an API path, not as the app shell', () => {
    const missing = mounted().filter(p => !API_PREFIXES.includes(p))
    expect(missing, `mounted in app.ts but absent from API_PREFIXES: ${missing.join(', ')}`).toEqual([])
  })

  it('proxies every mounted route in dev', () => {
    // /internal is spoken only by the music container, which talks to the
    // API directly and never through Vite, so it is deliberately not here.
    const exempt = new Set(['/internal'])
    const missing = mounted().filter(p => !exempt.has(p) && !proxied().includes(p))
    expect(missing, `mounted in app.ts but absent from the vite proxy: ${missing.join(', ')}`).toEqual([])
  })

  it('does not proxy paths the API does not serve', () => {
    // A stale proxy entry sends a path that should reach the SPA to the API
    // instead, where it 404s — the same confusion pointing the other way.
    const known = new Set([...mounted(), ...API_PREFIXES])
    const stale = proxied().filter(p => !known.has(p))
    expect(stale, `proxied in dev but not mounted: ${stale.join(', ')}`).toEqual([])
  })
})
