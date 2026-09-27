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

const msg = (dbId: string, content = dbId): Message => ({
  id: parseInt(dbId.slice(-6), 16), dbId, author: 'a', authorId: 'u1', content,
  time: '', timestamp: 0, avatar: '', reactions: [],
})
const ids = (list: Message[]) => list.map(m => m.dbId)

describe('history windows', () => {
  let s: ReturnType<typeof useMessages>
  beforeEach(() => {
    s = useMessages()
    s.dmMessages.value = {}; s.serverMessages.value = {}; s.groupMessages.value = {}
    s.windowMeta.value = {}
  })

  it('reads a conversation never paged as live and complete', () => {
    expect(s.windowOf('channel', 'c1')).toEqual({ hasOlder: false, live: true, awayCount: 0 })
  })

  it('records a newest page as live, with history above it', () => {
    s.setWindow('channel', 'c1', [msg('a0000000000000000000000b')], { hasOlder: true, hasNewer: false })
    expect(s.windowOf('channel', 'c1')).toEqual({ hasOlder: true, live: true, awayCount: 0 })
  })

  it('records a jump as not live', () => {
    s.setWindow('dm', 'u2', [msg('a0000000000000000000000b')], { hasOlder: true, hasNewer: true })
    expect(s.windowOf('dm', 'u2').live).toBe(false)
  })

  it('puts an older page above the window, without repeating a message', () => {
    s.setWindow('channel', 'c1', [msg('a0000000000000000000000c'), msg('a0000000000000000000000d')], { hasOlder: true, hasNewer: false })
    s.prependOlder('channel', 'c1', [msg('a0000000000000000000000b'), msg('a0000000000000000000000c')], false)
    expect(ids(s.getChannelMessages('c1'))).toEqual(['a0000000000000000000000b', 'a0000000000000000000000c', 'a0000000000000000000000d'])
    expect(s.windowOf('channel', 'c1').hasOlder).toBe(false)
  })

  it('puts a newer page below, and turns live again at the end', () => {
    s.setWindow('group', 'g1', [msg('a0000000000000000000000b')], { hasOlder: true, hasNewer: true })
    s.holdIfAway('group', 'g1')
    s.appendNewer('group', 'g1', [msg('a0000000000000000000000c')], true)
    expect(s.windowOf('group', 'g1')).toMatchObject({ live: false, awayCount: 1 })
    s.appendNewer('group', 'g1', [msg('a0000000000000000000000d')], false)
    expect(ids(s.getGroupMessages('g1'))).toEqual(['a0000000000000000000000b', 'a0000000000000000000000c', 'a0000000000000000000000d'])
    expect(s.windowOf('group', 'g1')).toMatchObject({ live: true, awayCount: 0 })
  })

  it('holds a live arrival only while the window is not live', () => {
    s.setWindow('channel', 'c1', [], { hasOlder: false, hasNewer: false })
    expect(s.holdIfAway('channel', 'c1')).toBe(false)
    s.setWindow('channel', 'c1', [], { hasOlder: true, hasNewer: true })
    expect(s.holdIfAway('channel', 'c1')).toBe(true)
    expect(s.holdIfAway('channel', 'c1')).toBe(true)
    expect(s.windowOf('channel', 'c1').awayCount).toBe(2)
  })

  it('never holds for a conversation with no window yet', () => {
    expect(s.holdIfAway('dm', 'nobody')).toBe(false)
  })

  it('treats a plain init as a fresh, live window', () => {
    s.setWindow('channel', 'c1', [], { hasOlder: true, hasNewer: true })
    s.initChannel('c1', [])
    expect(s.windowOf('channel', 'c1')).toEqual({ hasOlder: false, live: true, awayCount: 0 })
  })
})
