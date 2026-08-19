import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Message } from '../models/Message'
import { Friendship } from '../models/Friendship'
import { dmConvId } from '../controllers/messagesController'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

// canDM requires an existing relationship — simplest is an accepted friendship,
// created directly so these tests don't have to drive the whole request flow.
const befriend = (a: TestUser, b: TestUser) =>
  Friendship.create({ requester: a.id, receiver: b.id, status: 'accepted' })

describe('DM messages: reply preview scoping', () => {
  it('does not leak a reply preview for a message from a different DM', async () => {
    const a = await register(), b = await register()
    const c = await register(), d = await register()
    await befriend(a, b)

    // Lives in a DM neither a nor b is part of.
    const secret = await Message.create({
      conversationId: dmConvId(c.id, d.id),
      kind: 'dm', authorId: c.id, authorName: c.username,
      content: 'secret-dm-content', replyToIds: [],
    })

    const sent = await app().post(`/messages/dm/${b.id}`).set(auth(a))
      .send({ content: 'sneaky reply', replyToIds: [secret._id.toString()] })
    expect(sent.status).toBe(201)

    const read = await app().get(`/messages/dm/${b.id}`).set(auth(a))
    expect(read.status).toBe(200)
    expect(JSON.stringify(read.body)).not.toContain('secret-dm-content')
    const msg = read.body.messages.find((m: any) => m.content === 'sneaky reply')
    expect(msg.replyTo).toEqual([])
  })

  it('resolves a reply to a message in the same DM correctly', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)

    const original = await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'original dm' })
    const originalId = original.body.message._id

    const reply = await app().post(`/messages/dm/${b.id}`).set(auth(a))
      .send({ content: 'replying', replyToIds: [originalId] })
    expect(reply.status).toBe(201)

    const read = await app().get(`/messages/dm/${b.id}`).set(auth(a))
    const msg = read.body.messages.find((m: any) => m.content === 'replying')
    expect(msg.replyTo).toHaveLength(1)
    expect(msg.replyTo[0]).toMatchObject({ id: originalId, author: a.username, content: 'original dm' })
  })

  it('does not leak via the legacy single replyTo field either', async () => {
    const a = await register(), b = await register()
    const c = await register(), d = await register()
    await befriend(a, b)

    const secret = await Message.create({
      conversationId: dmConvId(c.id, d.id),
      kind: 'dm', authorId: c.id, authorName: c.username,
      content: 'secret-legacy-content',
    })

    // Simulates an old-shape document written before replyToIds[] existed.
    await Message.create({
      conversationId: dmConvId(a.id, b.id),
      kind: 'dm', authorId: a.id, authorName: a.username,
      content: 'legacy reply attempt', replyTo: secret._id,
    })

    const read = await app().get(`/messages/dm/${b.id}`).set(auth(a))
    expect(JSON.stringify(read.body)).not.toContain('secret-legacy-content')
    const msg = read.body.messages.find((m: any) => m.content === 'legacy reply attempt')
    expect(msg.replyTo).toEqual([])
  })

  it('does not persist an unvalidated reply id from another DM', async () => {
    const a = await register(), b = await register()
    const c = await register(), d = await register()
    await befriend(a, b)

    const secret = await Message.create({
      conversationId: dmConvId(c.id, d.id),
      kind: 'dm', authorId: c.id, authorName: c.username,
      content: 'secret-persist-content', replyToIds: [],
    })

    const res = await app().post(`/messages/dm/${b.id}`).set(auth(a))
      .send({ content: 'x', replyToIds: [secret._id.toString()] })
    expect(res.status).toBe(201)

    const stored = await Message.findById(res.body.message._id).lean()
    expect(stored!.replyToIds).toEqual([])
  })
})
