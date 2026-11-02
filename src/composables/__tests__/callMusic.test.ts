import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { listenersText, useCallMusic, CLOSE_ARM_MS } from '../callMusic'
import { music, setMusicTarget, onMusicError, onMusicState, isPaused, type MusicChannelView } from '../useMusic'

const emit = vi.fn()
vi.mock('../useSocket', () => ({ getSocket: () => ({ emit }) }))

/*
 * What the desktop flyout and the phone sheet share: the listeners line and
 * the small form state and handlers behind creating a channel, queueing a
 * link and tuning in. Run against the real useMusic with the socket spied, so
 * a test that passes means the right event left for the server, not that a
 * stub was called.
 */
const ana = { id: 'a', name: 'Ana' }
const ben = { id: 'b', name: 'Ben' }
const cy = { id: 'c', name: 'Cy' }
const dee = { id: 'd', name: 'Dee' }
const people = [ana, ben, cy, dee]

const sent = (event: string) => emit.mock.calls.filter(([e]) => e === event).map(([, p]) => p)

afterEach(() => { vi.useRealTimers() })

beforeEach(() => {
  emit.mockClear()
  music.channels = []; music.listeningTo = null; music.error = ''
  setMusicTarget(null)       // drops a pause still on its way from the last test
  setMusicTarget({ conversationId: 'c1', kind: 'channel' })
})

describe('who is listening, by name', () => {
  it('says nobody when the channel is empty', () => {
    expect(listenersText([], people)).toBe('Nobody yet')
  })

  it('names one, and two', () => {
    expect(listenersText(['a'], people)).toBe('Ana')
    expect(listenersText(['a', 'b'], people)).toBe('Ana and Ben')
  })

  it('names two, then "and N more"', () => {
    expect(listenersText(['a', 'b', 'c'], people)).toBe('Ana, Ben and 1 more')
    expect(listenersText(['a', 'b', 'c', 'd'], people)).toBe('Ana, Ben and 2 more')
  })

  it('keeps the order the channel gave', () => {
    expect(listenersText(['c', 'a', 'b'], people)).toBe('Cy, Ana and 1 more')
  })

  it('says "Someone" for a listener who is not in the call list', () => {
    expect(listenersText(['a', 'zz'], people)).toBe('Ana and Someone')
    expect(listenersText(['zz'], [])).toBe('Someone')
  })

  it('reads the people when it is asked, not when the form is made', () => {
    let now = [ana]
    const m = useCallMusic(() => now)
    expect(m.listeners(['a', 'b'])).toBe('Ana and Someone')
    now = [ana, ben]
    expect(m.listeners(['a', 'b'])).toBe('Ana and Ben')
  })
})

describe('starting a channel', () => {
  it('cannot start without both a name and a link, blanks not counting', () => {
    const m = useCallMusic(() => people)
    expect(m.canAdd.value).toBe(false)
    m.name.value = 'Chill'
    expect(m.canAdd.value).toBe(false)
    m.url.value = '   '
    expect(m.canAdd.value).toBe(false)
    m.url.value = 'https://x.test/a.mp3'
    expect(m.canAdd.value).toBe(true)
  })

  it('sends nothing while it cannot start', () => {
    const m = useCallMusic(() => people)
    m.name.value = 'Chill'
    m.submitNew()
    expect(emit).not.toHaveBeenCalled()
    expect(m.name.value).toBe('Chill')
  })

  it('creates the channel with the trimmed name and link, and shuts the empty form', () => {
    const m = useCallMusic(() => people)
    m.openNew()
    expect(m.adding.value).toBe(true)
    m.name.value = '  Chill '
    m.url.value = ' https://x.test/a.mp3  '
    m.submitNew()
    expect(sent('music:create')).toEqual([
      { conversationId: 'c1', kind: 'channel', name: 'Chill', url: 'https://x.test/a.mp3' },
    ])
    // Cleared on submit, not on success: the server answers with a state, not an ack.
    expect(m.adding.value).toBe(false)
    expect(m.name.value).toBe('')
    expect(m.url.value).toBe('')
  })

  it('clears an old refusal before it asks again', () => {
    music.error = 'That link did not work.'
    const m = useCallMusic(() => people)
    m.name.value = 'Chill'
    m.url.value = 'https://x.test/a.mp3'
    m.submitNew()
    expect(music.error).toBe('')
  })

  it('cancelling shuts the form and clears the refusal that was beside it', () => {
    music.error = 'That link did not work.'
    const m = useCallMusic(() => people)
    m.openNew()
    m.cancelNew()
    expect(m.adding.value).toBe(false)
    expect(music.error).toBe('')
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('queueing a link', () => {
  it('opens for one channel at a time, and a second tap on the same one shuts it', () => {
    const m = useCallMusic(() => people)
    expect(m.queueFor.value).toBeNull()
    m.toggleQueue('x')
    expect(m.queueFor.value).toBe('x')
    m.toggleQueue('y')
    expect(m.queueFor.value).toBe('y')
    m.toggleQueue('y')
    expect(m.queueFor.value).toBeNull()
  })

  it('does not carry a link typed for one channel over to another', () => {
    const m = useCallMusic(() => people)
    m.toggleQueue('a')
    m.queueUrl.value = 'https://x.test/for-a.mp3'
    m.toggleQueue('b')
    expect(m.queueFor.value).toBe('b')
    expect(m.queueUrl.value).toBe('')
    // The tap on Add under B sends nothing: there is nothing there for B.
    m.submitQueue('b')
    expect(emit).not.toHaveBeenCalled()
    // And a link typed now goes to B alone.
    m.queueUrl.value = 'https://x.test/for-b.mp3'
    m.submitQueue('b')
    expect(sent('music:queue')).toEqual([
      { conversationId: 'c1', kind: 'channel', channelId: 'b', url: 'https://x.test/for-b.mp3' },
    ])
  })

  it('opens a form empty after the sheet shut one with its text still in it', () => {
    // PhoneMusicSheet shuts a form by clearing queueFor on close, not through toggleQueue.
    const m = useCallMusic(() => people)
    m.toggleQueue('a')
    m.queueUrl.value = 'https://x.test/for-a.mp3'
    m.queueFor.value = null
    m.toggleQueue('b')
    expect(m.queueUrl.value).toBe('')
    m.submitQueue('b')
    expect(emit).not.toHaveBeenCalled()
  })

  it('keeps what was typed while the form stays open on the same channel', () => {
    const m = useCallMusic(() => people)
    m.toggleQueue('a')
    m.queueUrl.value = 'https://x.test/for-a.mp3'
    m.skipTrack('a')                         // other actions leave the draft alone
    m.toggleListen('a')
    expect(m.queueFor.value).toBe('a')
    expect(m.queueUrl.value).toBe('https://x.test/for-a.mp3')
  })

  it('sends nothing for a blank link', () => {
    const m = useCallMusic(() => people)
    m.toggleQueue('x')
    m.queueUrl.value = '   '
    m.submitQueue('x')
    expect(emit).not.toHaveBeenCalled()
    expect(m.queueFor.value).toBe('x')
  })

  it('queues the trimmed link on that channel, then clears and shuts', () => {
    const m = useCallMusic(() => people)
    m.toggleQueue('x')
    m.queueUrl.value = '  https://x.test/next.mp3 '
    m.submitQueue('x')
    expect(sent('music:queue')).toEqual([
      { conversationId: 'c1', kind: 'channel', channelId: 'x', url: 'https://x.test/next.mp3' },
    ])
    expect(m.queueUrl.value).toBe('')
    expect(m.queueFor.value).toBeNull()
  })

  it('clears an old refusal before it asks again', () => {
    music.error = 'Queue is full.'
    const m = useCallMusic(() => people)
    m.queueUrl.value = 'https://x.test/next.mp3'
    m.submitQueue('x')
    expect(music.error).toBe('')
  })
})

describe('tuning in and out', () => {
  it('tunes into a channel you are not on', () => {
    const m = useCallMusic(() => people)
    m.toggleListen('x')
    expect(music.listeningTo).toBe('x')
    expect(sent('music:listen')).toEqual([{ conversationId: 'c1', kind: 'channel', channelId: 'x' }])
  })

  it('tuning into another moves you across', () => {
    const m = useCallMusic(() => people)
    m.toggleListen('x')
    m.toggleListen('y')
    expect(music.listeningTo).toBe('y')
  })

  it('stops when you ask for the one you are already on', () => {
    const m = useCallMusic(() => people)
    m.toggleListen('x')
    emit.mockClear()
    m.toggleListen('x')
    expect(music.listeningTo).toBeNull()
    expect(sent('music:listen')).toEqual([{ conversationId: 'c1', kind: 'channel', channelId: null }])
  })
})

/** A channel with a song on, as the server describes it. */
const channelView = (id: string, over: Partial<MusicChannelView> = {}): MusicChannelView => ({
  id, name: id.toUpperCase(), queue: [], queued: 0, listeners: [], previous: false,
  now: { id: 'e1', kind: 'library', title: 'Song', artist: null, durationSec: 200, addedBy: 'a', url: null, cover: null, elapsedMs: 0 },
  ...over,
})

describe('pausing and resuming a channel', () => {
  it('pauses a playing channel and resumes a paused one, for that channel', () => {
    onMusicState({ channels: [channelView('p', { pausable: true, paused: false }), channelView('q', { pausable: true, paused: true })] })
    const m = useCallMusic(() => people)
    m.togglePause('p')
    m.togglePause('q')
    expect(sent('music:pause')).toEqual([{ conversationId: 'c1', kind: 'channel', channelId: 'p' }])
    expect(sent('music:resume')).toEqual([{ conversationId: 'c1', kind: 'channel', channelId: 'q' }])
  })

  it('sends nothing for a channel whose server cannot pause, or that has no song', () => {
    onMusicState({ channels: [channelView('old'), channelView('quiet', { pausable: true, now: null })] })
    const m = useCallMusic(() => people)
    m.togglePause('old')
    m.togglePause('quiet')
    m.togglePause('gone')
    expect(emit).not.toHaveBeenCalled()
  })

  it('clears an old refusal first, and records the channel so a new refusal lands on its card', () => {
    onMusicState({ channels: [channelView('p', { pausable: true })] })
    music.error = 'Old.'
    const m = useCallMusic(() => people)
    m.togglePause('p')
    expect(music.error).toBe('')
    expect(m.origin.value).toBe('p')
    onMusicError({ reason: 'The music could not be paused. Try again in a moment.' })
    expect(m.refusedAt.value).toBe('p')
  })

  it('leaves the channel as it was when the pause is refused: nothing was flipped ahead of the server', () => {
    onMusicState({ channels: [channelView('p', { pausable: true, paused: false })] })
    const m = useCallMusic(() => people)
    m.togglePause('p')
    onMusicError({ reason: 'The music could not be paused. Try again in a moment.' })
    expect(isPaused(music.channels[0])).toBe(false)
  })

  it('does nothing on a second tap while the first is on its way: one emit, and the card it answers stays put', () => {
    onMusicState({ channels: [channelView('p', { pausable: true })] })
    const m = useCallMusic(() => people)
    m.togglePause('p')
    m.toggleListen('l')
    m.togglePause('p')
    expect(sent('music:pause')).toHaveLength(1)
    expect(m.origin.value).toBe('l')
  })

  it('disarms a Close that was armed', () => {
    vi.useFakeTimers()
    onMusicState({ channels: [channelView('p', { pausable: true })] })
    const m = useCallMusic(() => people)
    m.closeChannel('x')
    m.togglePause('p')
    expect(m.closing.value).toBeNull()
  })
})

describe('two forms, no shared drafts', () => {
  it('each caller gets its own form state', () => {
    const a = useCallMusic(() => people)
    const b = useCallMusic(() => people)
    a.name.value = 'Chill'
    a.openNew()
    expect(b.name.value).toBe('')
    expect(b.adding.value).toBe(false)
  })
})

describe('where an action came from', () => {
  it('records "new" for a create, and the channel for a queue, skip, close and listen', () => {
    vi.useFakeTimers()
    const m = useCallMusic(() => people)
    expect(m.origin.value).toBeNull()

    m.name.value = 'Chill'; m.url.value = 'https://x.test/a.mp3'
    m.submitNew()
    expect(m.origin.value).toBe('new')

    m.queueUrl.value = 'https://x.test/next.mp3'
    m.submitQueue('q1')
    expect(m.origin.value).toBe('q1')

    m.skipTrack('s1')
    expect(m.origin.value).toBe('s1')

    m.closeChannel('c9'); m.closeChannel('c9')
    expect(m.origin.value).toBe('c9')

    m.toggleListen('l1')
    expect(m.origin.value).toBe('l1')
  })

  it('does not record an action that sent nothing', () => {
    const m = useCallMusic(() => people)
    m.toggleListen('l1')
    m.submitNew()             // nothing typed
    m.submitQueue('q1')       // blank link
    expect(m.origin.value).toBe('l1')
  })

  it('skipTrack sends the skip for that channel and clears an old refusal first', () => {
    music.error = 'Old.'
    const m = useCallMusic(() => people)
    m.skipTrack('s1')
    expect(sent('music:skip')).toEqual([{ conversationId: 'c1', kind: 'channel', channelId: 's1' }])
    expect(music.error).toBe('')
  })
})

describe('where a refusal belongs', () => {
  it('belongs to the action that was last sent when it arrived', () => {
    const m = useCallMusic(() => people)
    m.skipTrack('s1')
    expect(m.refusedAt.value).toBeNull()
    onMusicError({ reason: 'You are doing that too fast. Give it a moment.' })
    expect(m.refusedAt.value).toBe('s1')
  })

  it('stays with the card it answered when you go on to do something else', () => {
    const m = useCallMusic(() => people)
    m.skipTrack('s1')
    onMusicError({ reason: 'Nothing to skip.' })
    m.toggleListen('l1')       // a listen does not clear a refusal
    expect(m.origin.value).toBe('l1')
    expect(m.refusedAt.value).toBe('s1')
  })

  it('moves to the new card when the next action is refused too, even with the same words', () => {
    const m = useCallMusic(() => people)
    m.skipTrack('s1')
    onMusicError({ reason: 'You are doing that too fast. Give it a moment.' })
    m.skipTrack('s2')          // clears the old one, so the next arrival is a change
    onMusicError({ reason: 'You are doing that too fast. Give it a moment.' })
    expect(m.refusedAt.value).toBe('s2')
  })

  it('belongs to the new-channel card for a refused create', () => {
    const m = useCallMusic(() => people)
    m.name.value = 'Chill'; m.url.value = 'https://x.test/a.mp3'
    m.submitNew()
    onMusicError({ reason: 'That link did not work.' })
    expect(m.refusedAt.value).toBe('new')
  })

  it('belongs to nobody once it is cleared, and when it arrived before there was an action', () => {
    const m = useCallMusic(() => people)
    onMusicError({ reason: 'Early.' })
    expect(m.refusedAt.value).toBeNull()          // the sheet shows it elsewhere
    m.skipTrack('s1')
    onMusicError({ reason: 'Late.' })
    expect(m.refusedAt.value).toBe('s1')
    m.cancelNew()
    expect(m.refusedAt.value).toBeNull()
  })
})

describe('closing a channel takes two taps', () => {
  type Form = ReturnType<typeof useCallMusic>

  it('arms on the first tap and sends nothing', () => {
    vi.useFakeTimers()
    const m = useCallMusic(() => people)
    m.closeChannel('x')
    expect(m.closing.value).toBe('x')
    expect(emit).not.toHaveBeenCalled()
  })

  it('closes on a second tap on the same channel within the window, and disarms', () => {
    vi.useFakeTimers()
    const m = useCallMusic(() => people)
    m.closeChannel('x')
    vi.advanceTimersByTime(CLOSE_ARM_MS - 1)
    expect(m.closing.value).toBe('x')
    m.closeChannel('x')
    expect(sent('music:close')).toEqual([{ conversationId: 'c1', kind: 'channel', channelId: 'x' }])
    expect(m.closing.value).toBeNull()
  })

  it('drops the arm after three seconds, so the next tap arms again rather than closing', () => {
    vi.useFakeTimers()
    expect(CLOSE_ARM_MS).toBe(3000)
    const m = useCallMusic(() => people)
    m.closeChannel('x')
    vi.advanceTimersByTime(CLOSE_ARM_MS)
    expect(m.closing.value).toBeNull()
    m.closeChannel('x')
    expect(emit).not.toHaveBeenCalled()
    expect(m.closing.value).toBe('x')
  })

  it('counts the window from the arming tap, not from a tap elsewhere', () => {
    vi.useFakeTimers()
    const m = useCallMusic(() => people)
    m.closeChannel('x')
    vi.advanceTimersByTime(2000)
    m.closeChannel('y')                 // a different channel: arms y, does not close x
    expect(m.closing.value).toBe('y')
    vi.advanceTimersByTime(2000)        // 4s since x, 2s since y
    expect(m.closing.value).toBe('y')
    expect(emit).not.toHaveBeenCalled()
  })

  it('arming one channel disarms another, and a tap on the first arms it fresh', () => {
    vi.useFakeTimers()
    const m = useCallMusic(() => people)
    m.closeChannel('x')
    m.closeChannel('y')
    m.closeChannel('x')
    expect(m.closing.value).toBe('x')
    expect(emit).not.toHaveBeenCalled()
  })

  it.each([
    ['skipping a track', (m: Form) => m.skipTrack('z')],
    ['opening a track link', (m: Form) => m.toggleQueue('z')],
    ['tuning in', (m: Form) => m.toggleListen('z')],
    ['opening the new-channel form', (m: Form) => m.openNew()],
    ['cancelling it', (m: Form) => m.cancelNew()],
    ['being asked to disarm', (m: Form) => m.disarm()],
  ])('disarms on %s', (_what, act) => {
    vi.useFakeTimers()
    const m = useCallMusic(() => people)
    m.closeChannel('x')
    act(m)
    expect(m.closing.value).toBeNull()
    emit.mockClear()
    m.closeChannel('x')                 // arms again; it does not close
    expect(sent('music:close')).toEqual([])
  })

  it('disarms on sending a link and on starting a channel', () => {
    vi.useFakeTimers()
    const m = useCallMusic(() => people)
    m.closeChannel('x')
    m.queueUrl.value = 'https://x.test/next.mp3'
    m.submitQueue('q1')
    expect(m.closing.value).toBeNull()

    m.closeChannel('x')
    m.name.value = 'Chill'; m.url.value = 'https://x.test/a.mp3'
    m.submitNew()
    expect(m.closing.value).toBeNull()
  })

  it('clears an old refusal when it closes, and records the channel as the origin', () => {
    vi.useFakeTimers()
    const m = useCallMusic(() => people)
    m.closeChannel('x')
    music.error = 'Old.'
    m.closeChannel('x')
    expect(music.error).toBe('')
    expect(m.origin.value).toBe('x')
  })
})
