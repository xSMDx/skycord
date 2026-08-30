import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { WireServer, WireChannel, WireCategory, WireMember } from '../useApi'

/**
 * The composable's only I/O. Stubbed rather than reached, so `openServer`'s
 * fetch-or-don't decision can be asserted on directly — that decision is the
 * whole of the cache contract and nothing else in this suite exercises it.
 * `vi.hoisted` because `vi.mock`'s factory is hoisted above the imports and
 * cannot close over an ordinary const.
 */
const api = vi.hoisted(() => ({
  getMyServers:     vi.fn(),
  getServerDetail:  vi.fn(),
  getServerMembers: vi.fn(),
  moveChannel:      vi.fn(),
}))
vi.mock('../useApi', () => ({ useApi: () => api }))

/**
 * The other input to the composable, now that `voiceActivityByServer` exists:
 * live call presence, which useServers reads as two module-level refs off
 * useSocket.
 *
 * Mocked rather than imported for real so this suite keeps testing one thing.
 * The real module pulls in socket.io-client, useAuth, useConvPrefs and
 * useSounds purely as a side effect of wanting two refs, and none of that is
 * under test here — while a hand-held ref lets a test state "these rooms are
 * occupied, this one is empty" as a plain fact and read the answer straight
 * back out. The shapes below are exactly the exported ones; if either drifts,
 * `npm run typecheck` fails on the real call site in useServers.ts.
 */
const socket = vi.hoisted(() => ({
  activeCalls:      null as unknown as { value: Record<string, string[]> },
  voiceRoomServers: null as unknown as { value: Record<string, string> },
}))
vi.mock('../useSocket', async () => {
  const { ref } = await import('vue')
  socket.activeCalls      = ref<Record<string, string[]>>({})
  socket.voiceRoomServers = ref<Record<string, string>>({})
  return { activeCalls: socket.activeCalls, voiceRoomServers: socket.voiceRoomServers }
})

const wireServer = (id: string, name = id): WireServer => ({
  id, name, icon: null, iconCrop: null, bannerColor: null,
  description: null, owner: 'u1', memberCount: 1, isPublic: false,
  createdAt: '2026-08-19T00:00:00.000Z',
})

const wireChannel = (id: string, server: string, name: string, type: 'text' | 'voice', position = 0): WireChannel =>
  ({ id, server, name, type, position, category: null, topic: null, slowmode: 0, userLimit: 0, bitrate: 64, voiceServer: null })

const wireCategory = (id: string, server: string, name: string, position = 0): WireCategory =>
  ({ id, server, name, position })

const wireMember = (id: string, overrides: Partial<WireMember> = {}): WireMember => ({
  id, username: id, displayName: id, avatar: null, avatarCrop: null,
  status: 'online', isOwner: false, ...overrides,
})

/**
 * `vitest.config.mts` runs this suite under `environment: 'node'`, which has
 * no `localStorage` global at all — confirmed by running `node -e
 * "console.log('localStorage' in globalThis)"` in this repo, which prints
 * `false`. Collapse persistence needs something real to round-trip a write
 * and a read through, so this stubs the one global it touches: four methods,
 * not a DOM library, and nothing jsdom or @vue/test-utils would pull in.
 * Production code still degrades gracefully (see useServers.ts) when this
 * global is genuinely absent, e.g. a browser with storage disabled.
 */
class FakeStorage {
  private store: Record<string, string> = {}
  getItem(key: string) { return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null }
  setItem(key: string, value: string) { this.store[key] = value }
  removeItem(key: string) { delete this.store[key] }
  clear() { this.store = {} }
}
;(globalThis as any).localStorage = new FakeStorage()

// useServers now imports usePresence (activeMembers groups through
// livePresence), and usePresence reads localStorage at module load for the
// idle-timeout setting — the exact reason presenceById.test.ts imports it
// dynamically instead of statically. ES module imports resolve, and the
// imported module's body runs, before ANY of this file's own top-level code
// does — regardless of where the `import … from '../useServers'` line sits
// textually relative to the FakeStorage stub above. A static import here
// would therefore evaluate usePresence (and its unguarded localStorage read)
// before the stub exists, throwing ReferenceError: localStorage is not
// defined. Dynamic import defers the load to this exact line, after the stub
// is in place. `vi.mock('../useApi', …)` above still applies to it: Vitest's
// mocking intercepts module resolution regardless of static vs. dynamic
// import.
const { useServers, serverIconFor, COLLAPSED_CATEGORIES_KEY } = await import('../useServers')
const { applyPresence, resetPresenceMap } = await import('../usePresence')

describe('useServers', () => {
  let s: ReturnType<typeof useServers>

  beforeEach(() => {
    s = useServers()
    // Module-level state is shared across the whole app by design, so each
    // test starts by clearing it rather than by constructing a fresh instance.
    s.servers.value = []
    s.channelsByServer.value = {}
    s.categoriesByServer.value = {}
    // Same rule as every other module-level ref here: goes in the reset the
    // moment it exists, not after a test order happens to paper over a leak.
    s.membersByServer.value = {}
    s.activeServerId.value = null
    s.activeChannelId.value = null
    s.unreadChannels.value = {}
    s.lastChannelIn.value = {}
    // Plan 3a shipped with lastChannelIn missing from this reset — the suite
    // passed anyway only because of declaration order, and broke the moment
    // that changed. collapsedCategories is new module-level state of exactly
    // the same shape; it goes in the reset from day one.
    s.collapsedCategories.value = {}
    // Same rule applies to viewedVoiceId: new module-level state goes in this
    // reset the moment it's added, not after it bites someone.
    s.viewedVoiceId.value = null
    ;(globalThis.localStorage as any).clear()
    api.getMyServers.mockReset()
    api.getServerDetail.mockReset()
    api.getServerMembers.mockReset()
    api.moveChannel.mockReset()
    // usePresence's map is module-level too, shared with every other test
    // file that imports it in this process — the same class of bug the
    // comments above warn about, just in a different module. The live-
    // presence test below writes into it via applyPresence and must not leak
    // into a later test.
    resetPresenceMap()
  })

  it('maps a wire server into the renderable client shape', () => {
    s.upsertServer(wireServer('s1', 'Skycord HQ'))
    expect(s.servers.value).toHaveLength(1)
    expect(s.servers.value[0].name).toBe('Skycord HQ')
    expect(s.servers.value[0].img).toContain('data:image/svg+xml')
  })

  it('uses the stored icon when there is one', () => {
    s.upsertServer({ ...wireServer('s1'), icon: 'https://cdn/icon.png' })
    expect(s.servers.value[0].img).toBe('https://cdn/icon.png')
  })

  it('upsert replaces rather than duplicating', () => {
    s.upsertServer(wireServer('s1', 'Old'))
    s.upsertServer(wireServer('s1', 'New'))
    expect(s.servers.value).toHaveLength(1)
    expect(s.servers.value[0].name).toBe('New')
  })

  // The old 'splits channels by type and sorts them by position' test went
  // with `textChannels`/`voiceChannels` themselves. Nothing was lost: the
  // type split and the position ordering it asserted are both still pinned,
  // by 'orders text channels before voice within a group, each by position'
  // and by 'sorts a dangling-category channel by type and position among
  // genuinely uncategorised channels' further down — against
  // `groupedChannels`, which is what actually renders.

  it('lands on the first text channel, never a voice one', () => {
    s.receiveDetail(wireServer('s1'), [
      wireChannel('v1', 's1', 'Lounge',  'voice', 0),
      wireChannel('c1', 's1', 'general', 'text',  0),
    ])
    s.selectLanding('s1')
    expect(s.activeChannelId.value).toBe('c1')
  })

  it('remembers the last channel you were in per server', () => {
    s.receiveDetail(wireServer('s1'), [
      wireChannel('c1', 's1', 'general',   'text', 0),
      wireChannel('c2', 's1', 'off-topic', 'text', 1),
    ])
    s.receiveDetail(wireServer('s2'), [wireChannel('c3', 's2', 'general', 'text', 0)])
    s.activeServerId.value = 's1'
    s.openChannel('c2')
    s.selectLanding('s2')
    expect(s.activeChannelId.value).toBe('c3')
    s.selectLanding('s1')
    expect(s.activeChannelId.value).toBe('c2')
  })

  it('falls back to the first text channel when the remembered one is gone', () => {
    s.receiveDetail(wireServer('s1'), [
      wireChannel('c1', 's1', 'general',   'text', 0),
      wireChannel('c2', 's1', 'off-topic', 'text', 1),
    ])
    s.activeServerId.value = 's1'
    s.openChannel('c2')
    s.removeChannel('s1', 'c2')
    s.selectLanding('s1')
    expect(s.activeChannelId.value).toBe('c1')
  })

  it('leaves activeChannelId null for a server with no text channels', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('v1', 's1', 'Lounge', 'voice', 0)])
    s.selectLanding('s1')
    expect(s.activeChannelId.value).toBeNull()
  })

  it('removing the active channel clears the selection', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    s.activeServerId.value = 's1'
    s.openChannel('c1')
    s.removeChannel('s1', 'c1')
    expect(s.activeChannelId.value).toBeNull()
  })

  it('carries every wire field through to the client channel', () => {
    // Pinned as a whole rather than field by field, because the failure is
    // always the same shape: a new setting is added to the wire, the client
    // type marks it optional, toClientChannel is not updated, and the settings
    // dialog quietly shows a default for a channel that has a value — then
    // saves that default back. It has happened twice (topic/slowmode/userLimit/
    // bitrate, then voiceServer), both times without a type error.
    const w = {
      ...wireChannel('c1', 's1', 'general', 'voice', 3),
      category: 'cat1', topic: 'hello', slowmode: 10, userLimit: 5, bitrate: 32,
      voiceServer: 'vs1',
    }
    s.receiveDetail(wireServer('s1'), [w])
    expect(s.channelsByServer.value['s1'][0]).toMatchObject({
      id: 'c1', serverId: 's1', name: 'general', type: 'voice', position: 3,
      category: 'cat1', topic: 'hello', slowmode: 10, userLimit: 5, bitrate: 32,
      voiceServer: 'vs1',
    })
  })

  it('removing the active server clears both selections and its channels', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    s.activeServerId.value = 's1'
    s.openChannel('c1')
    s.removeServer('s1')
    expect(s.servers.value).toHaveLength(0)
    expect(s.channelsByServer.value['s1']).toBeUndefined()
    expect(s.activeServerId.value).toBeNull()
    expect(s.activeChannelId.value).toBeNull()
  })

  it('removing a server clears unread counts for its channels', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    s.markUnread('c1')
    s.removeServer('s1')
    expect(s.unreadChannels.value['c1']).toBeUndefined()
  })

  it('removing a server you are not looking at leaves the selection alone', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    s.receiveDetail(wireServer('s2'), [wireChannel('c3', 's2', 'general', 'text', 0)])
    s.activeServerId.value = 's1'
    s.openChannel('c1')
    s.removeServer('s2')
    expect(s.activeServerId.value).toBe('s1')
    expect(s.activeChannelId.value).toBe('c1')
  })

  it('upsertChannel adds a new channel and updates an existing one in place', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    s.upsertChannel(wireChannel('c2', 's1', 'off-topic', 'text', 1))
    expect(s.channelsByServer.value['s1']).toHaveLength(2)
    s.upsertChannel(wireChannel('c2', 's1', 'renamed', 'text', 1))
    expect(s.channelsByServer.value['s1']).toHaveLength(2)
    expect(s.channelsByServer.value['s1'].find(c => c.id === 'c2')!.name).toBe('renamed')
  })

  it('ignores a channel for a server whose detail has not been fetched', () => {
    s.upsertChannel(wireChannel('c9', 'unknown', 'ghost', 'text', 0))
    expect(s.channelsByServer.value['unknown']).toBeUndefined()
  })

  it('tracks unread per channel and clears it via clearUnread', () => {
    s.markUnread('c1')
    s.markUnread('c1')
    expect(s.unreadChannels.value['c1']).toBe(2)
    s.clearUnread('c1')
    expect(s.unreadChannels.value['c1']).toBeUndefined()
  })

  it('opening a channel clears its unread count', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    s.activeServerId.value = 's1'
    s.markUnread('c1')
    s.openChannel('c1')
    expect(s.unreadChannels.value['c1']).toBeUndefined()
  })

  // ── viewed voice channel ───────────────────────────────────────────────
  // Separate from activeChannelId by design — see the comment on
  // viewedVoiceId in useServers.ts. These pin every place that must clear it
  // once the user is no longer looking at a voice channel's stage.

  it('viewVoiceChannel sets viewedVoiceId and leaves activeChannelId untouched', () => {
    s.receiveDetail(wireServer('s1'), [
      wireChannel('c1', 's1', 'general', 'text',  0),
      wireChannel('v1', 's1', 'Lounge',  'voice', 0),
    ])
    s.activeServerId.value = 's1'
    s.openChannel('c1')
    s.viewVoiceChannel('v1')
    expect(s.viewedVoiceId.value).toBe('v1')
    expect(s.activeChannelId.value).toBe('c1')
  })

  it('openChannel clears viewedVoiceId — opening a text channel means you are looking at text now', () => {
    s.viewedVoiceId.value = 'v1'
    s.openChannel('c1')
    expect(s.viewedVoiceId.value).toBeNull()
  })

  it('selectLanding clears viewedVoiceId, since entering a server lands you on a text channel', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    s.viewedVoiceId.value = 'v1'
    s.selectLanding('s1')
    expect(s.viewedVoiceId.value).toBeNull()
  })

  it('switching to another server clears viewedVoiceId', async () => {
    // Both buckets populated (categories explicitly `[]`) so openServer takes
    // the cached path rather than the fetch path — the fetch itself is
    // covered elsewhere and isn't what this test is about.
    s.receiveDetail(wireServer('s1'), [wireChannel('v1', 's1', 'Lounge',  'voice', 0)], [])
    s.receiveDetail(wireServer('s2'), [wireChannel('c1', 's2', 'general', 'text',  0)], [])
    s.activeServerId.value = 's1'
    s.viewVoiceChannel('v1')
    await s.openServer('s2')
    expect(s.viewedVoiceId.value).toBeNull()
  })

  it('removeChannel clears viewedVoiceId when the viewed voice channel is deleted', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('v1', 's1', 'Lounge', 'voice', 0)])
    s.viewVoiceChannel('v1')
    s.removeChannel('s1', 'v1')
    expect(s.viewedVoiceId.value).toBeNull()
  })

  it('removeChannel leaves viewedVoiceId alone when a different channel is removed', () => {
    s.receiveDetail(wireServer('s1'), [
      wireChannel('v1', 's1', 'Lounge',  'voice', 0),
      wireChannel('c1', 's1', 'general', 'text',  0),
    ])
    s.viewVoiceChannel('v1')
    s.removeChannel('s1', 'c1')
    expect(s.viewedVoiceId.value).toBe('v1')
  })

  it('resetServers clears viewedVoiceId', () => {
    s.viewedVoiceId.value = 'v1'
    s.resetServers()
    expect(s.viewedVoiceId.value).toBeNull()
  })

  // ── categories ─────────────────────────────────────────────────────────

  it('groupedChannels puts uncategorised channels in a leading group with no category', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    s.activeServerId.value = 's1'
    const groups = s.groupedChannels.value
    expect(groups[0].category).toBeNull()
    expect(groups[0].text.map(c => c.id)).toEqual(['c1'])
  })

  it('groups channels under their category, with categories in position order', () => {
    s.receiveDetail(
      wireServer('s1'),
      [
        wireChannel('c1', 's1', 'general', 'text', 0),
        wireChannel('c2', 's1', 'rules',   'text', 0),
      ],
      [
        wireCategory('catB', 's1', 'Info', 1),
        wireCategory('catA', 's1', 'Chat', 0),
      ],
    )
    s.channelsByServer.value['s1'].find(c => c.id === 'c1')!.category = 'catA'
    s.channelsByServer.value['s1'].find(c => c.id === 'c2')!.category = 'catB'
    s.activeServerId.value = 's1'
    const groups = s.groupedChannels.value
    // Uncategorised leads, then categories in position order (catA:0 before catB:1)
    // regardless of the order they were fetched/inserted in.
    expect(groups.map(g => g.category?.id ?? null)).toEqual([null, 'catA', 'catB'])
    expect(groups[1].text.map(c => c.id)).toEqual(['c1'])
    expect(groups[2].text.map(c => c.id)).toEqual(['c2'])
  })

  it('orders text channels before voice within a group, each by position', () => {
    s.receiveDetail(
      wireServer('s1'),
      [
        wireChannel('v2', 's1', 'Voice B', 'voice', 1),
        wireChannel('v1', 's1', 'Voice A', 'voice', 0),
        wireChannel('t2', 's1', 'text-b',  'text',  1),
        wireChannel('t1', 's1', 'text-a',  'text',  0),
      ],
      [wireCategory('cat1', 's1', 'Group', 0)],
    )
    s.channelsByServer.value['s1'].forEach(c => { c.category = 'cat1' })
    s.activeServerId.value = 's1'
    const group = s.groupedChannels.value[1]
    expect(group.text.map(c => c.id)).toEqual(['t1', 't2'])
    expect(group.voice.map(c => c.id)).toEqual(['v1', 'v2'])
  })

  it('still produces a group for a category with no channels', () => {
    s.receiveDetail(wireServer('s1'), [], [wireCategory('cat1', 's1', 'Empty', 0)])
    s.activeServerId.value = 's1'
    const groups = s.groupedChannels.value
    expect(groups).toHaveLength(2)
    expect(groups[1].category?.id).toBe('cat1')
    expect(groups[1].text).toEqual([])
    expect(groups[1].voice).toEqual([])
  })

  it('treats a channel with no category field the same as an explicit null', () => {
    // Simulates a channel that predates the categories feature. shapeChannel
    // on the server (serversController.ts) already normalises this to null
    // before it reaches the wire, but the client's own grouping must not lean
    // on that guarantee holding forever — hence no `=== null` anywhere in
    // groupedChannels' bucketing.
    const legacy = wireChannel('c1', 's1', 'general', 'text', 0)
    delete (legacy as any).category
    s.receiveDetail(wireServer('s1'), [legacy])
    s.activeServerId.value = 's1'
    expect(s.groupedChannels.value[0].text.map(c => c.id)).toEqual(['c1'])
  })

  it('routes a channel with a dangling category reference into the uncategorised group instead of dropping it', () => {
    s.receiveDetail(
      wireServer('s1'),
      [
        wireChannel('c1', 's1', 'general', 'text', 0),
        wireChannel('c2', 's1', 'orphan',  'text', 1),
      ],
      [wireCategory('cat1', 's1', 'Group', 0)],
    )
    // c2 claims a category id this server never sent — e.g. a channel:created
    // for a category the client has not fetched yet, or one that raced a
    // category:deleted. It must land in the uncategorised group, not vanish.
    s.channelsByServer.value['s1'].find(c => c.id === 'c2')!.category = 'ghost-category'
    s.activeServerId.value = 's1'
    const groups = s.groupedChannels.value
    expect(groups[0].category).toBeNull()
    expect(groups[0].text.map(c => c.id)).toEqual(['c1', 'c2'])
    // And it must not silently join the real category's bucket either.
    expect(groups[1].text.map(c => c.id)).toEqual([])
  })

  it('sorts a dangling-category channel by type and position among genuinely uncategorised channels', () => {
    s.receiveDetail(
      wireServer('s1'),
      [
        wireChannel('t2', 's1', 'text-b',  'text',  1),
        wireChannel('t1', 's1', 'text-a',  'text',  0),
        wireChannel('v1', 's1', 'Voice A', 'voice', 0),
      ],
      [wireCategory('cat1', 's1', 'Group', 0)],
    )
    // t2 points at a category id that does not exist in categoriesByServer.
    s.channelsByServer.value['s1'].find(c => c.id === 't2')!.category = 'ghost-category'
    s.activeServerId.value = 's1'
    const uncategorised = s.groupedChannels.value[0]
    expect(uncategorised.text.map(c => c.id)).toEqual(['t1', 't2'])
    expect(uncategorised.voice.map(c => c.id)).toEqual(['v1'])
  })

  it('removeCategory reparents its channels to uncategorised rather than dropping them', () => {
    s.receiveDetail(
      wireServer('s1'),
      [wireChannel('c1', 's1', 'general', 'text', 0)],
      [wireCategory('cat1', 's1', 'Group', 0)],
    )
    s.channelsByServer.value['s1'][0].category = 'cat1'
    s.removeCategory('s1', 'cat1')
    expect(s.categoriesByServer.value['s1']).toHaveLength(0)
    // The channel survives the category's deletion — reparented, not dropped.
    expect(s.channelsByServer.value['s1']).toHaveLength(1)
    expect(s.channelsByServer.value['s1'][0].category).toBeNull()
  })

  it('upsertCategory adds a new category and updates an existing one in place', () => {
    // The explicit `[]` stands for "detail fetched, server has no categories
    // yet" — which is what every production caller of receiveDetail now says
    // when it means that. Omitting the argument means something different
    // (nothing known about categories) and leaves the bucket absent, which is
    // the neighbouring test's case, not this one's.
    s.receiveDetail(wireServer('s1'), [], [])
    s.upsertCategory(wireCategory('cat1', 's1', 'Old', 0))
    expect(s.categoriesByServer.value['s1']).toHaveLength(1)
    s.upsertCategory(wireCategory('cat1', 's1', 'New', 0))
    expect(s.categoriesByServer.value['s1']).toHaveLength(1)
    expect(s.categoriesByServer.value['s1'][0].name).toBe('New')
  })

  it('ignores a category for a server whose detail has not been fetched', () => {
    s.upsertCategory(wireCategory('cat9', 'unknown', 'ghost', 0))
    expect(s.categoriesByServer.value['unknown']).toBeUndefined()
  })

  it('toggleCategory flips collapsed state and collapsedCategories persists across a simulated reload', () => {
    s.receiveDetail(wireServer('s1'), [], [wireCategory('cat1', 's1', 'Group', 0)])
    expect(s.collapsedCategories.value['s1:cat1']).toBeFalsy()
    s.toggleCategory('s1', 'cat1')
    expect(s.collapsedCategories.value['s1:cat1']).toBe(true)
    s.toggleCategory('s1', 'cat1')
    expect(s.collapsedCategories.value['s1:cat1']).toBe(false)
    s.toggleCategory('s1', 'cat1')

    // Simulate a reload: forget the in-memory state, then re-read from the
    // exact storage key toggleCategory just wrote to.
    s.collapsedCategories.value = {}
    const persisted = JSON.parse(localStorage.getItem(COLLAPSED_CATEGORIES_KEY) || '{}')
    expect(persisted['s1:cat1']).toBe(true)
  })

  it('collapsing a category the user is currently viewing a channel in does not change activeChannelId', () => {
    s.receiveDetail(
      wireServer('s1'),
      [wireChannel('c1', 's1', 'general', 'text', 0)],
      [wireCategory('cat1', 's1', 'Group', 0)],
    )
    s.channelsByServer.value['s1'][0].category = 'cat1'
    s.activeServerId.value = 's1'
    s.openChannel('c1')
    s.toggleCategory('s1', 'cat1')
    expect(s.activeChannelId.value).toBe('c1')
  })

  it('resetServers clears collapsedCategories, and the clear survives a re-read from storage', () => {
    s.receiveDetail(wireServer('s1'), [], [wireCategory('cat1', 's1', 'Group', 0)])
    s.toggleCategory('s1', 'cat1')
    expect(s.collapsedCategories.value['s1:cat1']).toBe(true)

    s.resetServers()

    expect(s.collapsedCategories.value).toEqual({})
    // Not just the in-memory ref — the localStorage entry itself must be gone,
    // otherwise the next account to log in on this device would read it right
    // back out via readCollapsedCategories on module load.
    const persisted = JSON.parse(localStorage.getItem(COLLAPSED_CATEGORIES_KEY) || '{}')
    expect(persisted).toEqual({})
  })

  // A category id is never reissued, so a collapse key left behind after the
  // category is gone can never be reached again — it just grows the stored
  // blob by one entry per category anyone ever deletes. Observed live: after
  // collapsing one category and deleting a different one, storage held two.
  it("removeCategory drops the category's collapse key, in memory and in storage", () => {
    s.receiveDetail(wireServer('s1'), [], [wireCategory('cat1', 's1', 'Group', 0)])
    s.toggleCategory('s1', 'cat1')
    expect(s.collapsedCategories.value['s1:cat1']).toBe(true)

    s.removeCategory('s1', 'cat1')

    expect(s.collapsedCategories.value['s1:cat1']).toBeUndefined()
    expect(JSON.parse(localStorage.getItem(COLLAPSED_CATEGORIES_KEY) || '{}')).toEqual({})
  })

  it('removeServer drops the collapse keys of every category it had', () => {
    s.receiveDetail(wireServer('s1'), [], [
      wireCategory('cat1', 's1', 'One', 0),
      wireCategory('cat2', 's1', 'Two', 1),
    ])
    s.receiveDetail(wireServer('s2'), [], [wireCategory('cat3', 's2', 'Other', 0)])
    s.toggleCategory('s1', 'cat1')
    s.toggleCategory('s1', 'cat2')
    s.toggleCategory('s2', 'cat3')

    s.removeServer('s1')

    // Only s1 in the collapse blob is gone; the other server keeps its fold.
    expect(s.collapsedCategories.value['s1:cat1']).toBeUndefined()
    expect(s.collapsedCategories.value['s1:cat2']).toBeUndefined()
    expect(s.collapsedCategories.value['s2:cat3']).toBe(true)
    expect(JSON.parse(localStorage.getItem(COLLAPSED_CATEGORIES_KEY) || '{}')).toEqual({ 's2:cat3': true })
  })

  // ── moving a channel between categories ────────────────────────────────
  // `updateChannel` already accepts `category` (and `null` for "no category
  // at all"), so the only thing that can go wrong on this side of the wire is
  // what the sidebar shows in the gap between the drop and the response. The
  // move is applied optimistically — a channel that visibly snaps back after
  // a beat is worse than one that never appears to move — so every one of
  // these pins the recovery as hard as the happy path.

  /** s1 with two uncategorised text channels, one already in `cat1`, and a
   *  second empty category to move things into. Positions are deliberately
   *  interleaved across categories so an ordering assertion means something. */
  const serverWithCategories = (s: ReturnType<typeof useServers>) => {
    s.receiveDetail(
      wireServer('s1'),
      [
        wireChannel('t1', 's1', 'text-a', 'text',  0),
        wireChannel('t2', 's1', 'text-b', 'text',  1),
        wireChannel('t3', 's1', 'text-c', 'text',  2),
        wireChannel('v1', 's1', 'Voice',  'voice', 0),
      ],
      [wireCategory('cat1', 's1', 'One', 0), wireCategory('cat2', 's1', 'Two', 1)],
    )
    s.channelsByServer.value['s1'].find(c => c.id === 't2')!.category = 'cat1'
    s.activeServerId.value = 's1'
  }

  /** The wire echo `updateChannel` sends back: the whole channel, reshaped,
   *  with its new category on it. */
  const movedTo = (id: string, category: string | null) => {
    const c = wireChannel(id, 's1', id, 'text', Number(id.slice(1)) - 1)
    return { channel: { ...c, category } }
  }

  it('moveChannel takes a channel out of its old group and puts it in the new one', async () => {
    serverWithCategories(s)
    api.moveChannel.mockResolvedValue(movedTo('t2', 'cat2'))

    await s.moveChannel('s1', 't2', 'cat2')

    expect(api.moveChannel).toHaveBeenCalledWith('s1', 't2', 'cat2')
    const groups = s.groupedChannels.value
    expect(groups[1].category?.id).toBe('cat1')
    expect(groups[1].text.map(c => c.id)).toEqual([])
    expect(groups[2].category?.id).toBe('cat2')
    expect(groups[2].text.map(c => c.id)).toEqual(['t2'])
  })

  it('moveChannel with null lands the channel in the uncategorised group', async () => {
    serverWithCategories(s)
    api.moveChannel.mockResolvedValue(movedTo('t2', null))

    await s.moveChannel('s1', 't2', null)

    expect(api.moveChannel).toHaveBeenCalledWith('s1', 't2', null)
    const groups = s.groupedChannels.value
    expect(groups[0].category).toBeNull()
    expect(groups[0].text.map(c => c.id)).toEqual(['t1', 't2', 't3'])
    expect(groups[1].text.map(c => c.id)).toEqual([])
  })

  it('voice channels move too — the sidebar drags both kinds', async () => {
    serverWithCategories(s)
    api.moveChannel.mockResolvedValue({
      channel: { ...wireChannel('v1', 's1', 'Voice', 'voice', 0), category: 'cat1' },
    })

    await s.moveChannel('s1', 'v1', 'cat1')

    expect(s.groupedChannels.value[0].voice.map(c => c.id)).toEqual([])
    expect(s.groupedChannels.value[1].voice.map(c => c.id)).toEqual(['v1'])
  })

  it('groupedChannels stays in position order after a move', async () => {
    serverWithCategories(s)
    // t3 (position 2) joins t2 (position 1) in cat1. Position order, not
    // arrival order — a channel appended to the end of the array by the echo
    // must still sort back in front of a higher-positioned sibling.
    api.moveChannel.mockResolvedValue(movedTo('t3', 'cat1'))
    await s.moveChannel('s1', 't3', 'cat1')
    expect(s.groupedChannels.value[1].text.map(c => c.id)).toEqual(['t2', 't3'])

    api.moveChannel.mockResolvedValue(movedTo('t1', 'cat1'))
    await s.moveChannel('s1', 't1', 'cat1')
    expect(s.groupedChannels.value[1].text.map(c => c.id)).toEqual(['t1', 't2', 't3'])
    // And the same answer read twice — nothing about the grouping depends on
    // how many times it has been evaluated.
    expect(s.groupedChannels.value[1].text.map(c => c.id))
      .toEqual(s.groupedChannels.value[1].text.map(c => c.id))
    expect(s.groupedChannels.value[0].text.map(c => c.id)).toEqual([])
  })

  it('a move the server refuses leaves the sidebar showing where the channel really is', async () => {
    serverWithCategories(s)
    api.moveChannel.mockRejectedValue(
      Object.assign(new Error('That category does not belong to this server'), { status: 400 }))

    await expect(s.moveChannel('s1', 't2', 'cat2'))
      .rejects.toThrow('That category does not belong to this server')

    // Back in cat1, where the server still has it — never left showing the
    // optimistic position.
    const groups = s.groupedChannels.value
    expect(groups[1].text.map(c => c.id)).toEqual(['t2'])
    expect(groups[2].text.map(c => c.id)).toEqual([])
  })

  it('a refused move out of every category puts the channel back in its category', async () => {
    serverWithCategories(s)
    api.moveChannel.mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }))

    await expect(s.moveChannel('s1', 't2', null)).rejects.toThrow('nope')

    expect(s.groupedChannels.value[0].text.map(c => c.id)).toEqual(['t1', 't3'])
    expect(s.groupedChannels.value[1].text.map(c => c.id)).toEqual(['t2'])
  })

  it('dropping a channel back into the category it is already in asks the server nothing', async () => {
    serverWithCategories(s)
    await s.moveChannel('s1', 't2', 'cat1')
    expect(api.moveChannel).not.toHaveBeenCalled()
    await s.moveChannel('s1', 't1', null)
    expect(api.moveChannel).not.toHaveBeenCalled()
  })

  it('moveChannel ignores a channel this client does not hold', async () => {
    serverWithCategories(s)
    await s.moveChannel('s1', 'ghost', 'cat1')
    expect(api.moveChannel).not.toHaveBeenCalled()
  })

  // ── the invite-join staleness trap ─────────────────────────────────────
  // A member who joined by invite used to land in a server whose channels
  // were cached and whose categories were cached as an empty list, so the
  // sidebar rendered every channel flat, with no headers, and no rail click
  // could ever repair it — only a page reload. Three things now stand
  // between that and the user; these pin the two on this side of the wire.

  it('receiveDetail leaves the categories bucket absent when it is given none', () => {
    // Absent, NOT `[]`. An empty array is a claim that the server has no
    // categories, and it is precisely that claim — indistinguishable from the
    // truth — that made the stale sidebar unrecoverable.
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    expect(s.channelsByServer.value['s1']).toHaveLength(1)
    expect(s.categoriesByServer.value['s1']).toBeUndefined()
  })

  it('receiveDetail writes an empty bucket when a caller explicitly has none to give', () => {
    // createServer's 201 knows the server is too new to have any. That is a
    // fact, and it must be recorded as one, or every brand-new server would
    // cost a pointless extra GET on entry.
    s.receiveDetail(wireServer('s1'), [], [])
    expect(s.categoriesByServer.value['s1']).toEqual([])
  })

  it('receiveDetail does not wipe known categories when a later payload omits them', () => {
    s.receiveDetail(wireServer('s1'), [], [wireCategory('cat1', 's1', 'Chat', 0)])
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])
    expect(s.categoriesByServer.value['s1'].map(c => c.id)).toEqual(['cat1'])
  })

  it('openServer refetches when channels are cached but categories were never received', async () => {
    api.getServerDetail.mockResolvedValue({
      server:     wireServer('s1'),
      channels:   [wireChannel('c1', 's1', 'general', 'text', 0)],
      categories: [wireCategory('cat1', 's1', 'Chat', 0)],
    })
    // Exactly what an invite-join payload with no categories used to leave
    // behind: a populated channel bucket, no category bucket.
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)])

    await s.openServer('s1')

    expect(api.getServerDetail).toHaveBeenCalledWith('s1')
    expect(s.categoriesByServer.value['s1'].map(c => c.id)).toEqual(['cat1'])
    expect(s.groupedChannels.value.map(g => g.category?.id ?? null)).toEqual([null, 'cat1'])
  })

  it('openServer makes no request when both buckets are already populated', async () => {
    s.receiveDetail(
      wireServer('s1'),
      [wireChannel('c1', 's1', 'general', 'text', 0)],
      [wireCategory('cat1', 's1', 'Chat', 0)],
    )
    await s.openServer('s1')
    expect(api.getServerDetail).not.toHaveBeenCalled()
    expect(s.activeChannelId.value).toBe('c1')
  })

  it('openServer makes no request for a server known to have no categories', async () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'general', 'text', 0)], [])
    await s.openServer('s1')
    expect(api.getServerDetail).not.toHaveBeenCalled()
  })

  it('openServer fetches a server it has never seen', async () => {
    api.getServerDetail.mockResolvedValue({
      server: wireServer('s9'), channels: [], categories: [],
    })
    await s.openServer('s9')
    expect(api.getServerDetail).toHaveBeenCalledWith('s9')
  })

  // ── server members ───────────────────────────────────────────────────────

  it('members land per server and do not leak between servers', async () => {
    api.getServerMembers.mockResolvedValueOnce({ members: [wireMember('u1'), wireMember('u2')] })
    await s.loadServerMembers('s1')
    api.getServerMembers.mockResolvedValueOnce({ members: [wireMember('u3')] })
    await s.loadServerMembers('s2')
    expect(s.membersByServer.value['s1'].map(m => m.id)).toEqual(['u1', 'u2'])
    expect(s.membersByServer.value['s2'].map(m => m.id)).toEqual(['u3'])
  })

  it('activeMembers splits into online and offline, with the owner first among the online', async () => {
    api.getServerMembers.mockResolvedValueOnce({
      members: [
        wireMember('u1',    { status: 'online' }),
        wireMember('owner', { status: 'idle', isOwner: true }),
        wireMember('u3',    { status: 'offline' }),
      ],
    })
    await s.loadServerMembers('s1')
    s.activeServerId.value = 's1'
    expect(s.activeMembers.value.online.map(m => m.id)).toEqual(['owner', 'u1'])
    expect(s.activeMembers.value.offline.map(m => m.id)).toEqual(['u3'])
  })

  it("offline means offline — status === 'offline' groups down, everything else groups up", async () => {
    api.getServerMembers.mockResolvedValueOnce({
      members: [
        wireMember('a', { status: 'online' }),
        wireMember('b', { status: 'idle' }),
        wireMember('c', { status: 'dnd' }),
        wireMember('d', { status: 'offline' }),
      ],
    })
    await s.loadServerMembers('s1')
    s.activeServerId.value = 's1'
    expect(s.activeMembers.value.online.map(m => m.id)).toEqual(['a', 'b', 'c'])
    expect(s.activeMembers.value.offline.map(m => m.id)).toEqual(['d'])
  })

  it('groups by live presence, not the status that came with the fetch — the whole reason livePresence exists', async () => {
    // Fetched as offline...
    api.getServerMembers.mockResolvedValueOnce({ members: [wireMember('u1', { status: 'offline' })] })
    await s.loadServerMembers('s1')
    s.activeServerId.value = 's1'
    expect(s.activeMembers.value.offline.map(m => m.id)).toEqual(['u1'])

    // ...but a live presence event says online since. Grouping a member by
    // its own fetched copy instead of livePresence is exactly the bug this
    // composable's presence work already fixed on three other surfaces.
    applyPresence('u1', 'online')
    expect(s.activeMembers.value.online.map(m => m.id)).toEqual(['u1'])
    expect(s.activeMembers.value.offline).toEqual([])
  })

  it('activeMembers is empty when no server is active', () => {
    expect(s.activeMembers.value).toEqual({ online: [], offline: [] })
  })

  it('upsertMember adds a new member and updates an existing one in place', async () => {
    api.getServerMembers.mockResolvedValueOnce({ members: [wireMember('u1', { displayName: 'Old' })] })
    await s.loadServerMembers('s1')
    s.upsertMember('s1', wireMember('u2'))
    expect(s.membersByServer.value['s1']).toHaveLength(2)
    s.upsertMember('s1', wireMember('u1', { displayName: 'New' }))
    expect(s.membersByServer.value['s1']).toHaveLength(2)
    expect(s.membersByServer.value['s1'].find(m => m.id === 'u1')!.displayName).toBe('New')
  })

  it('ignores a member for a server whose list has not been fetched', () => {
    // Mirrors upsertChannel/upsertCategory's identical guard: creating the
    // bucket here would half-populate it, one member where the server
    // actually has ten.
    s.upsertMember('unknown', wireMember('ghost'))
    expect(s.membersByServer.value['unknown']).toBeUndefined()
  })

  it('removeMember drops them', async () => {
    api.getServerMembers.mockResolvedValueOnce({ members: [wireMember('u1'), wireMember('u2')] })
    await s.loadServerMembers('s1')
    s.removeMember('s1', 'u1')
    expect(s.membersByServer.value['s1'].map(m => m.id)).toEqual(['u2'])
  })

  it('removeServer drops its members', async () => {
    api.getServerMembers.mockResolvedValueOnce({ members: [wireMember('u1')] })
    await s.loadServerMembers('s1')
    s.removeServer('s1')
    expect(s.membersByServer.value['s1']).toBeUndefined()
  })

  it('resetServers clears membersByServer', async () => {
    api.getServerMembers.mockResolvedValueOnce({ members: [wireMember('u1')] })
    await s.loadServerMembers('s1')
    s.resetServers()
    expect(s.membersByServer.value).toEqual({})
  })
})

describe('serverIconFor', () => {
  it('returns the stored icon untouched', () => {
    expect(serverIconFor('Anything', 'https://cdn/a.gif')).toBe('https://cdn/a.gif')
  })

  it('generates a stable data-URI for the same name', () => {
    expect(serverIconFor('Skycord HQ')).toBe(serverIconFor('Skycord HQ'))
  })

  it('takes one initial per word, at most two', () => {
    expect(decodeURIComponent(serverIconFor('Skycord HQ'))).toContain('>SH<')
    expect(decodeURIComponent(serverIconFor('Dev'))).toContain('>D<')
    expect(decodeURIComponent(serverIconFor('one two three'))).toContain('>ot<')
  })

  it('does not crash on an empty name', () => {
    expect(serverIconFor('')).toContain('data:image/svg+xml')
  })
})

/**
 * The rail badge's whole derivation. Rendering is somebody else's problem —
 * what is pinned here is the decision this computed makes about what counts
 * as activity and which server it belongs to.
 */
describe('voiceActivityByServer', () => {
  let s: ReturnType<typeof useServers>

  beforeEach(() => {
    s = useServers()
    s.servers.value = []
    s.channelsByServer.value = {}
    s.categoriesByServer.value = {}
    s.activeServerId.value = null
    socket.activeCalls.value = {}
    socket.voiceRoomServers.value = {}
  })

  it('attributes an occupied room to the server the payload names', () => {
    socket.activeCalls.value      = { 'voice:c1': ['u1', 'u2'] }
    socket.voiceRoomServers.value = { 'voice:c1': 's1' }
    expect(s.voiceActivityByServer.value).toEqual({
      s1: [{ channelId: 'c1', channelName: null, userIds: ['u1', 'u2'] }],
    })
  })

  /* The cold-load case, and the reason `serverId` exists on the wire at all:
     no channel list for s1 has ever been fetched, so the badge can only come
     from the payload. A `channelsByServer`-only derivation returns {} here. */
  it('badges a server whose channel list was never fetched', () => {
    s.upsertServer(wireServer('s1'))
    socket.activeCalls.value      = { 'voice:c1': ['u1'] }
    socket.voiceRoomServers.value = { 'voice:c1': 's1' }
    expect(s.channelsByServer.value['s1']).toBeUndefined()
    expect(s.voiceActivityByServer.value['s1']).toHaveLength(1)
    expect(s.voiceActivityByServer.value['s1'][0].channelName).toBeNull()
  })

  it('names the channel once that server’s channels are known', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'General', 'voice')], [])
    socket.activeCalls.value      = { 'voice:c1': ['u1'] }
    socket.voiceRoomServers.value = { 'voice:c1': 's1' }
    expect(s.voiceActivityByServer.value['s1'][0].channelName).toBe('General')
  })

  /* The payload's serverId wins, but the local channel list is a real
     fallback: the server omits serverId when its channel->server map has no
     entry for that channel, and we may hold the channel ourselves. */
  it('falls back to the local channel list when the payload names no server', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'General', 'voice')], [])
    socket.activeCalls.value = { 'voice:c1': ['u1'] }
    expect(s.voiceActivityByServer.value['s1'][0].channelName).toBe('General')
  })

  it('drops a room neither source can attribute to a server', () => {
    socket.activeCalls.value = { 'voice:c9': ['u1'] }
    expect(s.voiceActivityByServer.value).toEqual({})
  })

  it('a room with no occupants is not activity', () => {
    s.receiveDetail(wireServer('s1'), [wireChannel('c1', 's1', 'General', 'voice')], [])
    socket.activeCalls.value      = { 'voice:c1': [] }
    socket.voiceRoomServers.value = { 'voice:c1': 's1' }
    expect(s.voiceActivityByServer.value).toEqual({})
  })

  /* Absent, not present-and-false. The template tests this map by lookup, so
     an empty array under s2 would light a badge for a server where nobody is
     talking. */
  it('omits a server with no activity rather than listing it empty', () => {
    s.upsertServer(wireServer('s1'))
    s.upsertServer(wireServer('s2'))
    socket.activeCalls.value      = { 'voice:c1': ['u1'] }
    socket.voiceRoomServers.value = { 'voice:c1': 's1' }
    const out = s.voiceActivityByServer.value
    expect(Object.keys(out)).toEqual(['s1'])
    expect('s2' in out).toBe(false)
    expect(out['s2']).toBeUndefined()
  })

  it('ignores DM and group calls, which are not server activity', () => {
    socket.activeCalls.value = { 'dm:u1_u2': ['u1', 'u2'], 'group:g1': ['u1'] }
    expect(s.voiceActivityByServer.value).toEqual({})
  })

  it('collects every occupied channel in one server, named ones first', () => {
    s.receiveDetail(wireServer('s1'), [
      wireChannel('c1', 's1', 'Zulu',  'voice'),
      wireChannel('c2', 's1', 'Alpha', 'voice'),
    ], [])
    socket.activeCalls.value = {
      'voice:c1': ['u1'], 'voice:c2': ['u2'],
      // Occupied, attributed to s1 by the payload, but not in the fetched
      // list — an unnamed row, and it sorts last.
      'voice:c3': ['u3'],
    }
    socket.voiceRoomServers.value = { 'voice:c1': 's1', 'voice:c2': 's1', 'voice:c3': 's1' }
    expect(s.voiceActivityByServer.value['s1'].map(a => a.channelName))
      .toEqual(['Alpha', 'Zulu', null])
  })

  it('separates two servers that each have someone in voice', () => {
    socket.activeCalls.value      = { 'voice:c1': ['u1'], 'voice:c2': ['u2', 'u3'] }
    socket.voiceRoomServers.value = { 'voice:c1': 's1', 'voice:c2': 's2' }
    const out = s.voiceActivityByServer.value
    expect(out['s1'][0].userIds).toEqual(['u1'])
    expect(out['s2'][0].userIds).toEqual(['u2', 'u3'])
  })
})
