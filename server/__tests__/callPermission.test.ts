/**
 * Who may ring whom.
 *
 * A DM call follows the same rule as a DM message (canDM): friends, people who
 * share a group, or people who already have a conversation. Ringing is how a
 * call reaches somebody, so a call that skipped the rule would reach people a
 * message cannot, and its "started a call" line would leave a conversation
 * behind that neither of them ever had.
 *
 * Every way into a DM call checks it: joining and rejoining over the socket,
 * the token a client needs to enter the media room, and moving a call to
 * another voice server.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, auth, befriend, connectDb, disconnectDb, resetDb, register,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { Conversation } from '../models/Conversation'
import { Message } from '../models/Message'
import { cancelAllCallEnds, isInCall } from '../sockets/chatSocket'
import { dmConvId } from '../controllers/messagesController'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => {
  open.splice(0).forEach(s => s.disconnect())
  // Those disconnects schedule call ends on the server. Let the handlers run,
  // then drop them, so a timer cannot write into the next test's database.
  await new Promise(r => setTimeout(r, 50))
  cancelAllCallEnds()
  await resetDb()
})

const track = (s: ClientSocket) => { open.push(s); return s }
const settle = (ms = 500) => new Promise(r => setTimeout(r, ms))
const dmRoom = (x: TestUser, y: TestUser) => `dm:${dmConvId(x.id, y.id)}`
const callLines = (x: TestUser, y: TestUser) =>
  Message.countDocuments({ conversationId: dmConvId(x.id, y.id), kind: 'system', systemType: 'call' })

describe('ringing over the socket', () => {
  it('a stranger cannot ring someone', async () => {
    const a = await register(), b = await register()   // no friendship, no history, no shared group
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    let rang = false
    bSock.on('call:state', () => { rang = true })

    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    await settle()

    expect(rang).toBe(false)
    expect(isInCall(dmRoom(a, b), a.id)).toBe(false)
    expect(await callLines(a, b)).toBe(0)
  })

  it('a stranger cannot come in through rejoin either', async () => {
    const a = await register(), b = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    let rang = false
    bSock.on('call:state', () => { rang = true })

    aSock.emit('call:rejoin', { conversationId: b.id, kind: 'dm' })
    await settle()

    expect(rang).toBe(false)
    expect(isInCall(dmRoom(a, b), a.id)).toBe(false)
  })

  it('friends can ring each other', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const rings = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    await rings

    expect(isInCall(dmRoom(a, b), a.id)).toBe(true)
    expect(await callLines(a, b)).toBe(1)
  })

  it('people who share a group can ring each other', async () => {
    const a = await register(), b = await register()
    await Conversation.create({ type: 'group', owner: a.id, members: [a.id, b.id], lastMessageAt: new Date() })
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const rings = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    await rings

    expect(isInCall(dmRoom(a, b), a.id)).toBe(true)
  })
})

describe('what counts as an earlier conversation', () => {
  it('a call line on its own does not open a DM', async () => {
    const a = await register(), b = await register()
    await Message.create({
      conversationId: dmConvId(a.id, b.id), kind: 'system', systemType: 'call',
      authorId: a.id, authorName: a.username, content: `${a.username} started a call`,
    })

    const res = await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'hello' })
    expect(res.status).toBe(403)
  })

  it('a real message still keeps the thread open', async () => {
    const a = await register(), b = await register()
    await Message.create({
      conversationId: dmConvId(a.id, b.id), kind: 'dm',
      authorId: b.id, authorName: b.username, content: 'hi from before',
    })

    const res = await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'hello again' })
    expect(res.status).toBe(201)
  })
})

describe('the voice endpoints', () => {
  it('a stranger gets no token for a DM call', async () => {
    const a = await register(), b = await register()
    const res = await app().post('/voice/token').set(auth(a)).send({ conversationId: b.id, kind: 'dm' })
    expect(res.status).toBe(403)
  })

  it('a friend still gets one', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)
    const res = await app().post('/voice/token').set(auth(a)).send({ conversationId: b.id, kind: 'dm' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
  })

  it('a stranger cannot move a DM call to another voice server', async () => {
    const a = await register(), b = await register()
    const res = await app().post('/voice/move').set(auth(a)).send({ conversationId: b.id, kind: 'dm' })
    expect(res.status).toBe(403)
  })
})
