import { describe, it, expect, beforeEach, vi } from 'vitest'
import { listenersText, useCallMusic } from '../callMusic'
import { music, setMusicTarget } from '../useMusic'

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

beforeEach(() => {
  emit.mockClear()
  music.channels = []; music.listeningTo = null; music.error = ''
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
