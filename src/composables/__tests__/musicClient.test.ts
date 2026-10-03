import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  MUSIC_IDENTITY, music, setMusicTarget, listenToMusic,
  onMusicState, onMusicError, clearMusicError, musicChannel,
  createMusicChannel, skipMusic,
} from '../useMusic'

const emit = vi.fn()
vi.mock('../useSocket', () => ({ getSocket: () => ({ emit }) }))

const view = (channels: Partial<{ id: string; name: string; now: null; queued: number; listeners: string[] }>[]) => ({
  channels: channels.map(c => ({
    id: c.id ?? 'x', name: c.name ?? 'X', now: c.now ?? null,
    queued: c.queued ?? 0, listeners: c.listeners ?? [],
  })),
})

beforeEach(() => {
  emit.mockClear()
  music.channels = []; music.listeningTo = null; music.error = ''; music.volume = 0.6
  setMusicTarget({ conversationId: 'c1', kind: 'channel' })
})

describe('the service identity', () => {
  it('cannot collide with a member', () => {
    // Member identities are Mongo ObjectIds, set server-side in the LiveKit
    // token. The colon is what makes this unforgeable.
    expect(MUSIC_IDENTITY).toContain(':')
    expect(/^[0-9a-f]{24}$/.test(MUSIC_IDENTITY)).toBe(false)
  })
})

describe('state from the server', () => {
  it('replaces the list wholesale', () => {
    onMusicState(view([{ id: 'a' }, { id: 'b' }]))
    expect(music.channels).toHaveLength(2)
    onMusicState(view([{ id: 'a' }]))
    expect(music.channels).toHaveLength(1)
  })

  it('tunes us out of a channel that went away', () => {
    onMusicState(view([{ id: 'a' }]))
    listenToMusic('a')
    expect(music.listeningTo).toBe('a')
    onMusicState(view([{ id: 'b' }]))
    // Otherwise we hold an id nobody has, and the subscription watcher asks
    // for a track that is not published.
    expect(music.listeningTo).toBeNull()
  })

  it('leaves us tuned in when our channel survives', () => {
    onMusicState(view([{ id: 'a' }, { id: 'b' }]))
    listenToMusic('b')
    onMusicState(view([{ id: 'b' }, { id: 'c' }]))
    expect(music.listeningTo).toBe('b')
  })

  it('musicChannel resolves what we are listening to', () => {
    onMusicState(view([{ id: 'a', name: 'Chill' }, { id: 'b', name: 'Metal' }]))
    listenToMusic('b')
    expect(musicChannel.value?.name).toBe('Metal')
    listenToMusic(null)
    expect(musicChannel.value).toBeNull()
  })

  it('survives a payload with nothing in it', () => {
    onMusicState({ channels: [] })
    expect(music.channels).toEqual([])
    onMusicState(undefined as never)
    expect(music.channels).toEqual([])
  })
})

describe('tuning in', () => {
  it('sets the choice before the round trip, so the row answers the tap', () => {
    onMusicState(view([{ id: 'a' }]))
    listenToMusic('a')
    expect(music.listeningTo).toBe('a')
    expect(emit).toHaveBeenCalledWith('music:listen', { conversationId: 'c1', kind: 'channel', channelId: 'a' })
  })

  it('null tunes out', () => {
    listenToMusic(null)
    expect(music.listeningTo).toBeNull()
    expect(emit).toHaveBeenCalledWith('music:listen', { conversationId: 'c1', kind: 'channel', channelId: null })
  })
})

describe('the call target', () => {
  it('carries the call into every emit', () => {
    createMusicChannel('Chill', 'https://x/a.mp3')
    expect(emit).toHaveBeenCalledWith('music:create', {
      conversationId: 'c1', kind: 'channel', name: 'Chill', url: 'https://x/a.mp3',
    })
  })

  it('emits nothing at all when there is no call', () => {
    setMusicTarget(null)
    createMusicChannel('Chill', 'https://x/a.mp3')
    skipMusic('a')
    expect(emit).not.toHaveBeenCalled()
  })

  it('clears the panel when the call ends, so nothing stale outlives it', () => {
    onMusicState(view([{ id: 'a' }]))
    listenToMusic('a')
    onMusicError({ reason: 'nope' })
    setMusicTarget(null)
    expect(music.channels).toEqual([])
    expect(music.listeningTo).toBeNull()
    expect(music.error).toBe('')
  })

  it('does not clear when the same call is set again', () => {
    onMusicState(view([{ id: 'a' }]))
    setMusicTarget({ conversationId: 'c1', kind: 'channel' })
    expect(music.channels).toHaveLength(1)
  })
})

describe('errors', () => {
  it('keeps the reason for showing next to the control', () => {
    onMusicError({ reason: 'That link does not point at an audio file.' })
    expect(music.error).toContain('audio')
    clearMusicError()
    expect(music.error).toBe('')
  })

  it('says something even when the server said nothing', () => {
    onMusicError({} as never)
    expect(music.error).not.toBe('')
  })
})
