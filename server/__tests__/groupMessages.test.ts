import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Message } from '../models/Message'
import { Conversation } from '../models/Conversation'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

// Created directly against the model — group creation via the real endpoint
// requires friendship setup that's irrelevant to what these tests check.
const mkGroup = (owner: TestUser, members: TestUser[]) =>
  Conversation.create({
    type: 'group', owner: owner.id,
    members: [owner.id, ...members.map(m => m.id)],
    lastMessageAt: new Date(),
  })

describe('Group messages: reply preview scoping', () => {
  it('does not leak a reply preview for a message from a different group', async () => {
    const a = await register(), b = await register()
    const group = await mkGroup(a, [b])

    const c = await register(), d = await register()
    const otherGroup = await mkGroup(c, [d])
    const secret = await Message.create({
      conversationId: otherGroup._id.toString(),
      kind: 'group', authorId: c.id, authorName: c.username,
      content: 'secret-group-content', replyToIds: [],
    })

    const sent = await app().post(`/conversations/groups/${group._id}/messages`).set(auth(a))
      .send({ content: 'sneaky', replyToIds: [secret._id.toString()] })
    expect(sent.status).toBe(201)
    // The POST response itself must not leak — this endpoint builds its own
    // reply preview inline (not via the shared helpers) so this is a second,
    // independent site that must be scoped.
    expect(sent.body.message.replyTo).toEqual([])
    expect(JSON.stringify(sent.body)).not.toContain('secret-group-content')

    const read = await app().get(`/conversations/groups/${group._id}/messages`).set(auth(a))
    expect(read.status).toBe(200)
    expect(JSON.stringify(read.body)).not.toContain('secret-group-content')
    const msg = read.body.messages.find((m: any) => m.content === 'sneaky')
    expect(msg.replyTo).toEqual([])
  })

  it('resolves a reply to a message in the same group correctly', async () => {
    const a = await register(), b = await register()
    const group = await mkGroup(a, [b])

    const original = await app().post(`/conversations/groups/${group._id}/messages`).set(auth(a)).send({ content: 'orig' })
    const originalId = original.body.message._id
    expect(original.status).toBe(201)

    const reply = await app().post(`/conversations/groups/${group._id}/messages`).set(auth(a))
      .send({ content: 'reply', replyToIds: [originalId] })
    expect(reply.status).toBe(201)
    expect(reply.body.message.replyTo).toHaveLength(1)
    expect(reply.body.message.replyTo[0]).toMatchObject({ id: originalId, author: a.username, content: 'orig' })

    const read = await app().get(`/conversations/groups/${group._id}/messages`).set(auth(a))
    const msg = read.body.messages.find((m: any) => m.content === 'reply')
    expect(msg.replyTo).toHaveLength(1)
    expect(msg.replyTo[0]).toMatchObject({ id: originalId, author: a.username, content: 'orig' })
  })

  it('does not persist an unvalidated reply id from a different group', async () => {
    const a = await register(), b = await register()
    const group = await mkGroup(a, [b])
    const c = await register(), d = await register()
    const otherGroup = await mkGroup(c, [d])
    const secret = await Message.create({
      conversationId: otherGroup._id.toString(),
      kind: 'group', authorId: c.id, authorName: c.username,
      content: 'secret-persist-group', replyToIds: [],
    })

    const res = await app().post(`/conversations/groups/${group._id}/messages`).set(auth(a))
      .send({ content: 'x', replyToIds: [secret._id.toString()] })
    expect(res.status).toBe(201)

    const stored = await Message.findById(res.body.message._id).lean()
    expect(stored!.replyToIds).toEqual([])
  })
})
