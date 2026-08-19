import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { Server } from '../models/Server'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }

/** Emits an event and resolves with whatever the server acked back. */
const ack = <T = any>(socket: ClientSocket, event: string, payload: any): Promise<T> =>
  new Promise(resolve => socket.emit(event, payload, resolve))

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body
const joinAsMember = async (sid: string, uid: string) =>
  Server.updateOne({ _id: sid }, { $push: { members: uid } })
const textOf = (channels: any[]) => channels.find((c: any) => c.type === 'text')
const postChannelMessage = async (u: TestUser, sid: string, cid: string, content: string) =>
  (await app().post(`/servers/${sid}/channels/${cid}/messages`).set(auth(u)).send({ content })).body.message

// canAccessMessage had no branch for kind === 'channel', so it fell through
// to the DM check (conversationId.split('_').includes(userId)). A channel's
// conversationId is a bare ObjectId with no underscore, so that check always
// returned false — pin and react were permanently "Not allowed" in channels,
// for members and non-members alike.
describe('channel messages: pin/react authorization', () => {
  it('lets a channel member pin a channel message', async () => {
    const a = await register()
    const { server, channels } = await mkServer(a)
    const c = textOf(channels)
    const msg = await postChannelMessage(a, server.id, c.id, 'pin me')

    const aSock = track(await connectSocket(sockets.url, a.token))
    const res = await ack(aSock, 'message:pin', { messageId: msg._id, pinned: true })
    expect(res.ok).toBe(true)
  })

  it('lets a channel member react to a channel message', async () => {
    const a = await register()
    const { server, channels } = await mkServer(a)
    const c = textOf(channels)
    const msg = await postChannelMessage(a, server.id, c.id, 'react to me')

    const aSock = track(await connectSocket(sockets.url, a.token))
    const res = await ack(aSock, 'message:react', { messageId: msg._id, emoji: '\u{1F44D}' })
    expect(res.ok).toBe(true)
  })

  it('refuses a non-member trying to pin', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    const c = textOf(channels)
    const msg = await postChannelMessage(a, server.id, c.id, 'private pin target')

    const bSock = track(await connectSocket(sockets.url, b.token))
    const res = await ack(bSock, 'message:pin', { messageId: msg._id, pinned: true })
    expect(res.ok).toBe(false)
  })

  it('refuses a non-member trying to react', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    const c = textOf(channels)
    const msg = await postChannelMessage(a, server.id, c.id, 'private react target')

    const bSock = track(await connectSocket(sockets.url, b.token))
    const res = await ack(bSock, 'message:react', { messageId: msg._id, emoji: '\u{1F44D}' })
    expect(res.ok).toBe(false)
  })
})

// getPartner(msg.conversationId, userId) was used to route the post-action
// broadcast. A channel's conversationId has no underscore, so
// convId.split('_').find(p => p !== myId) returns the WHOLE conversationId
// (it's the only element, and it's never equal to myId) — a truthy but
// bogus "partner" equal to the channel's own id. That sent every broadcast
// to a phantom `user:<channelId>` room nobody is ever in, so channel
// members never got these events live.
describe('channel messages: edit/delete/pin/react broadcast to other members', () => {
  it('broadcasts an edit to another connected member', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const c = textOf(channels)
    const msg = await postChannelMessage(a, server.id, c.id, 'before edit')

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    // The chan: room join happens in the connection handler's async setup (a
    // DB lookup), after the client already sees `connect` — give it a beat,
    // matching serverEvents.test.ts's "evicts sockets..." test, or the edit
    // below (a much shorter DB path) can race ahead of b's room join.
    await new Promise(r => setTimeout(r, 200))
    const received = nextEvent(bSock, 'message:edited')

    const res = await ack(aSock, 'message:edit', { messageId: msg._id, content: 'after edit' })
    expect(res.ok).toBe(true)

    const payload = await received
    expect(payload.messageId).toBe(msg._id)
    expect(payload.content).toBe('after edit')
  })

  it('broadcasts a delete to another connected member', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const c = textOf(channels)
    const msg = await postChannelMessage(a, server.id, c.id, 'to be deleted')

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    // See the edit test above for why this beat is needed.
    await new Promise(r => setTimeout(r, 200))
    const received = nextEvent(bSock, 'message:deleted')

    const res = await ack(aSock, 'message:delete', { messageId: msg._id })
    expect(res.ok).toBe(true)

    const payload = await received
    expect(payload.messageId).toBe(msg._id)
  })

  it('broadcasts a pin to another connected member', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const c = textOf(channels)
    const msg = await postChannelMessage(a, server.id, c.id, 'to be pinned')

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    // See the edit test above for why this beat is needed.
    await new Promise(r => setTimeout(r, 200))
    const received = nextEvent(bSock, 'message:pinned')

    const res = await ack(aSock, 'message:pin', { messageId: msg._id, pinned: true })
    expect(res.ok).toBe(true)

    const payload = await received
    expect(payload.messageId).toBe(msg._id)
    expect(payload.pinned).toBe(true)
  })

  it('broadcasts a reaction to another connected member', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const c = textOf(channels)
    const msg = await postChannelMessage(a, server.id, c.id, 'to be reacted to')

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    // See the edit test above for why this beat is needed.
    await new Promise(r => setTimeout(r, 200))
    const received = nextEvent(bSock, 'message:reacted')

    const res = await ack(aSock, 'message:react', { messageId: msg._id, emoji: '\u{1F389}' })
    expect(res.ok).toBe(true)

    const payload = await received
    expect(payload.messageId).toBe(msg._id)
    expect(payload.reactions[0]).toMatchObject({ emoji: '\u{1F389}', count: 1 })
  })
})
