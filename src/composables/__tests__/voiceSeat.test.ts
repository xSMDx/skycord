/**
 * A page in a call checks that the voice list has it, and asks for its seat
 * back when it does not.
 *
 * The page is the one party that knows for certain it is in the call: it holds
 * the media connection. The server's list is only as good as the messages that
 * reached it, and on a shaky network some do not — a rejoin lost with the
 * connection it was sent on, a seat dropped behind the page's back. Every
 * member then saw the person missing from the voice channel while they were
 * still talking in it, and nothing ever corrected it.
 *
 * So the page compares the server's list for its own call with the truth it
 * holds: whenever that list changes, and every so often in case it never does.
 * It asks again with the same rejoin a reconnect sends, which seats nobody new
 * and announces nothing. It asks at most once per few seconds, so a server that
 * keeps refusing (the person was removed from the channel) is not flooded.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'

const sock = vi.hoisted(() => ({
  activeCalls: null as any, connected: null as any, connState: null as any, retry: null as any,
}))
vi.mock('../useSocket', async () => {
  const { ref } = await import('vue')
  sock.activeCalls = ref<Record<string, string[]>>({})
  sock.connected = ref(true)
  sock.connState = ref('connected')
  sock.retry = vi.fn()
  return {
    activeCalls: sock.activeCalls, connected: sock.connected,
    connState: sock.connState, retryConnection: sock.retry,
  }
})

const v = vi.hoisted(() => ({ voice: null as any, reannounce: null as any }))
vi.mock('../useVoice', async () => {
  const { reactive } = await import('vue')
  v.voice = reactive({ connected: false, activeConvId: null, activeKind: null })
  v.reannounce = vi.fn(() => true)
  return {
    voice: v.voice,
    reannounceCall: v.reannounce,
    voiceRoomName: (kind: string, convId: string, myId: string) =>
      kind === 'channel' ? `voice:${convId}`
      : kind === 'group' ? `group:${convId}`
      : `dm:${[myId, convId].sort().join('_')}`,
  }
})

vi.mock('../useAuth', async () => {
  const { ref } = await import('vue')
  const user = ref({ id: 'me' })
  return { useAuth: () => ({ user }) }
})

const { installVoiceSeatWatch, SEAT_RETRY_MS, SEAT_CHECK_MS } = await import('../voiceSeat')

let stop: () => void
const inCall = (convId = 'c1', kind: 'channel' | 'dm' | 'group' = 'channel') => {
  v.voice.connected = true
  v.voice.activeConvId = convId
  v.voice.activeKind = kind
}
/**
 * In a call whose own call:join has had time to land. A call that has just
 * gone live counts its join as the first ask, so the page waits SEAT_RETRY_MS
 * before asking again.
 */
const joinedCall = async (convId = 'c1', kind: 'channel' | 'dm' | 'group' = 'channel') => {
  inCall(convId, kind)
  await nextTick()
  vi.advanceTimersByTime(SEAT_RETRY_MS)
}
/** The server's list for a room, as a call:state would leave it. */
const serverSays = async (room: string, ids: string[]) => {
  sock.activeCalls.value = { ...sock.activeCalls.value, [room]: ids }
  await nextTick()
}

beforeEach(() => {
  vi.useFakeTimers()
  v.voice.connected = false
  v.voice.activeConvId = null
  v.voice.activeKind = null
  sock.activeCalls.value = {}
  sock.connected.value = true
  sock.connState.value = 'connected'
  sock.retry.mockClear()
  v.reannounce.mockClear()
  stop = installVoiceSeatWatch()
})
afterEach(() => {
  stop()
  vi.useRealTimers()
})

describe('the voice list leaves out the page that is in the call', () => {
  it('asks for its seat back', async () => {
    await joinedCall()
    await serverSays('voice:c1', ['someone-else'])
    expect(v.reannounce).toHaveBeenCalledTimes(1)
  })

  it('gives its own join a moment to land first', async () => {
    inCall()
    await nextTick()
    await serverSays('voice:c1', ['someone-else'])
    expect(v.reannounce).not.toHaveBeenCalled()

    vi.advanceTimersByTime(SEAT_RETRY_MS)
    await serverSays('voice:c1', ['someone-else', 'another'])
    expect(v.reannounce).toHaveBeenCalledTimes(1)
  })

  it('asks when its call drops out of the list altogether', async () => {
    await joinedCall()
    await serverSays('voice:c1', ['me'])
    sock.activeCalls.value = {}
    await nextTick()
    expect(v.reannounce).toHaveBeenCalledTimes(1)
  })

  it('works out a DM\'s room the way the server names it', async () => {
    await joinedCall('zed', 'dm')
    await serverSays('dm:me_zed', ['zed'])
    expect(v.reannounce).toHaveBeenCalledTimes(1)
  })

  it('does not ask again while the answer is on its way', async () => {
    await joinedCall()
    await serverSays('voice:c1', ['a'])
    await serverSays('voice:c1', ['a', 'b'])
    expect(v.reannounce).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(SEAT_RETRY_MS)
    await serverSays('voice:c1', ['b'])
    expect(v.reannounce).toHaveBeenCalledTimes(2)
  })

  it('checks on its own every so often, for a list that never changes', async () => {
    sock.activeCalls.value = { 'voice:c1': ['someone-else'] }
    await joinedCall()
    // The list was already like this when the call went live: no change for
    // the watcher to see.
    expect(v.reannounce).not.toHaveBeenCalled()

    vi.advanceTimersByTime(SEAT_CHECK_MS)
    expect(v.reannounce).toHaveBeenCalledTimes(1)
  })
})

describe('nothing to ask', () => {
  it('while the list has it', async () => {
    inCall()
    await serverSays('voice:c1', ['me', 'someone-else'])
    vi.advanceTimersByTime(SEAT_CHECK_MS * 3)
    expect(v.reannounce).not.toHaveBeenCalled()
  })

  it('outside a call', async () => {
    await serverSays('voice:c1', ['someone-else'])
    vi.advanceTimersByTime(SEAT_CHECK_MS * 2)
    expect(v.reannounce).not.toHaveBeenCalled()
  })

  it('while the call is still joining or rejoining the media server', async () => {
    v.voice.activeConvId = 'c1'
    v.voice.activeKind = 'channel'
    v.voice.connected = false
    await serverSays('voice:c1', ['someone-else'])
    vi.advanceTimersByTime(SEAT_CHECK_MS * 2)
    expect(v.reannounce).not.toHaveBeenCalled()
  })

  it('while its own connection to the server is down: the reconnect asks', async () => {
    inCall()
    sock.connected.value = false
    await serverSays('voice:c1', ['someone-else'])
    vi.advanceTimersByTime(SEAT_CHECK_MS * 2)
    expect(v.reannounce).not.toHaveBeenCalled()
  })

  it('about some other room', async () => {
    inCall()
    await serverSays('voice:c1', ['me'])
    await serverSays('voice:c2', ['someone-else'])
    expect(v.reannounce).not.toHaveBeenCalled()
  })

  it('once stopped', async () => {
    stop()
    inCall()
    await serverSays('voice:c1', ['someone-else'])
    vi.advanceTimersByTime(SEAT_CHECK_MS * 2)
    expect(v.reannounce).not.toHaveBeenCalled()
    stop = installVoiceSeatWatch()
  })
})

/**
 * The connection to the server gives up after about a minute of failed tries
 * and waits for "Try again". Somebody in a call is still in it — LiveKit is a
 * separate connection — but with no connection to the server they can neither
 * be listed nor hear who comes and goes. While a call is live, a connection
 * that gave up is asked to try again.
 */
describe('a connection that gave up during a call', () => {
  it('is asked to try again while the call is live', async () => {
    inCall()
    sock.connected.value = false
    sock.connState.value = 'offline'
    vi.advanceTimersByTime(SEAT_CHECK_MS)
    expect(sock.retry).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(SEAT_CHECK_MS)
    expect(sock.retry).toHaveBeenCalledTimes(2)
  })

  it('is left alone while it is still trying on its own', async () => {
    inCall()
    sock.connected.value = false
    sock.connState.value = 'connecting'
    vi.advanceTimersByTime(SEAT_CHECK_MS * 3)
    expect(sock.retry).not.toHaveBeenCalled()
  })

  it('is left alone outside a call: "Try again" is the person\'s choice then', async () => {
    sock.connected.value = false
    sock.connState.value = 'offline'
    vi.advanceTimersByTime(SEAT_CHECK_MS * 3)
    expect(sock.retry).not.toHaveBeenCalled()
  })
})
