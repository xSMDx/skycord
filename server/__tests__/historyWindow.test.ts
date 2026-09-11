import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'
import { Role } from '../models/Role'
import { Conversation } from '../models/Conversation'
import { dmConvId } from '../controllers/messagesController'
import { PERMISSIONS } from '../permissions'

/**
 * Paging a conversation's history.
 *
 * The endpoints paged by `createdAt < before` alone, so two messages written in
 * the same millisecond could straddle a page boundary and one was never
 * returned. They now share one cursor contract, ordered by (createdAt, _id).
 */

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'HW' })).body
const textOf = (channels: any[]) => channels.find((c: any) => c.type === 'text')

/**
 * Raw inserts, bypassing Mongoose: the tests need exact `createdAt` values,
 * including two identical ones, and `timestamps: true` would stamp its own.
 */
const seed = async (conversationId: string, kind: string, authorId: string, times: Date[], label = 'm') => {
  const docs = times.map((t, i) => ({
    _id: new Types.ObjectId(), conversationId, kind,
    authorId: new Types.ObjectId(authorId), authorName: 'seed', authorAvatar: null, authorAvatarCrop: null,
    content: `${label}${i}`, systemType: null, reactions: [], pinned: false, mentionsEveryone: false,
    edited: false, replyTo: null, replyToIds: [], createdAt: t, updatedAt: t,
  }))
  await Message.collection.insertMany(docs)
  return docs
}
const seconds = (n: number, from = Date.UTC(2026, 0, 1)) =>
  Array.from({ length: n }, (_, i) => new Date(from + i * 1000))
const contents = (res: any) => res.body.messages.map((m: any) => m.content)

const channelUrl = (sid: string, cid: string, qs = '') => `/servers/${sid}/channels/${cid}/messages${qs}`

describe('channel history', () => {
  it('returns the newest page oldest-first, and says there is more above', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    await seed(c.id, 'channel', u.id, seconds(60))

    const res = await app().get(channelUrl(server.id, c.id)).set(auth(u))
    expect(res.status).toBe(200)
    expect(contents(res)).toEqual(Array.from({ length: 50 }, (_, i) => `m${i + 10}`))
    expect(res.body.hasOlder).toBe(true)
    expect(res.body.hasNewer).toBe(false)
  })

  it('pages older by message id, to the very first message', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const docs = await seed(c.id, 'channel', u.id, seconds(60))

    const res = await app().get(channelUrl(server.id, c.id, `?before=${docs[10]._id}`)).set(auth(u))
    expect(contents(res)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i}`))
    expect(res.body.hasOlder).toBe(false)
  })

  it('keeps two messages from the same millisecond apart at a page boundary', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const at = new Date(Date.UTC(2026, 0, 1))
    const docs = await seed(c.id, 'channel', u.id, [at, at, at])

    const first = await app().get(channelUrl(server.id, c.id, '?limit=2')).set(auth(u))
    expect(contents(first)).toEqual(['m1', 'm2'])
    expect(first.body.hasOlder).toBe(true)

    const next = await app().get(channelUrl(server.id, c.id, `?limit=2&before=${docs[1]._id}`)).set(auth(u))
    expect(contents(next)).toEqual(['m0'])
    expect(next.body.hasOlder).toBe(false)
  })

  it('loads around a message with the target in the middle', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const docs = await seed(c.id, 'channel', u.id, seconds(21))

    const res = await app().get(channelUrl(server.id, c.id, `?limit=5&around=${docs[10]._id}`)).set(auth(u))
    expect(contents(res)).toEqual(['m8', 'm9', 'm10', 'm11', 'm12'])
    expect(res.body.hasOlder).toBe(true)
    expect(res.body.hasNewer).toBe(true)
  })

  it('pages newer by message id, and says when it has reached the end', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const docs = await seed(c.id, 'channel', u.id, seconds(21))

    const mid = await app().get(channelUrl(server.id, c.id, `?limit=5&after=${docs[10]._id}`)).set(auth(u))
    expect(contents(mid)).toEqual(['m11', 'm12', 'm13', 'm14', 'm15'])
    expect(mid.body.hasNewer).toBe(true)

    const end = await app().get(channelUrl(server.id, c.id, `?limit=5&after=${docs[18]._id}`)).set(auth(u))
    expect(contents(end)).toEqual(['m19', 'm20'])
    expect(end.body.hasNewer).toBe(false)
  })

  it('treats a message from another conversation as one that does not exist', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    await seed(c.id, 'channel', u.id, seconds(3))
    const [elsewhere] = await seed(new Types.ObjectId().toString(), 'channel', u.id, seconds(1))

    const res = await app().get(channelUrl(server.id, c.id, `?around=${elsewhere._id}`)).set(auth(u))
    expect(res.status).toBe(404)
    expect(res.body.message).toMatch(/no longer here/i)
  })

  it('still accepts a date for before, from clients deployed before id cursors', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const docs = await seed(c.id, 'channel', u.id, seconds(20))

    const res = await app().get(channelUrl(server.id, c.id, `?before=${docs[10].createdAt.toISOString()}`)).set(auth(u))
    expect(contents(res)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i}`))
  })

  it('refuses two cursors at once', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const docs = await seed(c.id, 'channel', u.id, seconds(3))

    const res = await app().get(channelUrl(server.id, c.id, `?before=${docs[2]._id}&after=${docs[0]._id}`)).set(auth(u))
    expect(res.status).toBe(400)
  })

  it('answers a member without Read Message History with an empty window', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    const c = textOf(channels)
    await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
    await app().get(`/servers/${server.id}/roles`).set(auth(a))
    const everyone = await Role.findOne({ server: server.id, isEveryone: true })
    await app().patch(`/servers/${server.id}/channels/${c.id}`).set(auth(a)).send({
      overwrites: [{ id: everyone!._id.toString(), type: 'role', allow: '0', deny: PERMISSIONS.ReadMessageHistory.toString() }],
    })
    await seed(c.id, 'channel', a.id, seconds(5))

    const res = await app().get(channelUrl(server.id, c.id)).set(auth(b))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ messages: [], hasOlder: false, hasNewer: false })
  })
})

describe('DM and group history', () => {
  it('pages a DM with the same contract', async () => {
    const a = await register(), b = await register()
    const docs = await seed(dmConvId(a.id, b.id), 'dm', a.id, seconds(5))

    const res = await app().get(`/messages/dm/${b.id}?limit=2`).set(auth(a))
    expect(contents(res)).toEqual(['m3', 'm4'])
    expect(res.body.hasOlder).toBe(true)

    const around = await app().get(`/messages/dm/${b.id}?limit=3&around=${docs[2]._id}`).set(auth(a))
    expect(contents(around)).toEqual(['m1', 'm2', 'm3'])
  })

  it('pages a group with the same contract', async () => {
    const a = await register(), b = await register()
    const group = await Conversation.create({
      type: 'group', owner: a.id, members: [a.id, b.id], lastMessageAt: new Date(),
    })
    const docs = await seed(group._id.toString(), 'group', a.id, seconds(5))

    const res = await app().get(`/conversations/groups/${group._id}/messages?limit=2&before=${docs[3]._id}`).set(auth(b))
    expect(contents(res)).toEqual(['m1', 'm2'])
    expect(res.body.hasOlder).toBe(true)
    expect(res.body.hasNewer).toBe(true)
  })
})
