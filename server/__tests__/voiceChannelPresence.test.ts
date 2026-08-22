/**
 * Voice-channel occupancy: who is sitting in a server's voice channel, and who
 * gets told about it.
 *
 * Two room names are in play and they are deliberately different strings:
 *   - `voice:<channelId>` — the LiveKit room (see roomFor in voiceController)
 *   - `chan:<channelId>`  — the Socket.IO room every server member joined at
 *                           connect for that channel's text traffic
 * Occupancy is broadcast to the SOCKET room, so members who are not in the call
 * still see who is. Conflating the two is the bug these tests exist to catch.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'
import { Conversation } from '../models/Conversation'
import { roomFor } from '../controllers/voiceController'
import { dmConvId } from '../controllers/messagesController'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

// No join endpoint yet — seed membership directly, same pattern as
// channels.test.ts and voiceChannelToken.test.ts.
const joinAsMember = async (sid: string, uid: string) =>
  Server.updateOne({ _id: sid }, { $push: { members: uid } })

/** A server with a member `b`, plus its default voice channel. */
const seed = async (a: TestUser, b?: TestUser) => {
  const { server, channels } = await mkServer(a)
  if (b) await joinAsMember(server.id, b.id)
  const voice = channels.find((c: any) => c.type === 'voice')
  return { server, voice }
}

const ids = (p: { userIds: string[] }) => [...p.userIds].sort()

describe('voice channel presence', () => {
  it('tells another member of the same server who just joined the voice channel', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)

    // b must connect AFTER joining, since chan: rooms are joined at connect.
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const seen = nextEvent(bSock, 'call:state')

    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })

    const payload = await seen
    // Exactly what roomFor mints, or the two halves of the app put people in
    // different LiveKit rooms while both believing they are connected.
    expect(payload.room).toBe(roomFor('channel', voice.id, a.id))
    expect(payload.room).toBe(`voice:${voice.id}`)
    expect(payload.userIds).toEqual([a.id])
  })

  it('tells nobody outside the server', async () => {
    const a = await register(), outsider = await register()
    const { voice } = await seed(a)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const oSock = track(await connectSocket(sockets.url, outsider.token))
    let seen = false
    oSock.on('call:state', () => { seen = true })

    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })

    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
  })

  it('removes the occupant again when they leave', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const joined = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    expect((await joined).userIds).toEqual([a.id])

    const left = nextEvent(bSock, 'call:state')
    aSock.emit('call:leave', { conversationId: voice.id, kind: 'channel' })
    const payload = await left
    expect(payload.room).toBe(`voice:${voice.id}`)
    expect(payload.userIds).toEqual([])
  })

  it('shows both occupants to each other when two members are in the channel', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const aFirst = nextEvent(aSock, 'call:state')
    const bFirst = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    expect(ids(await aFirst)).toEqual([a.id])
    expect(ids(await bFirst)).toEqual([a.id])

    const aSecond = nextEvent(aSock, 'call:state')
    const bSecond = nextEvent(bSock, 'call:state')
    bSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    expect(ids(await aSecond)).toEqual([a.id, b.id].sort())
    expect(ids(await bSecond)).toEqual([a.id, b.id].sort())
  })

  it('clears occupancy when a participant vanishes without leaving cleanly', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const joined = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    expect((await joined).userIds).toEqual([a.id])

    const cleared = nextEvent(bSock, 'call:state')
    aSock.disconnect()
    const payload = await cleared
    expect(payload.room).toBe(`voice:${voice.id}`)
    expect(payload.userIds).toEqual([])
  })

  it('catches a member up on a channel call that started before they connected', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const aSelf = nextEvent(aSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await aSelf   // the call is definitely registered before b shows up

    const bSock = track(await connectSocket(sockets.url, b.token))
    const payload = await nextEvent(bSock, 'call:state')
    expect(payload.room).toBe(`voice:${voice.id}`)
    expect(payload.userIds).toEqual([a.id])
  })

  it('catches nobody up who is not in the server', async () => {
    const a = await register(), outsider = await register()
    const { voice } = await seed(a)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const aSelf = nextEvent(aSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await aSelf

    const oSock = track(await connectSocket(sockets.url, outsider.token))
    let seen = false
    oSock.on('call:state', () => { seen = true })
    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
  })

  it('writes no system message for a channel call — there is no text history to write it into', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const before = await Message.countDocuments()

    const joined = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await joined

    // Leaving is the other half: postCallEnded fires for the last participant.
    const left = nextEvent(bSock, 'call:state')
    aSock.emit('call:leave', { conversationId: voice.id, kind: 'channel' })
    await left

    expect(await Message.countDocuments()).toBe(before)
  })
})

// broadcastCall's DM branch PARSES the room name rather than matching a prefix,
// so it is the branch that quietly produces nonsense if the new channel case is
// bolted on carelessly. These two keep the old paths honest.
describe('the DM and group call paths still work', () => {
  it('still reaches both DM participants, and still posts the system message', async () => {
    const a = await register(), b = await register()

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const before = await Message.countDocuments()
    const seen = nextEvent(bSock, 'call:state')

    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })

    const payload = await seen
    expect(payload.room).toBe(`dm:${dmConvId(a.id, b.id)}`)
    expect(payload.userIds).toEqual([a.id])
    expect(await Message.countDocuments()).toBe(before + 1)
  })

  it('still reaches the group room', async () => {
    const a = await register(), b = await register()
    // Made against the model: the real endpoint requires friendship setup that
    // is irrelevant here (same shortcut groupMessages.test.ts takes).
    const group = await Conversation.create({
      type: 'group', owner: a.id, members: [a.id, b.id], lastMessageAt: new Date(),
    })
    const groupId = group._id.toString()

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const seen = nextEvent(bSock, 'call:state')

    aSock.emit('call:join', { conversationId: groupId, kind: 'group' })

    const payload = await seen
    expect(payload.room).toBe(`group:${groupId}`)
    expect(payload.userIds).toEqual([a.id])
  })
})
