/**
 * The "Reconnecting… forever" loop.
 *
 * Reported from the running app: the connection strip appears and never goes
 * away, even though messages still flow. The cause was not a connection that
 * never succeeded — it was a dead one still shouting.
 *
 * `connect()` guarded on `if (_socket?.connected) return`. A socket that
 * existed but was mid-reconnect failed that test, so the function fell through
 * and REPLACED it — abandoning the old one with every listener still attached.
 * The orphan kept retrying, kept firing `connect_error`, and `connect_error`
 * sets `connState` back to 'connecting'. The healthy new socket would connect,
 * set 'connected', and be stomped a moment later by a ghost nothing referenced.
 *
 * These tests drive a fake socket.io so the lifecycle is observable without a
 * server: what matters is that no abandoned socket is ever left holding
 * listeners.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

/** A stand-in for a socket.io client that records how it was disposed of. */
class FakeSocket {
  connected = false
  disconnected = false
  listenersRemoved = false
  handlers: Record<string, ((...a: any[]) => void)[]> = {}
  io = {
    managerHandlers: {} as Record<string, ((...a: any[]) => void)[]>,
    listenersRemoved: false,
    on(ev: string, fn: (...a: any[]) => void) {
      (this.managerHandlers[ev] ||= []).push(fn); return this
    },
    removeAllListeners() { this.managerHandlers = {}; this.listenersRemoved = true; return this },
  }
  on(ev: string, fn: (...a: any[]) => void) { (this.handlers[ev] ||= []).push(fn); return this }
  emit() { return this }
  connect() { return this }
  removeAllListeners() { this.handlers = {}; this.listenersRemoved = true; return this }
  disconnect() { this.disconnected = true; this.connected = false; return this }
  /** Drive a server-side event into whatever handlers are still attached. */
  fire(ev: string, ...args: any[]) { (this.handlers[ev] || []).forEach(h => h(...args)) }
}

const made: FakeSocket[] = []
vi.mock('socket.io-client', () => ({
  io: () => { const s = new FakeSocket(); made.push(s); return s },
  Socket: class {},
}))
// usePresence reads localStorage at module load, which the node test
// environment does not have. It has nothing to do with the connection
// lifecycle under test — same stub the voiceRoomName test uses.
vi.mock('../usePresence', () => ({ applySelfPresence: () => {} }))

const { useSocket, getSocket } = await import('../useSocket')

describe('useSocket connection lifecycle', () => {
  beforeEach(() => {
    made.length = 0
    useSocket().disconnect()
  })

  it('does not create a second socket when one is already connected', () => {
    const s = useSocket()
    s.connect()
    made[0].connected = true
    made[0].fire('connect')
    s.connect()
    expect(made).toHaveLength(1)
  })

  it('tears the old socket down before replacing a mid-reconnect one', () => {
    const s = useSocket()
    s.connect()
    const first = made[0]
    // Not connected — exactly the state the old guard let fall through.
    first.connected = false

    s.connect()

    expect(made).toHaveLength(2)
    expect(first.listenersRemoved).toBe(true)
    expect(first.io.listenersRemoved).toBe(true)
    expect(first.disconnected).toBe(true)
  })

  it('an abandoned socket can no longer drag connState back to connecting', () => {
    const s = useSocket()
    s.connect()
    const orphan = made[0]
    orphan.connected = false

    s.connect()                 // replaces it
    const live = made[1]
    live.connected = true
    live.fire('connect')
    expect(s.connState.value).toBe('connected')

    // The ghost keeps retrying in the background. Before the fix this set
    // connState back to 'connecting' and the banner never went away.
    orphan.fire('connect_error', new Error('still flailing'))

    expect(s.connState.value).toBe('connected')
  })

  it('disconnect() leaves nothing attached and nothing to reach', () => {
    const s = useSocket()
    s.connect()
    const only = made[0]
    only.connected = true
    only.fire('connect')

    s.disconnect()

    expect(only.listenersRemoved).toBe(true)
    expect(only.disconnected).toBe(true)
    expect(getSocket()).toBeNull()
    expect(s.connected.value).toBe(false)
  })

  it("a deliberate teardown does not leave the banner up", () => {
    const s = useSocket()
    s.connect()
    made[0].connected = true
    made[0].fire('connect')
    s.disconnect()
    // Whatever it reads, it must not be a state the strip renders as an error
    // the user can act on — there is no connection being attempted.
    expect(s.connState.value).not.toBe('offline')
  })

  it('binds the OS network listeners once, not once per connect', () => {
    // The node test environment has no `window`, and installNetworkWatch
    // guards on exactly that — so give it one. A bare object with the two
    // methods is enough; nothing here touches the DOM.
    const added: string[] = []
    ;(globalThis as any).window = {
      addEventListener: (ev: string) => { added.push(ev) },
      removeEventListener: () => {},
    }
    try {
      const s = useSocket()
      s.connect(); s.connect(); s.connect()
      // Three connects, one pair of listeners. Before the fix this was six.
      expect(added.filter(e => e === 'online')).toHaveLength(1)
      expect(added.filter(e => e === 'offline')).toHaveLength(1)
    } finally {
      delete (globalThis as any).window
    }
  })
})
