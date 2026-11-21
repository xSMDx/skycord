/**
 * Somebody in a call stays in the voice list for as long as one of their
 * connections says they are in it.
 *
 * The bug, as it was reported: on a shaky connection a person stays in the
 * call — audible, a tile on everybody's stage — but drops out of the voice
 * channel's member list, and nothing puts them back.
 *
 * Occupancy was one entry per PERSON, while the things that add and remove it
 * are per CONNECTION. A browser that loses its connection opens a new one and
 * rejoins straight away, but the server only learns the old one is dead when
 * its ping goes unanswered, up to fifteen seconds later. The new connection's
 * rejoin found the person already listed and changed nothing; the old one's
 * disconnect then deleted the only entry there was. The same happened when a
 * second device of the same person left a call the first was still in.
 *
 * The other half is order. The handlers that seat somebody wait on the
 * database before they write, so a leave, a mute or a disconnect sent right
 * behind a join used to be handled before it: a leave did nothing and the join
 * then seated a person who had gone, a mute was dropped as coming from someone
 * not in a call, and a socket that died with its join in flight left a seat
 * that nothing would ever clear.
 *
 * Every test here sends events in the order a real client does, back to back,
 * and only ever reads what the other members would see.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, connectSocketRaw, nextEvent, type TestUser,
} from './helpers'
import { Server } from '../models/Server'
import { Channel } from '../models/Channel'
import { cancelAllCallEnds, isInCall } from '../sockets/chatSocket'

// Short, so a test can outlast it; see voiceChannelPresence.test.ts.
process.env.CALL_END_GRACE_MS = '1200'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => {
  open.splice(0).forEach(s => s.disconnect())
  await new Promise(r => setTimeout(r, 50))
  cancelAllCallEnds()
  await resetDb()
})

const track = (s: ClientSocket) => { open.push(s); return s }

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

/** A server with a member `b`, plus its default voice channel. */
const seed = async (a: TestUser, b: TestUser) => {
  const { server, channels } = await mkServer(a)
  await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
  const voice = channels.find((c: any) => c.type === 'voice')
  return { voice, room: `voice:${voice.id}` }
}

/** Every call:state this socket hears for `room` from now on, in order. */
const record = (s: ClientSocket, room: string) => {
  const seen: { userIds: string[]; states?: Record<string, any> }[] = []
  s.on('call:state', (p: any) => { if (p.room === room) seen.push(p) })
  return seen
}

/** Long enough for the server to finish every handler the last emit started. */
const settle = (ms = 400) => new Promise(r => setTimeout(r, ms))

/** What somebody watching sees now: the last thing they were told, if anything. */
const latest = <T>(seen: T[]): T | undefined => seen[seen.length - 1]

describe('a dropped connection that comes back first', () => {
  it('keeps the person listed when the server notices the old connection only after the rejoin', async () => {
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const joined = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    expect((await joined).userIds).toEqual([a.id])

    // The browser saw its connection die and opened a new one. LiveKit never
    // noticed, so the client is still in the call and says so.
    const aAgain = track(await connectSocket(sockets.url, a.token))
    const answered = nextEvent(aAgain, 'call:state')
    aAgain.emit('call:rejoin', { conversationId: voice.id, kind: 'channel' })
    expect((await answered).userIds).toEqual([a.id])

    // Only now does the server give up on the first connection.
    const seen = record(bSock, room)
    aSock.disconnect()
    await settle()

    expect(isInCall(room, a.id)).toBe(true)
    // Told nothing, or told the truth — never that a left.
    expect(latest(seen)?.userIds ?? [a.id]).toEqual([a.id])
  })

  it('takes them out once the connection that rejoined goes too', async () => {
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    const aAgain = track(await connectSocket(sockets.url, a.token))
    aAgain.emit('call:rejoin', { conversationId: voice.id, kind: 'channel' })
    await settle()
    aSock.disconnect()
    await settle()

    const gone = nextEvent(bSock, 'call:state')
    aAgain.disconnect()
    expect((await gone).userIds).toEqual([])
    expect(isInCall(room, a.id)).toBe(false)
  })
})

describe('the same person on two devices', () => {
  it('stays listed when the device that was taken over leaves the call', async () => {
    // Joining on the phone takes the call over from the PC (LiveKit allows one
    // connection per person and room), and the PC then leaves. Its leave is
    // about the PC, not about the person, who is in the call on the phone.
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)

    const pc = track(await connectSocket(sockets.url, a.token))
    const phone = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    pc.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await settle()
    phone.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await settle()

    const seen = record(bSock, room)
    pc.emit('call:leave', { conversationId: voice.id, kind: 'channel' })
    await settle()

    expect(isInCall(room, a.id)).toBe(true)
    expect(latest(seen)?.userIds ?? [a.id]).toEqual([a.id])
  })

  it('stays listed when the other device closes', async () => {
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)

    const pc = track(await connectSocket(sockets.url, a.token))
    const phone = track(await connectSocket(sockets.url, a.token))
    track(await connectSocket(sockets.url, b.token))
    pc.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await settle()
    phone.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await settle()

    pc.disconnect()
    await settle()

    expect(isInCall(room, a.id)).toBe(true)
  })
})

describe('events sent back to back are handled in the order they were sent', () => {
  it('a leave right behind a join leaves nobody in the call', async () => {
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const seen = record(bSock, room)
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    aSock.emit('call:leave', { conversationId: voice.id, kind: 'channel' })
    await settle()

    expect(isInCall(room, a.id)).toBe(false)
    expect(latest(seen)?.userIds ?? []).toEqual([])
  })

  it('a hang-up right behind a rejoin leaves nobody in the call', async () => {
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await settle()
    aSock.disconnect()
    await settle()

    const aAgain = track(await connectSocket(sockets.url, a.token))
    const seen = record(bSock, room)
    aAgain.emit('call:rejoin', { conversationId: voice.id, kind: 'channel' })
    aAgain.emit('call:leave', { conversationId: voice.id, kind: 'channel' })
    await settle()

    expect(isInCall(room, a.id)).toBe(false)
    expect(latest(seen)?.userIds ?? []).toEqual([])
  })

  it('keeps the mute that was sent with the join', async () => {
    // useVoice sends voice:state the moment the call connects, right behind
    // call:join.
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const seen = record(bSock, room)
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    aSock.emit('voice:state', { muted: true, deafened: false, sharing: false })
    await settle()

    expect(latest(seen)?.userIds).toEqual([a.id])
    expect(latest(seen)?.states?.[a.id]).toEqual({ muted: true, deafened: false, sharing: false })
  })

  it('keeps the mute and deafen that were re-sent with a rejoin', async () => {
    // The dropped connection took the person's state with it, and the client
    // re-sends it right behind call:rejoin.
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await settle()
    aSock.disconnect()
    await settle()

    const aAgain = track(await connectSocket(sockets.url, a.token))
    const seen = record(bSock, room)
    aAgain.emit('call:rejoin', { conversationId: voice.id, kind: 'channel' })
    aAgain.emit('voice:state', { muted: true, deafened: true, sharing: false })
    await settle()

    expect(latest(seen)?.userIds).toEqual([a.id])
    expect(latest(seen)?.states?.[a.id]).toEqual({ muted: true, deafened: true, sharing: false })
  })

  it('a connection that dies while its join is still being checked leaves no seat behind', async () => {
    // Socket.IO already drops events that arrive behind a disconnect in the
    // same burst. The window is a disconnect that lands while a join it did
    // dispatch is waiting on the database — held open here by a slow lookup.
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    track(await connectSocket(sockets.url, b.token))
    const realFindById = Channel.findById.bind(Channel)
    const slow = vi.spyOn(Channel, 'findById').mockImplementation(((id: unknown) => ({
      select: (fields: string) => ({
        lean: async () => {
          await new Promise(r => setTimeout(r, 300))
          return realFindById(id as string).select(fields).lean()
        },
      }),
    })) as unknown as typeof Channel.findById)
    try {
      aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
      await settle(100)   // the join is waiting on the lookup
      aSock.disconnect()
      await settle(600)
    } finally {
      slow.mockRestore()
    }

    expect(isInCall(room, a.id)).toBe(false)
  })
})

describe('a connection that comes back is told the whole picture', () => {
  it('lists every live call it can see, so a call that ended meanwhile can be dropped', async () => {
    // call:state only says what changed, and the catch-up on connect only
    // names occupied rooms. A call that ended while a member's connection was
    // down was never heard to end, and its occupants stayed in that member's
    // voice list. The snapshot names every live call at once, so anything
    // else the client remembers is known to be over.
    const a = await register(), b = await register()
    const { voice, room } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const joined = nextEvent(aSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await joined

    const bLive = track(await connectSocketRaw(sockets.url, b.token))
    const live = await nextEvent(bLive, 'call:snapshot')
    expect(live.calls.map((c: any) => c.room)).toEqual([room])
    expect(live.calls[0].userIds).toEqual([a.id])

    aSock.emit('call:leave', { conversationId: voice.id, kind: 'channel' })
    await settle()

    const bBack = track(await connectSocketRaw(sockets.url, b.token))
    const after = await nextEvent(bBack, 'call:snapshot')
    expect(after.calls).toEqual([])
  })
})
