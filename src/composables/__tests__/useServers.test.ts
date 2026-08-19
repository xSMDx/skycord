import { describe, it, expect, beforeEach } from 'vitest'
import { useServers, serverIconFor } from '../useServers'
import type { WireServer, WireChannel } from '../useApi'

const wireServer = (id: string, name = id): WireServer => ({
  id, name, icon: null, iconCrop: null, bannerColor: null,
  description: null, owner: 'u1', memberCount: 1, createdAt: '2026-08-19T00:00:00.000Z',
})

const wireChannel = (id: string, server: string, name: string, type: 'text' | 'voice', position = 0): WireChannel =>
  ({ id, server, name, type, position })

describe('useServers', () => {
  let s: ReturnType<typeof useServers>

  beforeEach(() => {
    s = useServers()
    // Module-level state is shared across the whole app by design, so each
    // test starts by clearing it rather than by constructing a fresh instance.
    s.servers.value = []
    s.channelsByServer.value = {}
    s.activeServerId.value = null
    s.activeChannelId.value = null
    s.unreadChannels.value = {}
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

  it('tracks unread per channel and clears it on open', () => {
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
