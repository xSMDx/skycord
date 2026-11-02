/**
 * `call:state` says when the call started.
 *
 * The Android app rings for an incoming call, but only for a FRESH one: a phone
 * that reconnects while a call is already under way must not ring for it. It
 * can only tell the two apart if the server says when the call began, so every
 * `call:state` for an occupied room carries `startedAt` (epoch ms): the moment
 * the room went from empty to occupied, unchanged while it stays occupied.
 *
 * A dropped socket is not a hang-up (see CALL_END_GRACE_MS in chatSocket), so a
 * call that blips and comes straight back is the SAME call and keeps its clock.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  connectDb, disconnectDb, resetDb, register,
  withSocketServer, connectSocket, connectSocketRaw, connectBackground, nextEvent,
} from './helpers'
import { cancelAllCallEnds, isInCall } from '../sockets/chatSocket'
import { dmConvId } from '../controllers/messagesController'

// Shortened so a test can see a grace period expire; read per schedule by the
// server, so setting it here needs no ordering against the imports.
const GRACE_MS = 1200
process.env.CALL_END_GRACE_MS = String(GRACE_MS)

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => {
  open.splice(0).forEach(s => s.disconnect())
  // Those disconnects schedule call ends on the server. Let the handlers run,
  // then drop them, so a timer cannot write into the next test's database.
  await new Promise(r => setTimeout(r, 50))
  cancelAllCallEnds()
  await resetDb()
})

const track = (s: ClientSocket) => { open.push(s); return s }
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms))

type CallState = { room: string; userIds: string[]; startedAt?: number }

/**
 * The next `call:state` that satisfies `want`. A DM broadcast reaches BOTH
 * people's sockets, and the two copies of one event do not arrive together, so
 * "the next call:state on this socket" can be the previous step's stragglers.
 * Naming who should be in the room makes the wait unambiguous.
 */
const stateWhere = (s: ClientSocket, want: (p: CallState) => boolean, ms = 3000): Promise<CallState> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => { s.off('call:state', on); reject(new Error(`no matching call:state within ${ms}ms`)) }, ms)
    const on = (p: CallState) => { if (want(p)) { clearTimeout(timer); s.off('call:state', on); resolve(p) } }
    s.on('call:state', on)
  })
const exactly = (...ids: string[]) => (p: CallState) =>
  p.userIds.length === ids.length && ids.every(id => p.userIds.includes(id))

describe('call:state startedAt', () => {
  it('startedAt is set when a DM call starts', async () => {
    const a = await register(), b = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const seen = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    const payload = await seen

    expect(payload.userIds).toEqual([a.id])
    expect(typeof payload.startedAt).toBe('number')
    expect(Math.abs(Date.now() - payload.startedAt)).toBeLessThan(2000)
  })

  it('a second person joining keeps the same startedAt', async () => {
    const a = await register(), b = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const first = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    const started = (await first).startedAt
    expect(typeof started).toBe('number')

    // Time must pass, or a fresh Date.now() would equal the old one by luck.
    await settle(30)
    const second = stateWhere(aSock, exactly(a.id, b.id))
    bSock.emit('call:join', { conversationId: a.id, kind: 'dm' })
    const payload = await second

    expect(payload.startedAt).toBe(started)
  })

  it('a call after the room emptied gets a new startedAt', async () => {
    const a = await register(), b = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const first = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    const before = (await first).startedAt
    expect(typeof before).toBe('number')

    const bIn = stateWhere(aSock, exactly(a.id, b.id))
    bSock.emit('call:join', { conversationId: a.id, kind: 'dm' })
    await bIn

    // Both hang up. call:leave is a deliberate hang-up, so the room is released
    // at once rather than after a grace period.
    const aGone = stateWhere(bSock, exactly(b.id))
    aSock.emit('call:leave', { conversationId: b.id, kind: 'dm' })
    await aGone
    const empty = stateWhere(aSock, exactly())
    bSock.emit('call:leave', { conversationId: a.id, kind: 'dm' })
    const emptied = await empty
    // An empty room has no start time to report.
    expect(emptied.startedAt).toBeUndefined()

    await settle(30)
    const again = stateWhere(bSock, exactly(a.id))
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    const payload = await again

    expect(payload.startedAt).toBeGreaterThan(before)
  })

  it('the connect-time catch-up carries startedAt', async () => {
    const a = await register(), b = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))

    const aSelf = nextEvent(aSock, 'call:state')
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    const live = await aSelf
    expect(typeof live.startedAt).toBe('number')

    // Raw: the catch-up replays from inside the connect handler, so waiting
    // until setup finishes would mean waiting past the thing under test.
    const bSock = track(await connectSocketRaw(sockets.url, b.token))
    const payload = await nextEvent(bSock, 'call:state')

    expect(payload.userIds).toEqual([a.id])
    expect(payload.startedAt).toBe(live.startedAt)
  })

  it('a call that blips and comes back inside the grace period keeps its startedAt', async () => {
    // This test needs the room to still be inside its grace period when a
    // reconnect finishes, and the file-wide GRACE_MS leaves under a second of
    // slack for that (connectSocket's 350 ms settle, the 60 ms wait and the
    // rejoin round trip all come out of it) — a slow CI box would lapse the
    // call and fail the test for no real reason. Read per schedule, so a longer
    // value set here covers the disconnect below; restored in the finally so
    // the test that needs it short still sees it short.
    const savedGrace = process.env.CALL_END_GRACE_MS
    process.env.CALL_END_GRACE_MS = '10000'
    try {
      const a = await register(), b = await register()
      const aSock = track(await connectSocket(sockets.url, a.token))
      const bSock = track(await connectSocket(sockets.url, b.token))

      const first = nextEvent(bSock, 'call:state')
      aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
      const started = (await first).startedAt
      expect(typeof started).toBe('number')

      // The blip: a's socket drops, occupancy goes at once, the call is not over.
      const cleared = nextEvent(bSock, 'call:state')
      aSock.disconnect()
      const emptied = await cleared
      expect(emptied.userIds).toEqual([])
      // The room still has a start time on file (that is what the rejoin below
      // keeps), but an empty room has none to report. Pins the
      // `userIds.length > 0` guard in callStatePayload.
      expect(emptied.startedAt).toBeUndefined()

      // Long enough that a fresh Date.now() could not be mistaken for the old one.
      await settle(60)
      const aAgain = track(await connectSocket(sockets.url, a.token))
      const self = nextEvent(aAgain, 'call:state')
      aAgain.emit('call:rejoin', { conversationId: b.id, kind: 'dm' })
      const payload = await self

      expect(payload.userIds).toEqual([a.id])
      expect(payload.startedAt).toBe(started)
    } finally {
      if (savedGrace === undefined) delete process.env.CALL_END_GRACE_MS
      else process.env.CALL_END_GRACE_MS = savedGrace
    }
  })

  it('once the grace period lapses the next call starts a new clock', async () => {
    const a = await register(), b = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const first = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    const before = (await first).startedAt

    const cleared = nextEvent(bSock, 'call:state')
    aSock.disconnect()
    await cleared
    // Nobody came back: the call is over, and its start time with it.
    await settle(GRACE_MS + 400)

    const aAgain = track(await connectSocket(sockets.url, a.token))
    const again = stateWhere(bSock, exactly(a.id))
    aAgain.emit('call:join', { conversationId: b.id, kind: 'dm' })
    const payload = await again

    expect(payload.startedAt).toBeGreaterThan(before)
  })
})

describe('a background socket and calls', () => {
  const room = (x: string, y: string) => `dm:${dmConvId(x, y)}`

  it('a background socket cannot join a call', async () => {
    const a = await register(), b = await register()
    const bSock = track(await connectSocket(sockets.url, b.token))
    const aBackground = track(await connectBackground(sockets.url, a.token))

    const listing: string[][] = []
    bSock.on('call:state', (p: { userIds: string[] }) => { listing.push(p.userIds) })

    aBackground.emit('call:join', { conversationId: b.id, kind: 'dm' })
    await settle(600)

    // Listing the user in a call while they look offline is the whole fault.
    expect(listing.flat()).not.toContain(a.id)
    expect(isInCall(room(a.id, b.id), a.id)).toBe(false)

    // The control: the same event from a normal socket does list them, so the
    // silence above is the guard working and not a listener that never worked.
    const aNormal = track(await connectSocket(sockets.url, a.token))
    const seen = nextEvent(bSock, 'call:state')
    aNormal.emit('call:join', { conversationId: b.id, kind: 'dm' })
    expect((await seen).userIds).toEqual([a.id])
  })

  it('a background socket cannot rejoin a call either', async () => {
    const a = await register(), b = await register()
    const bSock = track(await connectSocket(sockets.url, b.token))
    const aBackground = track(await connectBackground(sockets.url, a.token))

    const listing: string[][] = []
    bSock.on('call:state', (p: { userIds: string[] }) => { listing.push(p.userIds) })
    let own = 0
    aBackground.on('call:state', () => { own += 1 })

    aBackground.emit('call:rejoin', { conversationId: b.id, kind: 'dm' })
    await settle(600)

    expect(listing.flat()).not.toContain(a.id)
    expect(own).toBe(0)
    expect(isInCall(room(a.id, b.id), a.id)).toBe(false)
  })
})
