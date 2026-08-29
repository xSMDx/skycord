/**
 * "Reconnecting…" that never resolves, second cause.
 *
 * The first one (see useSocket.reconnect.test.ts) was an orphaned socket still
 * shouting. This one is the opposite: a socket that has given up, reported as
 * though it were still trying.
 *
 * Socket.IO v4 sets `socket.active` false when the SERVER rejected the
 * handshake — our auth middleware calling `next(new Error('Invalid token'))` —
 * rather than when the server could not be reached. After a rejection nothing
 * retries, and `reconnect_failed` never fires either, because no reconnection
 * was ever scheduled. `connect_error` set connState to 'connecting'
 * unconditionally, so the banner spun forever over a dead socket, and since
 * ConnectionBanner only offers "Try again" on 'offline', there was no way out
 * of it but reloading the page.
 *
 * The trigger is ordinary: access tokens last 15 minutes and are renewed by a
 * 14-minute setTimeout, which does not fire while the machine sleeps or the tab
 * sits in the background — which is exactly when sockets drop. Waking after 20
 * minutes reconnects with a token that expired mid-sleep.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'

class FakeSocket {
  connected = false
  /** Socket.IO's own flag: false once it has stopped retrying. */
  active = true
  connectCalls = 0
  handlers: Record<string, ((...a: any[]) => void)[]> = {}
  io = {
    on(_ev: string, _fn: (...a: any[]) => void) { return this },
    removeAllListeners() { return this },
  }
  on(ev: string, fn: (...a: any[]) => void) { (this.handlers[ev] ||= []).push(fn); return this }
  emit() { return this }
  connect() { this.connectCalls++; return this }
  removeAllListeners() { this.handlers = {}; return this }
  disconnect() { this.connected = false; return this }
  fire(ev: string, ...args: any[]) { (this.handlers[ev] || []).forEach(h => h(...args)) }
}

const made: FakeSocket[] = []
vi.mock('socket.io-client', () => ({
  io: () => { const s = new FakeSocket(); made.push(s); return s },
  Socket: class {},
}))
vi.mock('../usePresence', () => ({ applySelfPresence: () => {} }))

const silentRefresh = vi.fn(async () => true)
vi.mock('../useAuth', () => ({
  silentRefresh: (...a: any[]) => silentRefresh(...(a as [])),
  useAuth: () => ({ accessToken: ref('tok'), user: ref({ id: 'u1' }) }),
}))

const { useSocket } = await import('../useSocket')

/** Let the silentRefresh promise settle. */
const tick = () => new Promise(r => setTimeout(r, 0))

describe('useSocket auth rejection', () => {
  beforeEach(() => {
    made.length = 0
    silentRefresh.mockClear()
    silentRefresh.mockImplementation(async () => true)
    useSocket().disconnect()
  })

  it('a rejected handshake refreshes the token and retries once', async () => {
    const s = useSocket()
    s.connect()
    const sock = made[0]
    sock.active = false          // server said no; socket.io will not retry

    sock.fire('connect_error', new Error('Invalid token'))
    await tick()

    expect(silentRefresh).toHaveBeenCalledTimes(1)
    expect(sock.connectCalls).toBe(1)
    expect(s.connState.value).toBe('connecting')
  })

  it('goes offline — not "reconnecting" — when the refresh fails', async () => {
    silentRefresh.mockImplementation(async () => false)
    const s = useSocket()
    s.connect()
    const sock = made[0]
    sock.active = false

    sock.fire('connect_error', new Error('Invalid token'))
    await tick()

    // The whole point: 'connecting' here would spin forever AND hide the
    // "Try again" button, which ConnectionBanner only renders on 'offline'.
    expect(s.connState.value).toBe('offline')
  })

  it('does not refresh in a loop when a fresh token is also rejected', async () => {
    const s = useSocket()
    s.connect()
    const sock = made[0]
    sock.active = false

    sock.fire('connect_error', new Error('Invalid token'))
    await tick()
    sock.fire('connect_error', new Error('Invalid token'))
    await tick()

    expect(silentRefresh).toHaveBeenCalledTimes(1)
    expect(s.connState.value).toBe('offline')
  })

  it('still reports "connecting" while socket.io is genuinely retrying', async () => {
    const s = useSocket()
    s.connect()
    const sock = made[0]
    sock.active = true           // unreachable server, retry in flight

    sock.fire('connect_error', new Error('xhr poll error'))
    await tick()

    expect(silentRefresh).not.toHaveBeenCalled()
    expect(s.connState.value).toBe('connecting')
  })

  it('a successful connect re-arms the one-shot refresh', async () => {
    const s = useSocket()
    s.connect()
    const sock = made[0]

    sock.active = false
    sock.fire('connect_error', new Error('Invalid token'))
    await tick()
    expect(silentRefresh).toHaveBeenCalledTimes(1)

    sock.connected = true
    sock.fire('connect')

    // A later drop, hours on, is a new problem and gets its own refresh.
    sock.active = false
    sock.fire('connect_error', new Error('Invalid token'))
    await tick()
    expect(silentRefresh).toHaveBeenCalledTimes(2)
  })
})
