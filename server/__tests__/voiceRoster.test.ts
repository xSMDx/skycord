/**
 * The voice list follows the media server when no connection can speak for
 * somebody.
 *
 * Seats are taken and given back over the socket, and that covers every page
 * that can talk to the server. It cannot cover one that cannot: a page whose
 * connection to the server is down for longer than a blip while LiveKit — a
 * separate connection to a separate service — carries on, a page frozen in a
 * background tab, a page that joined while its socket was already gone. Those
 * people are in the call, heard by everyone and a tile on every stage, and
 * the list said otherwise until they reconnected or left.
 *
 * So the server asks LiveKit who is in each live room, and seats anybody it
 * reports whom no connection has seated. Rules this keeps:
 *
 * - **LiveKit's word only ever stands in for a connection.** A seat a live
 *   connection holds is never taken away because LiveKit did not list the
 *   person: they may be between two of its reconnects.
 * - **No answer is no information.** A media server that cannot be reached, or
 *   errors, changes nothing in either direction.
 * - **People only.** The music service is in the room as a participant.
 * - **Nobody is seated who could not join.** An identity LiveKit lists is
 *   checked like a join.
 * - **A seat that dropped is checked before it goes.** When somebody's last
 *   connection is lost, LiveKit is asked first, so a person who is still in the
 *   call never flickers out of the list while their page reconnects.
 * - **A call is not declared over while its room has people in it.**
 * - **A hang-up is believed.** LiveKit can still list somebody for a moment
 *   after they leave, and that must not seat them again.
 *
 * The media server is faked here: tests set what it answers per room.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, befriend, auth,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'
import {
  cancelAllCallEnds, isInCall, callEndPending, setRosterProbe, sweepCallRosters,
} from '../sockets/chatSocket'
import { dmConvId } from '../controllers/messagesController'

const GRACE_MS = 1200
process.env.CALL_END_GRACE_MS = String(GRACE_MS)
// The tests sweep by hand, so nothing sweeps behind their backs.
process.env.CALL_ROSTER_SWEEP_MS = '0'

/** What the fake media server answers, per room. Absent: an empty room. */
const lk = new Map<string, string[] | null>()
let asked: string[] = []

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => {
  await connectDb()
  sockets = await withSocketServer()
  setRosterProbe(async room => { asked.push(room); return lk.has(room) ? lk.get(room)! : [] })
})
afterAll(async () => { setRosterProbe(null); await sockets.close(); await disconnectDb() })
beforeEach(async () => {
  open.splice(0).forEach(s => s.disconnect())
  await new Promise(r => setTimeout(r, 50))
  cancelAllCallEnds()
  lk.clear()
  asked = []
  await resetDb()
})

const track = (s: ClientSocket) => { open.push(s); return s }
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms))
const pastGrace = () => new Promise(r => setTimeout(r, GRACE_MS + 400))

const seed = async (a: TestUser, b: TestUser) => {
  const { server, channels } = (await app().post('/servers').set(auth(a)).send({ name: 'EA' })).body
  await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
  const voice = channels.find((c: any) => c.type === 'voice')
  return { voice, room: `voice:${voice.id}` }
}

const record = (s: ClientSocket, room: string) => {
  const seen: { userIds: string[] }[] = []
  s.on('call:state', (p: any) => { if (p.room === room) seen.push(p) })
  return seen
}

describe('a person whose connection is gone but who is still in the call', () => {
  it('stays listed, without a gap, while LiveKit still has them', async () => {
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await settle()

    lk.set(room, [a.id])
    const seen = record(bSock, room)
    aSock.disconnect()
    await settle()

    expect(isInCall(room, a.id)).toBe(true)
    expect(seen.every(p => p.userIds.includes(a.id))).toBe(true)
  })

  it('goes once LiveKit no longer has them either', async () => {
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await settle()
    lk.set(room, [a.id])
    aSock.disconnect()
    await settle()

    lk.set(room, [])
    const gone = nextEvent(bSock, 'call:state')
    await sweepCallRosters()
    expect((await gone).userIds).toEqual([])
    expect(isInCall(room, a.id)).toBe(false)
  })

  it('is put back by the next sweep if their connection went when LiveKit could not answer', async () => {
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await settle()

    lk.set(room, null)   // unreachable: the seat goes, as it always did
    aSock.disconnect()
    await settle()
    expect(isInCall(room, a.id)).toBe(false)

    lk.set(room, [a.id])
    const back = nextEvent(bSock, 'call:state')
    await sweepCallRosters()
    expect((await back).userIds).toEqual([a.id])
  })

  it('is listed after joining with no connection to the server at all', async () => {
    // The token comes over HTTP, so a page whose socket is down can still get
    // into the call. The sweep watches a room for a while after a token for it.
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)
    const bSock = track(await connectSocket(sockets.url, b.token))

    const tok = await app().post('/voice/token').set(auth(a)).send({ conversationId: voice.id, kind: 'channel' })
    expect(tok.status).toBe(200)
    lk.set(room, [a.id])
    const seen = nextEvent(bSock, 'call:state')
    await sweepCallRosters()
    expect((await seen).userIds).toEqual([a.id])
  })
})

describe('what LiveKit says is never more than it may say', () => {
  it('never takes out somebody a live connection still holds a seat for', async () => {
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)
    const aSock = track(await connectSocket(sockets.url, a.token))
    track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await settle()

    lk.set(room, [])   // between two of LiveKit's own reconnects
    await sweepCallRosters()
    expect(isInCall(room, a.id)).toBe(true)
  })

  it('changes nothing when LiveKit cannot be asked', async () => {
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)
    const aSock = track(await connectSocket(sockets.url, a.token))
    track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await settle()
    lk.set(room, [a.id])
    aSock.disconnect()
    await settle()
    expect(isInCall(room, a.id)).toBe(true)

    lk.set(room, null)
    await sweepCallRosters()
    expect(isInCall(room, a.id)).toBe(true)
  })

  it('does not count the music service as a person', async () => {
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)
    const bSock = track(await connectSocket(sockets.url, b.token))
    bSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await settle()

    lk.set(room, [b.id, 'svc:music'])
    await sweepCallRosters()
    expect(isInCall(room, 'svc:music')).toBe(false)
  })

  it('seats nobody LiveKit lists who could not have joined', async () => {
    const a = await register(), b = await register(), outsider = await register()
    const { voice, room } = await seed(a, b)
    const bSock = track(await connectSocket(sockets.url, b.token))
    bSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await settle()

    lk.set(room, [b.id, outsider.id, 'not-an-id'])
    await sweepCallRosters()
    expect(isInCall(room, outsider.id)).toBe(false)
    expect(isInCall(room, 'not-an-id')).toBe(false)
  })

  it('believes a hang-up over a LiveKit that still lists the person for a moment', async () => {
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)
    const aSock = track(await connectSocket(sockets.url, a.token))
    track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await settle()

    lk.set(room, [a.id])   // LiveKit has not caught up with the leave yet
    aSock.emit('call:leave', { conversationId: voice.id, kind: 'channel' })
    await settle()
    await sweepCallRosters()
    expect(isInCall(room, a.id)).toBe(false)
  })

  it('asks about nothing once no call is live, none is ending and no token is fresh', async () => {
    // What earlier tests left: LiveKit says every room is empty now, and the
    // ends that schedules are dropped as beforeEach drops them.
    await sweepCallRosters()
    cancelAllCallEnds()
    // Past the minute a token keeps its room watched.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 61_000)
    try {
      asked = []
      await sweepCallRosters()
      expect(asked).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a call is not declared over while its room has people in it', () => {
  it('writes no "Call ended" while the caller is still in the DM room on LiveKit', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)
    const room = `dm:${dmConvId(a.id, b.id)}`
    const aSock = track(await connectSocket(sockets.url, a.token))
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    await settle()

    lk.set(room, null)   // could not be asked when the connection went
    aSock.disconnect()
    await settle()
    expect(callEndPending(room)).toBe(true)

    lk.set(room, [a.id])   // ...but can by the time the grace period is up
    await pastGrace()
    expect(await Message.countDocuments({ content: 'Call ended' })).toBe(0)
    expect(isInCall(room, a.id)).toBe(true)
  })

  it('still ends it once LiveKit\'s room is empty too', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)
    const room = `dm:${dmConvId(a.id, b.id)}`
    const aSock = track(await connectSocket(sockets.url, a.token))
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    await settle()

    lk.set(room, [])
    aSock.disconnect()
    await pastGrace()
    expect(await Message.countDocuments({ content: 'Call ended' })).toBe(1)
  })

  it('a device that was taken over does not end a DM call before the other device joins', async () => {
    // The PC leaves the moment the phone takes the call over, but the phone's
    // call:join only goes out once its microphone is up.
    const a = await register(), b = await register()
    await befriend(a, b)
    const room = `dm:${dmConvId(a.id, b.id)}`
    const pc = track(await connectSocket(sockets.url, a.token))
    const phone = track(await connectSocket(sockets.url, a.token))
    pc.emit('call:join', { conversationId: b.id, kind: 'dm' })
    await settle()
    const started = await Message.countDocuments({ content: { $regex: 'started a call' } })

    lk.set(room, [a.id])   // the phone is in the LiveKit room already
    pc.emit('call:leave', { conversationId: b.id, kind: 'dm', reason: 'taken-over' })
    await settle(GRACE_MS / 2)
    phone.emit('call:join', { conversationId: b.id, kind: 'dm' })
    await pastGrace()

    expect(await Message.countDocuments({ content: 'Call ended' })).toBe(0)
    expect(await Message.countDocuments({ content: { $regex: 'started a call' } })).toBe(started)
    expect(isInCall(room, a.id)).toBe(true)
  })
})
