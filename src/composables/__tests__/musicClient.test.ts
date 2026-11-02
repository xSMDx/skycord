import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MUSIC_IDENTITY, music, setMusicTarget, listenToMusic,
  onMusicState, onMusicError, clearMusicError, musicChannel,
  createMusicChannel, skipMusic, shareToChannel, channelElapsed, musicNow,
  seekMusic, playNowMusic, pauseMusic, resumeMusic, togglePauseMusic, isPaused, canPause, canPauseOrResume,
  isPausePending, PAUSE_SETTLE_MS,
  type MusicChannelView,
} from '../useMusic'

const emit = vi.fn()
vi.mock('../useSocket', () => ({ getSocket: () => ({ emit }) }))

const view = (channels: Partial<{ id: string; name: string; now: null; queued: number; listeners: string[] }>[]) => ({
  channels: channels.map(c => ({
    id: c.id ?? 'x', name: c.name ?? 'X', now: c.now ?? null,
    queue: [], queued: c.queued ?? 0, listeners: c.listeners ?? [], previous: false,
  })),
})

beforeEach(() => {
  emit.mockClear()
  music.channels = []; music.listeningTo = null; music.error = ''; music.volume = 0.6
  // Leaving first drops anything still on its way from the last test.
  setMusicTarget(null)
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
    id: 'p', name: 'Live', queue: [], queued: 0, listeners: [], previous: false,
    now: {
      id: 'e0', kind: 'library', title: 'Song', artist: null, durationSec, addedBy: 'u1',
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

describe('moving a shared song', () => {
  it('seek sends whole seconds', () => {
    seekMusic('a', 83.7)
    expect(emit).toHaveBeenCalledWith('music:seek', expect.objectContaining({ channelId: 'a', sec: 83 }))
  })

  it('play now names the entry, not a position', () => {
    playNowMusic('a', 'e1')
    expect(emit).toHaveBeenCalledWith('music:play-now', expect.objectContaining({ channelId: 'a', entryId: 'e1' }))
  })
})

/** The same channel, paused or not, on a server whose music service can pause. */
const held = (elapsedMs: number, paused: boolean, over: Partial<MusicChannelView> = {}): { channels: MusicChannelView[] } => ({
  channels: [{ ...playing(elapsedMs).channels[0], paused, pausable: true, ...over }],
})

describe('pausing a shared song', () => {
  it('pause emits music:pause, and resume emits music:resume, for that channel', () => {
    pauseMusic('a')
    resumeMusic('b')
    expect(emit.mock.calls).toEqual([
      ['music:pause', { conversationId: 'c1', kind: 'channel', channelId: 'a' }],
      ['music:resume', { conversationId: 'c1', kind: 'channel', channelId: 'b' }],
    ])
  })

  it('the toggle asks for whichever the channel is not', () => {
    onMusicState(held(0, false))
    togglePauseMusic(music.channels[0])
    onMusicState(held(0, true))
    togglePauseMusic(music.channels[0])
    expect(emit.mock.calls.map(c => c[0])).toEqual(['music:pause', 'music:resume'])
    expect(emit.mock.calls[0][1]).toMatchObject({ channelId: 'p' })
  })

  it('reads a missing paused field as playing: an older server never sends one', () => {
    onMusicState(playing(0))
    expect(isPaused(music.channels[0])).toBe(false)
    expect(isPaused(null)).toBe(false)
  })

  it('offers the control only when the server says the service can pause, and there is a song', () => {
    onMusicState(playing(0))
    expect(canPause(music.channels[0])).toBe(false)          // older server: no pausable
    onMusicState(held(0, false))
    expect(canPause(music.channels[0])).toBe(true)
    onMusicState(held(0, false, { now: null }))
    expect(canPause(music.channels[0])).toBe(false)          // nothing to pause
    expect(isPaused(music.channels[0])).toBe(false)
  })

  it('offers Resume for a held song even once the server stops saying it can pause, and Pause only while it does', () => {
    onMusicState(held(0, true, { pausable: undefined }))
    expect(canPause(music.channels[0])).toBe(false)
    expect(canPauseOrResume(music.channels[0])).toBe(true)
    togglePauseMusic(music.channels[0])
    expect(emit.mock.calls.map(c => c[0])).toEqual(['music:resume'])
    emit.mockClear()
    onMusicState(held(0, false, { pausable: undefined }))
    expect(canPauseOrResume(music.channels[0])).toBe(false)
    togglePauseMusic(music.channels[0])
    expect(emit).not.toHaveBeenCalled()
    onMusicState(held(0, false))
    expect(canPauseOrResume(music.channels[0])).toBe(true)
    expect(canPauseOrResume(null)).toBe(false)
  })

  it('sends nothing for a channel that cannot pause', () => {
    onMusicState(playing(0))
    togglePauseMusic(music.channels[0])
    expect(emit).not.toHaveBeenCalled()
  })

  it('does not flip on its own: the channel stays as the server last said until it says otherwise', () => {
    onMusicState(held(0, false))
    togglePauseMusic(music.channels[0])
    expect(isPaused(music.channels[0])).toBe(false)
    // Refused: the server sends a reason and no state, and nothing has changed.
    onMusicError({ reason: 'The music could not be paused. Try again in a moment.' })
    expect(isPaused(music.channels[0])).toBe(false)
  })
})

describe('a pause on its way', () => {
  // The server asks the music service before it tells anyone, which can take
  // up to its five-second timeout. Until then the control still reads Pause,
  // and a second tap would be refused "It is already paused." right after a
  // pause that worked — and spend a rate-limit token on the way.
  afterEach(() => { vi.useRealTimers() })

  it('two toggles before the state send one emit', () => {
    onMusicState(held(0, false))
    togglePauseMusic(music.channels[0])
    togglePauseMusic(music.channels[0])
    pauseMusic('p')                                         // the command path too
    expect(emit.mock.calls.map(c => c[0])).toEqual(['music:pause'])
    expect(isPausePending(music.channels[0])).toBe(true)
  })

  it('is per channel: another channel can still be paused', () => {
    onMusicState({ channels: [held(0, false).channels[0], { ...held(0, false).channels[0], id: 'q' }] })
    togglePauseMusic(music.channels[0])
    togglePauseMusic(music.channels[1])
    expect(emit.mock.calls.map(c => c[1].channelId)).toEqual(['p', 'q'])
  })

  it('the state clears pending once it shows the pause, and the next tap resumes', () => {
    onMusicState(held(0, false))
    togglePauseMusic(music.channels[0])
    onMusicState(held(0, true))
    expect(isPausePending(music.channels[0])).toBe(false)
    togglePauseMusic(music.channels[0])
    expect(emit.mock.calls.map(c => c[0])).toEqual(['music:pause', 'music:resume'])
  })

  it('stays pending through a state about something else, which still shows it playing', () => {
    // Someone queueing a song in the gap broadcasts too; that is not the answer.
    onMusicState(held(0, false))
    togglePauseMusic(music.channels[0])
    onMusicState(held(1_000, false, { queued: 1 }))
    expect(isPausePending(music.channels[0])).toBe(true)
  })

  it('the state clears pending when the song it was for has gone, or the channel has', () => {
    onMusicState(held(0, false))
    togglePauseMusic(music.channels[0])
    const next = held(0, false).channels[0]
    onMusicState({ channels: [{ ...next, now: { ...next.now!, id: 'e9' } }] })
    expect(isPausePending(music.channels[0])).toBe(false)

    togglePauseMusic(music.channels[0])
    onMusicState({ channels: [] })
    onMusicState(held(0, false))
    expect(isPausePending(music.channels[0])).toBe(false)
  })

  it('a refusal clears pending, and leaves the channel as it was', () => {
    onMusicState(held(0, false))
    togglePauseMusic(music.channels[0])
    onMusicError({ reason: 'The music could not be paused. Try again in a moment.' })
    expect(isPausePending(music.channels[0])).toBe(false)
    expect(isPaused(music.channels[0])).toBe(false)
    togglePauseMusic(music.channels[0])
    expect(emit.mock.calls.map(c => c[0])).toEqual(['music:pause', 'music:pause'])
  })

  it('a refusal naming its channel ends only that channel’s wait', () => {
    onMusicState({ channels: [held(0, false).channels[0], { ...held(0, false).channels[0], id: 'q', name: 'Other' }] })
    togglePauseMusic(music.channels[0])
    togglePauseMusic(music.channels[1])
    onMusicError({ reason: 'The music could not be paused. Try again in a moment.', channelId: 'q' })
    expect(isPausePending(music.channels[0])).toBe(true)
    expect(isPausePending(music.channels[1])).toBe(false)
  })

  it('a refusal that names no channel ends a wait only when there is just the one it can answer', () => {
    // An older server says no channel. With one pause on its way that is the
    // answer; with two, guessing would free a control whose answer is still coming.
    onMusicState({ channels: [held(0, false).channels[0], { ...held(0, false).channels[0], id: 'q', name: 'Other' }] })
    togglePauseMusic(music.channels[0])
    togglePauseMusic(music.channels[1])
    onMusicError({ reason: 'You are doing that too fast. Give it a moment.' })
    expect(isPausePending(music.channels[0])).toBe(true)
    expect(isPausePending(music.channels[1])).toBe(true)
    onMusicState({ channels: [held(0, true).channels[0], { ...held(0, false).channels[0], id: 'q', name: 'Other' }] })
    expect(isPausePending(music.channels[0])).toBe(false)
    onMusicError({ reason: 'The music could not be paused. Try again in a moment.' })
    expect(isPausePending(music.channels[1])).toBe(false)
  })

  it('the timer clears pending, just past the service timeout, if no answer ever comes', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    expect(PAUSE_SETTLE_MS).toBeGreaterThan(5_000)
    expect(PAUSE_SETTLE_MS).toBeLessThanOrEqual(7_000)
    onMusicState(held(0, false))
    togglePauseMusic(music.channels[0])
    vi.advanceTimersByTime(PAUSE_SETTLE_MS - 1)
    expect(isPausePending(music.channels[0])).toBe(true)
    vi.advanceTimersByTime(1)
    expect(isPausePending(music.channels[0])).toBe(false)
  })

  it('leaving the call clears it', () => {
    onMusicState(held(0, false))
    togglePauseMusic(music.channels[0])
    setMusicTarget(null)
    expect(isPausePending(held(0, false).channels[0])).toBe(false)
  })

  it('marks nothing when nothing was sent', () => {
    setMusicTarget(null)
    pauseMusic('p')
    expect(emit).not.toHaveBeenCalled()
    expect(isPausePending(held(0, false).channels[0])).toBe(false)
  })
})

describe('where a paused song is', () => {
  afterEach(() => { vi.useRealTimers() })

  it('elapsed stops while paused, at the point the server froze it', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    onMusicState(held(30_000, true))
    const c = music.channels[0]
    expect(channelElapsed(c, Date.now())).toBe(30)
    expect(channelElapsed(c, Date.now() + 60_000)).toBe(30)
  })

  it('carries on from the frozen point on resume, without a jump', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    onMusicState(held(30_000, true))
    vi.advanceTimersByTime(45_000)                            // left paused for a while
    expect(channelElapsed(music.channels[0], musicNow.value)).toBe(30)
    // The resume broadcast carries the held point; the bar picks up from it.
    onMusicState(held(30_000, false))
    expect(channelElapsed(music.channels[0], musicNow.value)).toBe(30)
    vi.advanceTimersByTime(2_000)
    expect(channelElapsed(music.channels[0], musicNow.value)).toBe(32)
  })

  it('a seek while paused stays paused, at the new point', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    onMusicState(held(30_000, true))
    onMusicState(held(90_000, true))
    expect(isPaused(music.channels[0])).toBe(true)
    expect(channelElapsed(music.channels[0], Date.now() + 10_000)).toBe(90)
  })

  it('a skip while paused plays: the next song counts up again', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    onMusicState(held(30_000, true))
    onMusicState(held(0, false))
    expect(isPaused(music.channels[0])).toBe(false)
    expect(channelElapsed(music.channels[0], Date.now() + 4_000)).toBe(4)
  })

  it('stops ticking while everything is paused, and starts again on resume', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    onMusicState(held(0, true))
    const still = musicNow.value
    vi.advanceTimersByTime(5_000)
    expect(musicNow.value).toBe(still)
    onMusicState(held(0, false))
    const start = musicNow.value
    vi.advanceTimersByTime(3_000)
    expect(musicNow.value - start).toBe(3_000)
  })
})

describe('only your own call', () => {
  // Every member of a server hears every voice channel's music state: the
  // audience is the server, not the call. Applying all of them made the
  // rail flip between calls whenever another channel changed.
  const roomState = (room: string, id: string) => ({ room, ...view([{ id, name: id }]) })

  it("ignores another call's state", () => {
    setMusicTarget({ conversationId: 'c1', kind: 'channel' }, 'voice:c1')
    onMusicState(roomState('voice:c1', 'mine'))
    onMusicState(roomState('voice:other', 'theirs'))
    expect(music.channels.map(c => c.id)).toEqual(['mine'])
  })

  it('keeps a state that arrived before the call was set, and shows it once it is', () => {
    // The server answers a join with the room's state, and that can land
    // before the client has finished deciding which call it is in.
    setMusicTarget(null)
    onMusicState(roomState('voice:c2', 'early'))
    expect(music.channels).toEqual([])
    setMusicTarget({ conversationId: 'c2', kind: 'channel' }, 'voice:c2')
    expect(music.channels.map(c => c.id)).toEqual(['early'])
  })

  it('shows nothing when you are in no call', () => {
    setMusicTarget(null)
    onMusicState(roomState('voice:c3', 'x'))
    expect(music.channels).toEqual([])
  })
})
