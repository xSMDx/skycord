import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  connectDb, disconnectDb, resetDb, register, withSocketServer, connectSocket, type TestUser,
} from './helpers'
import { Message } from '../models/Message'
import { Conversation } from '../models/Conversation'
import { Friendship } from '../models/Friendship'
import { dmConvId } from '../controllers/messagesController'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }
const befriend = (a: TestUser, b: TestUser) =>
  Friendship.create({ requester: a.id, receiver: b.id, status: 'accepted' })
const mkGroup = (owner: TestUser, members: TestUser[]) =>
  Conversation.create({
    type: 'group', owner: owner.id,
    members: [owner.id, ...members.map(m => m.id)],
    lastMessageAt: new Date(),
  })

/** Emits an event and resolves with whatever the server acked back. */
const ack = <T = any>(socket: ClientSocket, event: string, payload: any): Promise<T> =>
  new Promise(resolve => socket.emit(event, payload, resolve))

describe('dm:send socket: reply preview scoping', () => {
  it('does not leak a reply preview for a message from a different DM', async () => {
    const a = await register(), b = await register()
    const c = await register(), d = await register()
    await befriend(a, b)
    const secret = await Message.create({
      conversationId: dmConvId(c.id, d.id), kind: 'dm', authorId: c.id, authorName: c.username,
      content: 'secret-socket-dm', replyToIds: [],
    })

    const aSock = track(await connectSocket(sockets.url, a.token))
    const res = await ack(aSock, 'dm:send', {
      partnerId: b.id, content: 'sneaky', authorName: 'x', replyToIds: [secret._id.toString()],
    })

    expect(res.ok).toBe(true)
    expect(res.message.replyTo).toEqual([])
    expect(JSON.stringify(res)).not.toContain('secret-socket-dm')

    const stored = await Message.findById(res.message._id).lean()
    expect(stored!.replyToIds).toEqual([])
  })

  it('resolves a reply to a message in the same DM correctly', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)
    const aSock = track(await connectSocket(sockets.url, a.token))

    const first = await ack(aSock, 'dm:send', { partnerId: b.id, content: 'orig', authorName: 'x' })
    expect(first.ok).toBe(true)

    const second = await ack(aSock, 'dm:send', {
      partnerId: b.id, content: 'reply', authorName: 'x', replyToIds: [first.message._id],
    })
    expect(second.ok).toBe(true)
    expect(second.message.replyTo).toHaveLength(1)
    expect(second.message.replyTo[0]).toMatchObject({ id: first.message._id, author: a.username, content: 'orig' })
  })
})

describe('dm:reply socket: reply preview scoping', () => {
  it('does not leak a reply preview for a message from a different DM', async () => {
    const a = await register(), b = await register()
    const c = await register(), d = await register()
    await befriend(a, b)
    const secret = await Message.create({
      conversationId: dmConvId(c.id, d.id), kind: 'dm', authorId: c.id, authorName: c.username,
      content: 'secret-socket-dm-reply', replyToIds: [],
    })

    const aSock = track(await connectSocket(sockets.url, a.token))
    const res = await ack(aSock, 'dm:reply', {
      partnerId: b.id, content: 'sneaky', authorName: 'x', replyToIds: [secret._id.toString()],
    })

    expect(res.ok).toBe(true)
    expect(res.message.replyTo).toEqual([])
    expect(JSON.stringify(res)).not.toContain('secret-socket-dm-reply')

    const stored = await Message.findById(res.message._id).lean()
    expect(stored!.replyToIds).toEqual([])
  })

  it('resolves a reply to a message in the same DM correctly', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)
    const aSock = track(await connectSocket(sockets.url, a.token))

    const first = await ack(aSock, 'dm:send', { partnerId: b.id, content: 'orig', authorName: 'x' })
    const second = await ack(aSock, 'dm:reply', {
      partnerId: b.id, content: 'reply', authorName: 'x', replyToIds: [first.message._id],
    })
    expect(second.ok).toBe(true)
    expect(second.message.replyTo).toHaveLength(1)
    expect(second.message.replyTo[0]).toMatchObject({ id: first.message._id, author: a.username, content: 'orig' })
  })
})

describe('group:send socket: reply preview scoping', () => {
  it('does not leak a reply preview for a message from a different group', async () => {
    const a = await register(), b = await register()
    const group = await mkGroup(a, [b])
    const c = await register(), d = await register()
    const otherGroup = await mkGroup(c, [d])
    const secret = await Message.create({
      conversationId: otherGroup._id.toString(), kind: 'group', authorId: c.id, authorName: c.username,
      content: 'secret-socket-group', replyToIds: [],
    })

    const aSock = track(await connectSocket(sockets.url, a.token))
    const res = await ack(aSock, 'group:send', {
      groupId: group._id.toString(), content: 'sneaky', authorName: 'x', replyToIds: [secret._id.toString()],
    })

    expect(res.ok).toBe(true)
    expect(res.message.replyTo).toEqual([])
    expect(JSON.stringify(res)).not.toContain('secret-socket-group')

    const stored = await Message.findById(res.message._id).lean()
    expect(stored!.replyToIds).toEqual([])
  })

  it('resolves a reply to a message in the same group correctly', async () => {
    const a = await register(), b = await register()
    const group = await mkGroup(a, [b])
    const aSock = track(await connectSocket(sockets.url, a.token))

    const first = await ack(aSock, 'group:send', { groupId: group._id.toString(), content: 'orig', authorName: 'x' })
    expect(first.ok).toBe(true)
    const second = await ack(aSock, 'group:send', {
      groupId: group._id.toString(), content: 'reply', authorName: 'x', replyToIds: [first.message._id],
    })
    expect(second.ok).toBe(true)
    expect(second.message.replyTo).toHaveLength(1)
    expect(second.message.replyTo[0]).toMatchObject({ id: first.message._id, author: a.username, content: 'orig' })
  })
})
