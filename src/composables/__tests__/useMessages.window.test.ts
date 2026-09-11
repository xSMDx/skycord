import { describe, it, expect, beforeEach } from 'vitest'
import { useMessages } from '../useMessages'
import type { Message } from '@/types'

const msg = (dbId: string, content = dbId): Message => ({
  id: parseInt(dbId.slice(-6), 16), dbId, author: 'a', authorId: 'u1', content,
  time: '', timestamp: 0, avatar: '', avatarColor: '#5865f2', reactions: [],
})
const ids = (list: Message[]) => list.map(m => m.dbId)

describe('history windows', () => {
  const s = useMessages()
  beforeEach(() => {
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
