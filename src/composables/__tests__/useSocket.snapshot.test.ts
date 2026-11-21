/**
 * After a reconnect the page's picture of every call is the server's, whole.
 *
 * `call:state` only says what changed, and the catch-up the server sends on
 * connect only names occupied rooms. So a call that ended while this page's
 * connection was down was never heard to end: its occupants stayed in the
 * voice channel list, and a DM or group call stayed "in progress", until the
 * page was reloaded. The Android page forgets its calls before it wakes from
 * a rest for exactly this reason; an ordinary reconnect did nothing of the
 * kind.
 *
 * The server now follows the catch-up with `call:snapshot`, every live call
 * this connection may see, and the page replaces what it knew with it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

class FakeSocket {
  connected = false
  handlers: Record<string, ((...a: any[]) => void)[]> = {}
  io = { on() { return this }, removeAllListeners() { return this } }
  on(ev: string, fn: (...a: any[]) => void) { (this.handlers[ev] ||= []).push(fn); return this }
  emit() { return this }
  connect() { return this }
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

const { useSocket, activeCalls, voiceStates, voiceRoomServers } = await import('../useSocket')

const live = () => {
  made.length = 0
  useSocket().disconnect()
  useSocket().connect()
  return made[0]
}

const MUTED = { muted: true, deafened: false, sharing: false }

describe('call:snapshot', () => {
  beforeEach(() => {
    activeCalls.value = {}
    voiceStates.value = {}
    voiceRoomServers.value = {}
  })

  it('drops every call that ended while the connection was down', () => {
    const sock = live()
    activeCalls.value = { 'voice:c1': ['u1'], 'dm:a_b': ['a'], 'group:g1': ['u3'] }
    voiceStates.value = { 'voice:c1': { u1: MUTED } }
    voiceRoomServers.value = { 'voice:c1': 's1' }

    sock.fire('call:snapshot', { calls: [{ room: 'group:g1', userIds: ['u3'] }] })

    expect(activeCalls.value).toEqual({ 'group:g1': ['u3'] })
    expect(voiceStates.value).toEqual({})
    expect(voiceRoomServers.value).toEqual({})
  })

  it('takes occupants, state and server from the snapshot', () => {
    const sock = live()
    activeCalls.value = { 'voice:c1': ['gone'] }

    sock.fire('call:snapshot', {
      calls: [{ room: 'voice:c1', userIds: ['u1', 'u2'], serverId: 's1', states: { u1: MUTED } }],
    })

    expect(activeCalls.value).toEqual({ 'voice:c1': ['u1', 'u2'] })
    expect(voiceStates.value).toEqual({ 'voice:c1': { u1: MUTED } })
    expect(voiceRoomServers.value).toEqual({ 'voice:c1': 's1' })
  })

  it('keeps what it knew of a live room\'s server when the snapshot does not say', () => {
    // The same rule call:state follows: the server leaves the field out when
    // it has not learnt the channel's server yet, and silence is not a correction.
    const sock = live()
    activeCalls.value = { 'voice:c1': ['u1'] }
    voiceRoomServers.value = { 'voice:c1': 's1', 'voice:c9': 's2' }

    sock.fire('call:snapshot', { calls: [{ room: 'voice:c1', userIds: ['u1'] }] })

    expect(voiceRoomServers.value).toEqual({ 'voice:c1': 's1' })
  })

  it('clears everything when no call is live', () => {
    const sock = live()
    activeCalls.value = { 'voice:c1': ['u1'], 'dm:a_b': ['a'] }
    voiceStates.value = { 'voice:c1': { u1: MUTED } }

    sock.fire('call:snapshot', { calls: [] })

    expect(activeCalls.value).toEqual({})
    expect(voiceStates.value).toEqual({})
  })

  it('ignores a malformed snapshot rather than wiping a good picture', () => {
    const sock = live()
    activeCalls.value = { 'voice:c1': ['u1'] }

    sock.fire('call:snapshot', { calls: 'nonsense' })
    sock.fire('call:snapshot', null)

    expect(activeCalls.value).toEqual({ 'voice:c1': ['u1'] })
  })
})
