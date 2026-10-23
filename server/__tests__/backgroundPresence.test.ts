/**
 * A background connection — the Android app's notification socket — must not
 * make anyone look online.
 *
 * The phone holds a socket.io connection open all day so a DM or an incoming
 * call can ring while the app is closed. If that socket counted for presence,
 * everyone would see the person as online around the clock. It still has to be
 * a real member of every room, though: delivering messages is its whole job.
 *
 * It announces itself with `auth: { token, background: true }`.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  connectDb, disconnectDb, resetDb, register,
  withSocketServer, connectSocket, connectBackground, nextEvent, type TestUser,
} from './helpers'
import { Friendship } from '../models/Friendship'
import { User } from '../models/User'
import { isUserOnline } from '../sockets/chatSocket'
import * as presence from '../state/presence'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }

const befriend = (a: TestUser, b: TestUser) =>
  Friendship.create({ requester: a.id, receiver: b.id, status: 'accepted' })

/** Records every `presence` event about `userId` that reaches `listener`. */
const watchPresence = (listener: ClientSocket, userId: string) => {
  const seen: { userId: string; status: string }[] = []
  listener.on('presence', (p: { userId: string; status: string }) => { if (p.userId === userId) seen.push(p) })
  return seen
}

const settle = (ms = 300) => new Promise(r => setTimeout(r, ms))

describe('background connections and presence', () => {
  it('a background socket alone leaves the user offline', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)

    const bSock = track(await connectSocket(sockets.url, b.token))
    const seen = watchPresence(bSock, a.id)

    track(await connectBackground(sockets.url, a.token))
    await settle()

    expect(seen).toEqual([])
    expect(isUserOnline(a.id)).toBe(false)
  })

  it('a background socket still receives the user\'s DMs', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)

    const bSock = track(await connectSocket(sockets.url, b.token))
    const aBackground = track(await connectBackground(sockets.url, a.token))

    const got = nextEvent(aBackground, 'dm:receive')
    bSock.emit('dm:send', { partnerId: a.id, content: 'ring ring', authorName: b.username })

    const msg = await got
    expect(msg.content).toBe('ring ring')
    expect(msg.authorId).toBe(b.id)
  })

  it('closing a normal socket goes offline even with a background socket open', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)

    const bSock = track(await connectSocket(sockets.url, b.token))
    const aNormal = track(await connectSocket(sockets.url, a.token))
    track(await connectBackground(sockets.url, a.token))
    expect(isUserOnline(a.id)).toBe(true)

    const seen = watchPresence(bSock, a.id)
    aNormal.disconnect()
    await settle(600)

    expect(seen).toEqual([{ userId: a.id, status: 'offline' }])
    expect(isUserOnline(a.id)).toBe(false)
  })

  it('a normal socket opening beside a background one is what announces the user online', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)

    const bSock = track(await connectSocket(sockets.url, b.token))
    const seen = watchPresence(bSock, a.id)

    track(await connectBackground(sockets.url, a.token))
    await settle()
    expect(seen).toEqual([])

    track(await connectSocket(sockets.url, a.token))
    await settle()
    expect(seen).toHaveLength(1)
    expect(seen[0].status).toBe('online')
    expect(isUserOnline(a.id)).toBe(true)
  })

  it('closing a background socket never announces anything', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)

    const bSock = track(await connectSocket(sockets.url, b.token))
    track(await connectSocket(sockets.url, a.token))
    const aBackground = track(await connectBackground(sockets.url, a.token))

    const seen = watchPresence(bSock, a.id)
    aBackground.disconnect()
    await settle(600)

    expect(seen).toEqual([])
    expect(isUserOnline(a.id)).toBe(true)
  })

  it('a background socket cannot mark the user away or change their status', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)

    const bSock = track(await connectSocket(sockets.url, b.token))
    track(await connectSocket(sockets.url, a.token))
    const aBackground = track(await connectBackground(sockets.url, a.token))

    const seen = watchPresence(bSock, a.id)
    // Both events a foreground client would use. Neither may land.
    aBackground.emit('presence:away', true)
    const ack = await new Promise<any>(resolve => aBackground.emit('presence:set', 'dnd', resolve))
    await settle(600)

    expect(ack.ok).toBe(false)
    expect(seen).toEqual([])
    expect(presence.isAway(a.id)).toBe(false)
    expect((await User.findById(a.id).lean())?.status).toBe('online')
  })
})
