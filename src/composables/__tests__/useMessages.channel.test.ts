import { describe, it, expect, beforeEach } from 'vitest'
import { useMessages } from '../useMessages'
import type { Message } from '@/types'

const msg = (id: number, dbId: string, content = 'hi'): Message => ({
  id, dbId, author: 'Ada', authorId: 'u1', content,
  time: '10:30', timestamp: 1_755_000_000_000,
  avatar: '', avatarColor: '#5865f2', reactions: [],
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
