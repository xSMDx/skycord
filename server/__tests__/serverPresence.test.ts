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
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body.server

describe('presence across a server', () => {
  it('reaches a co-member who is not a friend', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await Server.updateOne({ _id: s.id }, { $push: { members: b.id } })

    const aSock = track(await connectSocket(sockets.url, a.token))
    const got = nextEvent(aSock, 'presence')

    // b comes online after a is already watching. They are not friends.
    track(await connectSocket(sockets.url, b.token))

    const p = await got
    expect(p.userId).toBe(b.id)
    expect(p.status).not.toBe('offline')
  })

  it('reports a co-member going offline', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await Server.updateOne({ _id: s.id }, { $push: { members: b.id } })

    // a connects first so it's already listening when b connects. b is
    // already a co-member at that point, so b's own connect fires an online
    // announce to a — consumed here deterministically (rather than racing it
    // against the offline announce below with a timed wait) before we start
    // listening for the disconnect.
    const aSock = track(await connectSocket(sockets.url, a.token))
    const onlineAnnounce = nextEvent(aSock, 'presence')
    const bSock = track(await connectSocket(sockets.url, b.token))
    const online = await onlineAnnounce
    expect(online.userId).toBe(b.id)
    expect(online.status).not.toBe('offline')

    const got = nextEvent(aSock, 'presence')
    bSock.disconnect()
    const p = await got
    expect(p.userId).toBe(b.id)
    expect(p.status).toBe('offline')
  })

  it('does not reach a stranger who shares nothing', async () => {
    const a = await register(), b = await register()
    await mkServer(a)   // b is NOT a member

    const aSock = track(await connectSocket(sockets.url, a.token))
    let seen = false
    aSock.on('presence', () => { seen = true })

    track(await connectSocket(sockets.url, b.token))
    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
  })

  // The audience used to be a closure computed once, at connect. b's socket
  // opens before b has any relationship to a at all (not a friend, no shared
  // server), so that snapshot excludes a. b then joins a's server via invite
  // WITHOUT reconnecting — the membership change happens entirely inside the
  // lifetime of b's already-open connection. If the audience is still that
  // stale connect-time snapshot when b later disconnects, a never hears
  // about it. Recomputing the audience at each emit site (rather than only
  // at connect) is what closes this.
  it('reaches a member who joined my server after my connection was already open, without either side reconnecting', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const invite = (await app().post(`/servers/${s.id}/invites`).set(auth(a)).send({ expiry: '24h' })).body.invite

    const aSock = track(await connectSocket(sockets.url, a.token))
    // b connects BEFORE joining a's server.
    const bSock = track(await connectSocket(sockets.url, b.token))

    const joined = await app().post(`/invites/${invite.code}`).set(auth(b))
    expect(joined.status).toBe(200)

    // b goes offline on the SAME socket that connected before joining — no
    // reconnect for either a or b.
    const got = nextEvent(aSock, 'presence')
    bSock.disconnect()

    const p = await got
    expect(p.userId).toBe(b.id)
    expect(p.status).toBe('offline')
  })
})
