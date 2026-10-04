import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MUSIC_IDENTITY, music, setMusicTarget, listenToMusic,
  onMusicState, onMusicError, clearMusicError, musicChannel,
  createMusicChannel, skipMusic, shareToChannel, channelElapsed, musicNow,
  type MusicChannelView,
} from '../useMusic'

const emit = vi.fn()
vi.mock('../useSocket', () => ({ getSocket: () => ({ emit }) }))

const view = (channels: Partial<{ id: string; name: string; now: null; queued: number; listeners: string[] }>[]) => ({
  channels: channels.map(c => ({
    id: c.id ?? 'x', name: c.name ?? 'X', now: c.now ?? null,
    queue: [], queued: c.queued ?? 0, listeners: c.listeners ?? [],
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
    createMusicChannel('Chill', { url: 'https://x/a.mp3' })
    expect(emit).toHaveBeenCalledWith('music:create', {
      conversationId: 'c1', kind: 'channel', name: 'Chill', url: 'https://x/a.mp3',
    })
  })

  it('sends a library track as an id, never as a link', () => {
    createMusicChannel('Chill', { trackId: '507f1f77bcf86cd799439011' })
    expect(emit).toHaveBeenCalledWith('music:create', {
      conversationId: 'c1', kind: 'channel', name: 'Chill', trackId: '507f1f77bcf86cd799439011',
    })
    // No url key at all: the service composes the address itself.
    expect(emit.mock.calls[0][1]).not.toHaveProperty('url')
  })

  it('emits nothing at all when there is no call', () => {
    setMusicTarget(null)
    createMusicChannel('Chill', { url: 'https://x/a.mp3' })
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

/** A channel mid-song, as the server describes it at the moment it builds the state. */
const playing = (elapsedMs: number, durationSec: number | null = 200): { channels: MusicChannelView[] } => ({
  channels: [{
    id: 'p', name: 'Live', queue: [], queued: 0, listeners: [],
    now: {
      kind: 'library', title: 'Song', artist: null, durationSec, addedBy: 'u1',
      url: null, cover: null, elapsedMs,
    },
  }],
})

describe('where a shared song is', () => {
  afterEach(() => { vi.useRealTimers() })

  it('adds the time since the state arrived, by this clock alone', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    onMusicState(playing(30_000))
    const c = music.channels[0]
    expect(channelElapsed(c, Date.now())).toBe(30)
    // Five seconds later on this machine: the server is not asked again,
    // and its clock is never compared with ours.
    expect(channelElapsed(c, Date.now() + 5_000)).toBe(35)
  })

  it('never runs past the end of the song, or before its start', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    onMusicState(playing(195_000, 200))
    const c = music.channels[0]
    expect(channelElapsed(c, Date.now() + 60_000)).toBe(200)
    expect(channelElapsed(c, Date.now() - 600_000)).toBe(0)
  })

  it('keeps counting for a link that never said how long it is', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    onMusicState(playing(10_000, null))
    expect(channelElapsed(music.channels[0], Date.now() + 90_000)).toBe(100)
  })

  it('has no answer when nothing is playing', () => {
    onMusicState(view([{ id: 'a' }]))
    expect(channelElapsed(music.channels[0], Date.now())).toBeNull()
    expect(channelElapsed(null, Date.now())).toBeNull()
  })

  it('ticks while anything in the call plays, tuned in or not', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    onMusicState(playing(0))
    expect(music.listeningTo).toBeNull()
    const start = musicNow.value
    vi.advanceTimersByTime(3_000)
    // Not only for the channel you hear: the rail shows every channel's
    // progress, and a bar that froze on the others was the bug.
    expect(musicNow.value - start).toBe(3_000)
  })

  it('stops ticking when nothing plays, and when the call ends', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    onMusicState(playing(0))
    onMusicState(view([{ id: 'p' }]))
    const quiet = musicNow.value
    vi.advanceTimersByTime(5_000)
    expect(musicNow.value).toBe(quiet)

    onMusicState(playing(0))
    setMusicTarget(null)
    const after = musicNow.value
    vi.advanceTimersByTime(5_000)
    expect(musicNow.value).toBe(after)
  })
})

describe('sharing a track to a channel', () => {
  it('queues it as an id and moves your ear to that channel', () => {
    onMusicState(view([{ id: 'a' }]))
    shareToChannel('a', 'trk1')
    const events = emit.mock.calls.map(c => c[0])
    expect(events).toEqual(['music:queue', 'music:listen'])
    expect(emit.mock.calls[0][1]).toMatchObject({ channelId: 'a', trackId: 'trk1' })
    expect(emit.mock.calls[0][1]).not.toHaveProperty('url')
    expect(music.listeningTo).toBe('a')
  })

  it('does not re-tune when you are already listening there', () => {
    onMusicState(view([{ id: 'a' }]))
    listenToMusic('a')
    emit.mockClear()
    shareToChannel('a', 'trk2')
    // A second listen would replay the tune-in cue over the music.
    expect(emit.mock.calls.map(c => c[0])).toEqual(['music:queue'])
  })
})
