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
})
