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

    const bSock = track(await connectSocket(sockets.url, b.token))
    const aSock = track(await connectSocket(sockets.url, a.token))
    const got = nextEvent(aSock, 'presence');

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
})
