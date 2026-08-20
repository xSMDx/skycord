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
const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

describe('channel sockets', () => {
  it('delivers a posted message to another connected member', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
    const c = channels.find((x: any) => x.type === 'text')

    // b must connect AFTER joining, since rooms are joined at connect time.
    const bSock = track(await connectSocket(sockets.url, b.token))
    const received = nextEvent(bSock, 'channel:receive')

    await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(a)).send({ content: 'live hello' })

    const payload = await received
    expect(payload.content).toBe('live hello')
    expect(payload.conversationId).toBe(c.id)
    expect(payload.authorName).toBe(a.username)
  })

  it('does not deliver to someone who is not a member', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    const c = channels.find((x: any) => x.type === 'text')

    const bSock = track(await connectSocket(sockets.url, b.token))
    let seen = false
    bSock.on('channel:receive', () => { seen = true })

    await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(a)).send({ content: 'private' })

    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
  })

  // sendChannelMessage emitted with io.to(room), which includes the sender's
  // own socket — on top of the same payload already coming back in the 201.
  // The group path hit this exact bug and fixed it with socket.to(...); the
  // channel path needs the equivalent (.except('user:<id>')) since it emits
  // from getIO() rather than from the sender's own socket instance.
  it("does not deliver the message back to the sender's own socket, only to other members", async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
    const c = channels.find((x: any) => x.type === 'text')

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    let senderSaw = false
    aSock.on('channel:receive', () => { senderSaw = true })
    const received = nextEvent(bSock, 'channel:receive')

    await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(a)).send({ content: 'no echo' })

    const payload = await received
    expect(payload.content).toBe('no echo')

    await new Promise(r => setTimeout(r, 400))
    expect(senderSaw).toBe(false)
  })

  // Regression: createServer used to be the one membership-creating path that
  // never socketsJoin'd anyone into its new chan: rooms. createChannel and
  // joinViaInvite both did. Because sockets only join rooms at CONNECT time,
  // the person who had just made a server was the single member who received
  // nothing from it — no messages, no edits, no pins — until they reloaded.
  // Every other test in this file connects after the server already exists,
  // which is exactly what hid it.
  it('joins the creator to the new server rooms without a reconnect', async () => {
    const a = await register(), b = await register()

    // a connects BEFORE the server exists. That ordering is the whole point.
    const aSock = track(await connectSocket(sockets.url, a.token))

    // The client's 'connect' fires at handshake, but chatSocket's room joins
    // happen after an await (it queries Server.find then Channel.find). Without
    // settling here, that query can land AFTER the server below is created and
    // sweep up its channels by accident — which made this test pass even with
    // the fix removed. The wait is what makes it actually test the fix.
    await new Promise(r => setTimeout(r, 300))

    const { server, channels } = await mkServer(a)
    await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
    const c = channels.find((x: any) => x.type === 'text')

    const received = nextEvent(aSock, 'channel:receive')
    await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(b)).send({ content: 'can the creator hear me' })

    const payload = await received
    expect(payload.content).toBe('can the creator hear me')
    expect(payload.conversationId).toBe(c.id)
  })
})
