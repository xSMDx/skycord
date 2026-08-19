import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { Server } from '../models/Server'
import { getIO } from '../sockets/chatSocket'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }
const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

/** A second member, connected, ready to observe. */
const memberSocket = async (sid: string) => {
  const b = await register()
  await Server.updateOne({ _id: sid }, { $push: { members: b.id } })
  return { b, sock: track(await connectSocket(sockets.url, b.token)) }
}

describe('server and channel lifecycle events', () => {
  it('announces a new channel to members', async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const { sock } = await memberSocket(server.id)
    const got = nextEvent(sock, 'channel:created')

    await app().post(`/servers/${server.id}/channels`).set(auth(a))
      .send({ name: 'announcements', type: 'text' })

    const p = await got
    expect(p.channel.name).toBe('announcements')
    expect(p.serverId).toBe(server.id)
  })

  it('announces a rename', async () => {
    const a = await register()
    const { server, channels } = await mkServer(a)
    const c = channels.find((x: any) => x.type === 'text')
    const { sock } = await memberSocket(server.id)
    const got = nextEvent(sock, 'channel:updated')

    await app().patch(`/servers/${server.id}/channels/${c.id}`).set(auth(a)).send({ name: 'renamed' })
    expect((await got).channel.name).toBe('renamed')
  })

  it('announces a deletion', async () => {
    const a = await register()
    const { server, channels } = await mkServer(a)
    const voice = channels.find((x: any) => x.type === 'voice')
    const { sock } = await memberSocket(server.id)
    const got = nextEvent(sock, 'channel:deleted')

    await app().delete(`/servers/${server.id}/channels/${voice.id}`).set(auth(a))
    const p = await got
    expect(p.channelId).toBe(voice.id)
    expect(p.serverId).toBe(server.id)
  })

  it('announces a server rename', async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const { sock } = await memberSocket(server.id)
    const got = nextEvent(sock, 'server:updated')

    await app().patch(`/servers/${server.id}`).set(auth(a)).send({ name: 'Renamed' })
    expect((await got).server.name).toBe('Renamed')
  })

  it('announces a join to the members already inside', async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const aSock = track(await connectSocket(sockets.url, a.token))
    const got = nextEvent(aSock, 'server:memberJoined')

    const inv = (await app().post(`/servers/${server.id}/invites`)
      .set(auth(a)).send({ expiry: '24h' })).body.invite
    const c = await register()
    await app().post(`/invites/${inv.code}`).set(auth(c))

    const p = await got
    expect(p.serverId).toBe(server.id)
    expect(p.member.id).toBe(c.id)
    // Presence is computed, never the stored column.
    expect(['online', 'idle', 'dnd', 'offline']).toContain(p.member.status)
  })

  it('announces a departure', async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const { b } = await memberSocket(server.id)
    const aSock = track(await connectSocket(sockets.url, a.token))
    const got = nextEvent(aSock, 'server:memberLeft')

    await app().delete(`/servers/${server.id}/members/${b.id}`).set(auth(b))
    const p = await got
    expect(p.serverId).toBe(server.id)
    expect(p.userId).toBe(b.id)
  })

  // Finding 1: `$pull` on a target that was never a member is a no-op, and
  // must not tell every client someone left when nobody did.
  it('does not announce a departure when the target was never a member', async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const stranger = await register() // valid ObjectId, never added to server.members
    const aSock = track(await connectSocket(sockets.url, a.token))
    let seen = false
    aSock.on('server:memberLeft', () => { seen = true })

    const res = await app().delete(`/servers/${server.id}/members/${stranger.id}`).set(auth(a))
    expect(res.body).toEqual({ ok: true }) // the idempotent-DELETE convention stays put

    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
  })

  // (b) The departing member's OWN socket must get its own removal, not just
  // whoever else happens to be listening. Both paths that can produce a
  // removal need to be covered separately: leaving yourself, and being
  // kicked by the owner.
  it("notifies the departing member's own socket when they leave", async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const { b, sock: bSock } = await memberSocket(server.id)
    const got = nextEvent(bSock, 'server:memberLeft')

    await app().delete(`/servers/${server.id}/members/${b.id}`).set(auth(b))

    const p = await got
    expect(p.serverId).toBe(server.id)
    expect(p.userId).toBe(b.id)
  })

  it("notifies the departing member's own socket when the owner kicks them", async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const { b, sock: bSock } = await memberSocket(server.id)
    const got = nextEvent(bSock, 'server:memberLeft')

    await app().delete(`/servers/${server.id}/members/${b.id}`).set(auth(a))

    const p = await got
    expect(p.serverId).toBe(server.id)
    expect(p.userId).toBe(b.id)
  })

  // (a) The binding constraint that matters most: a brand-new channel's room
  // must actually carry traffic to members who were already connected when
  // it was created, not merely announce that the channel exists. Their
  // sockets joined rooms at connect time, before this channel existed, so
  // this only works if the live fetchSockets()-join in createChannel ran.
  it("routes a message posted in a brand-new channel to an already-connected member", async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const { sock } = await memberSocket(server.id)

    const created = (await app().post(`/servers/${server.id}/channels`).set(auth(a))
      .send({ name: 'live-room', type: 'text' })).body.channel

    const received = nextEvent(sock, 'channel:receive')
    await app().post(`/servers/${server.id}/channels/${created.id}/messages`)
      .set(auth(a)).send({ content: 'fresh room hello' })

    const payload = await received
    expect(payload.content).toBe('fresh room hello')
    expect(payload.conversationId).toBe(created.id)
  })

  // (c) A deleted channel's room must actually evict its sockets, not just
  // announce the deletion. Proven by emitting straight into the room:
  // before deletion it must reach the member (positive control, so the
  // later "nothing arrives" isn't just a vacuous pass), and after deletion
  // it must reach nobody. `getIO()` is the same in-process IOServer the app
  // itself uses, so this observes the real room membership, not a mock.
  it('evicts sockets from a deleted channel room, so its traffic no longer reaches them', async () => {
    const a = await register()
    const { server, channels } = await mkServer(a)
    const voice = channels.find((x: any) => x.type === 'voice')
    const { sock } = await memberSocket(server.id)
    const room = `chan:${voice.id}`

    // The `chan:` room join happens in the connection handler's async setup
    // (a DB lookup), after the client already sees `connect` — unlike the
    // synchronous `user:<id>` join. Give it a beat before treating the room
    // as populated, or the positive control below races it.
    await new Promise(r => setTimeout(r, 200))

    // Positive control: the socket really is in the room before deletion.
    const before = nextEvent(sock, 'channel:receive')
    getIO()!.to(room).emit('channel:receive', { probe: 'before' })
    expect((await before).probe).toBe('before')

    await app().delete(`/servers/${server.id}/channels/${voice.id}`).set(auth(a))

    // Negative: the same room, addressed the same way, now reaches nobody.
    let seen = false
    sock.on('channel:receive', () => { seen = true })
    getIO()!.to(room).emit('channel:receive', { probe: 'after' })
    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
  })
})
