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
})
