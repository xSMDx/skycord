import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import type { Message } from '@/types'

// Same reason as usePerformance.test.ts: useMessages now imports usePerformance
// for the eviction caps, and usePerformance (via useAppearance, for the motion
// rule) touches browser globals at load time (localStorage, document,
// matchMedia). The repo's Vitest runs in the node environment, so a static
// top-level import would throw before these stubs could apply — imports are
// hoisted ahead of the rest of the module body regardless of source order.
vi.mock('../materialScheme', () => ({
  SCHEME_TOKEN_KEYS: [],
  buildSchemeTokens: () => ({}),
}))

let useMessages: typeof import('../useMessages').useMessages
let setPerfLevel: typeof import('../usePerformance').setPerfLevel
let setPerfOverride: typeof import('../usePerformance').setPerfOverride

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
  ;({ setPerfLevel, setPerfOverride } = await import('../usePerformance'))
})

const msg = (n: number): Message => ({
  id: n, author: 'M', authorId: 'u1', content: `m${n}`, time: '12:00',
  timestamp: n, avatar: '', reactions: [], dbId: `db${n}`,
})
const many = (n: number) => Array.from({ length: n }, (_, i) => msg(i + 1))

describe('eviction', () => {
  let m: ReturnType<typeof useMessages>

  beforeEach(() => {
    m = useMessages()
    for (const id of ['c1', 'c2', 'c3', 'c4']) m.initChannel(id, [])
    // Driven by the switches themselves, not by whichever levels exist today:
    // this is the eviction rule under test, not the shape of the Settings page.
    setPerfLevel('light')
    setPerfOverride('messagesPerConversation', 200)
    setPerfOverride('keepConversations', 3)
  })

  it('keeps every message at full', () => {
    setPerfLevel('max')
    m.initChannel('c1', many(500))
    m.evict({ kind: 'channel', id: 'c1' })
    expect(m.getChannelMessages('c1')).toHaveLength(500)
  })

  it('trims a conversation to the cap, dropping the oldest', () => {
    m.initChannel('c1', many(500))
    m.evict({ kind: 'channel', id: 'c1' })
    const kept = m.getChannelMessages('c1')
    expect(kept).toHaveLength(200)
    expect(kept[0].content).toBe('m301')
    expect(kept[kept.length - 1].content).toBe('m500')
  })

  it('says there is more above after trimming, so scrolling up refetches', () => {
    m.initChannel('c1', many(500))
    m.setWindow('channel', 'c1', many(500), { hasOlder: false, hasNewer: false })
    m.evict({ kind: 'channel', id: 'c1' })
    expect(m.windowOf('channel', 'c1').hasOlder).toBe(true)
  })

  it('drops the least recently opened conversations beyond the limit', () => {
    for (const id of ['c1', 'c2', 'c3', 'c4']) { m.initChannel(id, many(10)); m.touchConversation('channel', id) }
    m.evict({ kind: 'channel', id: 'c4' })
    expect(m.getChannelMessages('c1')).toHaveLength(0)
    expect(m.getChannelMessages('c2')).toHaveLength(10)
    expect(m.getChannelMessages('c4')).toHaveLength(10)
  })

  it('never evicts the conversation being read, however old its last touch', () => {
    for (const id of ['c1', 'c2', 'c3', 'c4']) { m.initChannel(id, many(10)); m.touchConversation('channel', id) }
    m.evict({ kind: 'channel', id: 'c1' })
    expect(m.getChannelMessages('c1')).toHaveLength(10)
  })

  it('counts every kind in one pool, so a recent DM outlives an older channel', () => {
    // The setting promises a number of conversations, not a number per kind:
    // counting dm, group and channel separately would keep three times it.
    for (const id of ['c1', 'c2', 'c3']) { m.initChannel(id, many(10)); m.touchConversation('channel', id) }
    m.initDM('d1', many(10)); m.touchConversation('dm', 'd1')
    m.initChannel('c4', many(10)); m.touchConversation('channel', 'c4')
    m.evict({ kind: 'channel', id: 'c4' })
    expect(m.getChannelMessages('c4')).toHaveLength(10)  // being read
    expect(m.getDMMessages('d1')).toHaveLength(10)       // opened most recently
    expect(m.getChannelMessages('c1')).toHaveLength(0)   // oldest in the pool
  })

  it('drops nothing while the pool is under the limit, whatever the kinds', () => {
    m.initChannel('c1', many(10)); m.touchConversation('channel', 'c1')
    m.initChannel('c2', many(10)); m.touchConversation('channel', 'c2')
    m.initGroup('g1', many(10)); m.touchConversation('group', 'g1')
    m.evict({ kind: 'group', id: 'g1' })
    expect(m.getChannelMessages('c1')).toHaveLength(10)
    expect(m.getChannelMessages('c2')).toHaveLength(10)
    expect(m.getGroupMessages('g1')).toHaveLength(10)
  })
})
