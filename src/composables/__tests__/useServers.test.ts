import { describe, it, expect, beforeEach } from 'vitest'
import { useServers, serverIconFor, COLLAPSED_CATEGORIES_KEY } from '../useServers'
import type { WireServer, WireChannel, WireCategory } from '../useApi'

const wireServer = (id: string, name = id): WireServer => ({
  id, name, icon: null, iconCrop: null, bannerColor: null,
  description: null, owner: 'u1', memberCount: 1, createdAt: '2026-08-19T00:00:00.000Z',
})

const wireChannel = (id: string, server: string, name: string, type: 'text' | 'voice', position = 0): WireChannel =>
  ({ id, server, name, type, position, category: null })

const wireCategory = (id: string, server: string, name: string, position = 0): WireCategory =>
  ({ id, server, name, position })

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

describe('useServers', () => {
  let s: ReturnType<typeof useServers>

  beforeEach(() => {
    s = useServers()
    // Module-level state is shared across the whole app by design, so each
    // test starts by clearing it rather than by constructing a fresh instance.
    s.servers.value = []
    s.channelsByServer.value = {}
    s.categoriesByServer.value = {}
    s.activeServerId.value = null
    s.activeChannelId.value = null
    s.unreadChannels.value = {}
    s.lastChannelIn.value = {}
    // Plan 3a shipped with lastChannelIn missing from this reset — the suite
    // passed anyway only because of declaration order, and broke the moment
    // that changed. collapsedCategories is new module-level state of exactly
    // the same shape; it goes in the reset from day one.
    s.collapsedCategories.value = {}
    ;(globalThis.localStorage as any).clear()
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

  it('splits channels by type and sorts them by position', () => {
    s.receiveDetail(wireServer('s1'), [
      wireChannel('c2', 's1', 'off-topic', 'text', 1),
      wireChannel('c1', 's1', 'general',   'text', 0),
      wireChannel('v1', 's1', 'Lounge',    'voice', 0),
    ])
    s.activeServerId.value = 's1'
    expect(s.textChannels.value.map(c => c.name)).toEqual(['general', 'off-topic'])
    expect(s.voiceChannels.value.map(c => c.name)).toEqual(['Lounge'])
  })

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
    s.receiveDetail(wireServer('s1'), [])
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
