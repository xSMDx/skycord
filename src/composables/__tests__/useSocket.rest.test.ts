/**
 * Letting the page's connection go while the Android app is in the background
 * (see backgroundSocket.ts), and taking it up again.
 *
 * The strip must not report this as trouble: nobody is looking while the app is
 * away, and when it comes back the connection returns in a moment, so a
 * "Reconnecting…" flash followed by "Back online" would announce a fault that
 * never happened.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

class FakeSocket {
  connected = false
  disconnected = false
  listenersRemoved = false
  handlers: Record<string, ((...a: any[]) => void)[]> = {}
  io = {
    on() { return this },
    removeAllListeners() { return this },
  }
  on(ev: string, fn: (...a: any[]) => void) { (this.handlers[ev] ||= []).push(fn); return this }
  emit() { return this }
  connect() { return this }
  removeAllListeners() { this.handlers = {}; this.listenersRemoved = true; return this }
  disconnect() { this.disconnected = true; this.connected = false; return this }
  fire(ev: string, ...args: any[]) { (this.handlers[ev] || []).forEach(h => h(...args)) }
}

const made: FakeSocket[] = []
vi.mock('socket.io-client', () => ({
  io: () => { const s = new FakeSocket(); made.push(s); return s },
  Socket: class {},
}))
vi.mock('../usePresence', () => ({ applySelfPresence: () => {} }))

const { useSocket, getSocket } = await import('../useSocket')

const up = (s: FakeSocket) => { s.connected = true; s.fire('connect') }

describe('resting the connection in the background', () => {
  beforeEach(() => {
    made.length = 0
    useSocket().disconnect()
  })

  it('closes the socket and leaves nothing attached to it', () => {
    const s = useSocket()
    s.connect()
    up(made[0])

    s.rest()

    expect(made[0].disconnected).toBe(true)
    expect(made[0].listenersRemoved).toBe(true)
    expect(getSocket()).toBeNull()
    expect(s.connected.value).toBe(false)
  })

  it('leaves the strip alone: a healthy connection stays "connected", not "Reconnecting…"', () => {
    const s = useSocket()
    s.connect()
    up(made[0])
    expect(s.connState.value).toBe('connected')

    s.rest()

    expect(s.connState.value).toBe('connected')
  })

  it('comes back with connect(), on a fresh socket, and the strip never moved', () => {
    const s = useSocket()
    const seen: string[] = []
    s.connect()
    up(made[0])
    s.rest()
    s.connect()
    expect(made).toHaveLength(2)
    seen.push(s.connState.value)
    up(made[1])
    seen.push(s.connState.value)

    expect(seen).toEqual(['connected', 'connected'])
    expect(s.connected.value).toBe(true)
  })

  it('does not let the OS offline or online events paint the strip while resting', () => {
    const handlers: Record<string, () => void> = {}
    ;(globalThis as any).window = {
      addEventListener: (ev: string, fn: () => void) => { handlers[ev] = fn },
      removeEventListener: () => {},
    }
    try {
      const s = useSocket()
      s.connect()
      up(made[0])
      s.rest()

      handlers.offline?.()
      expect(s.connState.value).toBe('connected')
      handlers.online?.()
      expect(s.connState.value).toBe('connected')
    } finally {
      delete (globalThis as any).window
    }
  })

  it('a real disconnect afterwards (logout) resets as it always did', () => {
    const s = useSocket()
    s.connect()
    up(made[0])
    s.rest()
    s.disconnect()
    expect(s.connState.value).toBe('connecting')
    expect(s.connected.value).toBe(false)
  })
})
