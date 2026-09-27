import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import type { Message } from '@/types'

// useMessages now imports usePerformance (for the eviction caps), which pulls
// in useAppearance for the motion rule, which pulls in materialScheme →
// @material/material-color-utilities, whose published ESM uses extensionless
// relative imports Vite resolves and bare Node does not. Nothing here
// exercises Material You, so the dependency is stubbed rather than made
// loadable for the sake of this file. Same reason as usePerformance.test.ts.
vi.mock('../materialScheme', () => ({
  SCHEME_TOKEN_KEYS: [],
  buildSchemeTokens: () => ({}),
}))

let useMessages: typeof import('../useMessages').useMessages

// The repo's Vitest runs in the node environment (no jsdom), but usePerformance
// (via useAppearance) touches browser globals at load time (localStorage,
// document, matchMedia). A static top-level import would evaluate before
// stubs could be installed — ES module imports are hoisted ahead of the rest
// of the module body — so the module under test is loaded dynamically once
// the stubs are in place.
beforeAll(async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} } as unknown as Storage
  const inertEl = () => ({ style: {}, setAttribute() {}, removeAttribute() {} })
  globalThis.document = {
    documentElement: { dataset: {} },
    createElement: inertEl,
    querySelector: () => null,
    head: inertEl(),
  } as unknown as Document
  globalThis.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia

  ;({ useMessages } = await import('../useMessages'))
})

const msg = (id: number, dbId: string, content = 'hi'): Message => ({
  id, dbId, author: 'Ada', authorId: 'u1', content,
  time: '10:30', timestamp: 1_755_000_000_000,
  avatar: '', reactions: [],
})

describe('useMessages — channel store', () => {
  let m: ReturnType<typeof useMessages>
  beforeEach(() => { m = useMessages(); m.initChannel('c1', []); m.initChannel('c2', []) })

  it('seeds a channel with history', () => {
    m.initChannel('c1', [msg(1, 'a')])
    expect(m.getChannelMessages('c1')).toHaveLength(1)
  })

  it('re-seeding REPLACES rather than keeping the stale list', () => {
    m.initChannel('c1', [msg(1, 'a')])
    m.initChannel('c1', [msg(2, 'b'), msg(3, 'c')])
    expect(m.getChannelMessages('c1').map(x => x.dbId)).toEqual(['b', 'c'])
  })

  it('pushes a message onto a channel that has no list yet', () => {
    m.pushChannelMessage('brand-new', msg(1, 'a'))
    expect(m.getChannelMessages('brand-new')).toHaveLength(1)
  })

  it('does not double-push the same dbId', () => {
    m.pushChannelMessage('c1', msg(1, 'a'))
    m.pushChannelMessage('c1', msg(1, 'a'))
    expect(m.getChannelMessages('c1')).toHaveLength(1)
  })

  it('de-dupes on dbId, not on the derived numeric id', () => {
    // Two different messages can collide on the numeric id (it is only the low
    // 8 hex digits of the ObjectId). Keying the guard on the numeric id would
    // silently swallow the second one.
    m.pushChannelMessage('c1', msg(7, 'aaa'))
    m.pushChannelMessage('c1', msg(7, 'bbb'))
    expect(m.getChannelMessages('c1')).toHaveLength(2)
  })

  it('never dedupes unstamped messages against each other (no dbId to compare)', () => {
    m.pushChannelMessage('c1', msg(1, undefined as unknown as string))
    m.pushChannelMessage('c1', msg(2, undefined as unknown as string))
    expect(m.getChannelMessages('c1')).toHaveLength(2)
  })

  it('still lands an unstamped message when the list already has a stamped one', () => {
    m.pushChannelMessage('c1', msg(1, 'a'))
    m.pushChannelMessage('c1', msg(2, undefined as unknown as string))
    expect(m.getChannelMessages('c1')).toHaveLength(2)
  })

  it('keeps channels separate', () => {
    m.pushChannelMessage('c1', msg(1, 'a'))
    m.pushChannelMessage('c2', msg(2, 'b'))
    expect(m.getChannelMessages('c1')).toHaveLength(1)
    expect(m.getChannelMessages('c2')).toHaveLength(1)
  })

  it('returns an empty array for an unknown channel rather than undefined', () => {
    expect(m.getChannelMessages('nope')).toEqual([])
  })
})
