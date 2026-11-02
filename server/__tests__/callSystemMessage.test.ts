/**
 * The system lines a call writes into its conversation ("X started a call",
 * "Call ended"), and who they say wrote them.
 *
 * They used to carry the caller's USERNAME in both `authorName` and the text,
 * while every ordinary message names its author by display name. The web client
 * printed the text as it was ("t11b_mvkppvuf started a call"), and the phone —
 * which keeps the last name it saw for each person — learned the username from
 * the line, lost "Bea", and rang with "bea_mvltzvvw". call:join awaits the line
 * before it broadcasts, so it landed just ahead of the ring's own lookup.
 *
 * Every assertion here uses a display name that differs from the username, so
 * a pass can only come from reading the right field.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  connectDb, disconnectDb, resetDb, register,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { Conversation } from '../models/Conversation'
import { Message } from '../models/Message'
import { User } from '../models/User'
import { cancelAllCallEnds } from '../sockets/chatSocket'

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

type SystemLine = { kind: string; systemType: string; authorId: string; authorName: string; content: string }

const named = (u: TestUser, displayName: string) => User.updateOne({ _id: u.id }, { displayName })

// Created directly against the model: group creation through the endpoint needs
// friendship setup that has nothing to do with what these tests check.
const mkGroup = (owner: TestUser, members: TestUser[]) =>
  Conversation.create({
    type: 'group', owner: owner.id,
    members: [owner.id, ...members.map(m => m.id)],
    lastMessageAt: new Date(),
  })

describe('the "started a call" line', () => {
  it('a DM call names its caller by display name, in the author and in the text', async () => {
    const a = await register(), b = await register()
    await named(a, 'Ann Display')
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const line = nextEvent<SystemLine>(bSock, 'dm:receive')
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    const got = await line

    expect(got).toMatchObject({
      kind: 'system', systemType: 'call', authorId: a.id,
      authorName: 'Ann Display', content: 'Ann Display started a call',
    })
    // What is stored is what a reload reads back, so it must agree with the live event.
    const stored = await Message.findOne({ kind: 'system', systemType: 'call' }).lean()
    expect(stored).toMatchObject({ authorName: 'Ann Display', content: 'Ann Display started a call' })
  })

  it('falls back to the username when the caller has no display name', async () => {
    const a = await register(), b = await register()
    await named(a, '')
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const line = nextEvent<SystemLine>(bSock, 'dm:receive')
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })

    expect(await line).toMatchObject({
      authorName: a.username, content: `${a.username} started a call`,
    })
  })

  it('uses the name the caller has now, not the one they had when the socket connected', async () => {
    const a = await register(), b = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    // A socket lives for hours; the person renamed themselves meanwhile.
    await named(a, 'Renamed Ann')

    const line = nextEvent<SystemLine>(bSock, 'dm:receive')
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })

    expect(await line).toMatchObject({
      authorName: 'Renamed Ann', content: 'Renamed Ann started a call',
    })
  })

  it('a group call names its caller by display name too', async () => {
    const a = await register(), b = await register()
    await named(a, 'Ann Display')
    const group = await mkGroup(a, [b])
    const groupId = group._id.toString()
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const line = nextEvent<SystemLine>(bSock, 'group:receive')
    aSock.emit('call:join', { conversationId: groupId, kind: 'group' })

    expect(await line).toMatchObject({
      kind: 'system', systemType: 'call', authorName: 'Ann Display', content: 'Ann Display started a call',
    })
  })
})

describe('the "Call ended" line', () => {
  it('is written under the display name of the person who ended it', async () => {
    const a = await register(), b = await register()
    await named(a, 'Ann Display')
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const started = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    await started

    // call:leave fires postCallEnded without awaiting it, so wait for the
    // line itself rather than for call:state.
    const ended = nextEvent<SystemLine>(bSock, 'dm:receive')
    aSock.emit('call:leave', { conversationId: b.id, kind: 'dm' })

    expect(await ended).toMatchObject({
      kind: 'system', systemType: 'call', authorId: a.id, authorName: 'Ann Display', content: 'Call ended',
    })
    const stored = await Message.findOne({ content: 'Call ended' }).lean()
    expect(stored?.authorName).toBe('Ann Display')
  })
})
