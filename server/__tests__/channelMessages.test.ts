import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body
const joinAsMember = async (sid: string, u: TestUser) =>
  Server.updateOne({ _id: sid }, { $push: { members: u.id } })
const textOf = (channels: any[]) => channels.find((c: any) => c.type === 'text')

describe('POST /servers/:sid/channels/:cid/messages', () => {
  it('posts a message and returns it resolved', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const res = await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(u)).send({ content: 'hello channel' })
    expect(res.status).toBe(201)
    expect(res.body.message.content).toBe('hello channel')
    expect(res.body.message.conversationId).toBe(c.id)
    expect(res.body.message.kind).toBe('channel')
    expect(res.body.message.authorId).toBe(u.id)
  })

  it('takes the author name from the account, never the body', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const res = await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(u)).send({ content: 'x', authorName: 'Skycord System' })
    expect(res.status).toBe(201)
    expect(res.body.message.authorName).toBe(u.username)
  })

  it('rejects empty content', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/channels/${textOf(channels).id}/messages`)
      .set(auth(u)).send({ content: '   ' })
    expect(res.status).toBe(400)
  })

  it('refuses to post into a voice channel', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const voice = channels.find((c: any) => c.type === 'voice')
    const res = await app().post(`/servers/${server.id}/channels/${voice.id}/messages`)
      .set(auth(u)).send({ content: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/voice/i)
  })

  it('403s someone who is not a member', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    const res = await app().post(`/servers/${server.id}/channels/${textOf(channels).id}/messages`)
      .set(auth(b)).send({ content: 'x' })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/not a member/i)
  })

  it('lets any member post, not only the owner', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await joinAsMember(server.id, b)
    const res = await app().post(`/servers/${server.id}/channels/${textOf(channels).id}/messages`)
      .set(auth(b)).send({ content: 'from a member' })
    expect(res.status).toBe(201)
  })

  it('populates replyTo for a reply targeting a message in the same channel', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const original = await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(u)).send({ content: 'the original message' })
    const originalId = original.body.message._id

    const res = await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(u)).send({ content: 'replying', replyToIds: [originalId] })

    expect(res.status).toBe(201)
    expect(res.body.message.replyTo).toHaveLength(1)
    expect(res.body.message.replyTo[0]).toMatchObject({
      id: originalId,
      author: u.username,
      content: 'the original message',
    })
  })

  it('drops a reply targeting a message from a different channel in the same server', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const other = (await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: 'second', type: 'text' })).body.channel

    const secret = await app().post(`/servers/${server.id}/channels/${other.id}/messages`)
      .set(auth(u)).send({ content: 'secret-in-other-channel' })
    const secretId = secret.body.message._id

    const res = await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(u)).send({ content: 'replying', replyToIds: [secretId] })

    expect(res.status).toBe(201)
    expect(res.body.message.replyTo).toEqual([])
    expect(JSON.stringify(res.body)).not.toContain('secret-in-other-channel')
  })

  it('drops a reply targeting a message from a DM the caller is not part of', async () => {
    const u = await register()
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)

    // Created directly with the Message model — the point is a row that lives
    // in a DM conversationId the caller has no part in, without needing to
    // route it through the DM endpoints.
    const dmMsg = await Message.create({
      conversationId: [a.id, b.id].sort().join('_'),
      kind:           'dm',
      authorId:       a.id,
      authorName:     a.username,
      content:        'secret-dm-content',
      replyToIds:     [],
    })

    const res = await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(u)).send({ content: 'replying', replyToIds: [dmMsg._id.toString()] })

    expect(res.status).toBe(201)
    expect(res.body.message.replyTo).toEqual([])
    expect(JSON.stringify(res.body)).not.toContain('secret-dm-content')
  })

  // The POST response has always dropped these on the floor correctly — the
  // bug is that the handler still WROTE the raw, unvalidated ids to
  // replyToIds on the stored document. resolveMessages has no conversation
  // filter on its $in lookup, so a later GET of this same channel resolves
  // the other conversation's author + content snippet right back in, for
  // every member, permanently. Only a persistence-level check (create, then
  // read back) can catch this — asserting on the POST response alone is
  // exactly why it survived the earlier fix.
  it('does not persist reply ids that failed channel-scope validation, so a later GET cannot resolve them', async () => {
    const u = await register()
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const other = (await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: 'second', type: 'text' })).body.channel

    const secret = await app().post(`/servers/${server.id}/channels/${other.id}/messages`)
      .set(auth(u)).send({ content: 'secret-in-other-channel' })
    const secretId = secret.body.message._id

    const dmMsg = await Message.create({
      conversationId: [a.id, b.id].sort().join('_'),
      kind:           'dm',
      authorId:       a.id,
      authorName:     a.username,
      content:        'secret-dm-content',
      replyToIds:     [],
    })

    const posted = await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(u)).send({ content: 'replying', replyToIds: [secretId, dmMsg._id.toString()] })
    expect(posted.status).toBe(201)
    expect(posted.body.message.replyTo).toEqual([]) // response was already clean

    const res = await app().get(`/servers/${server.id}/channels/${c.id}/messages`).set(auth(u))
    expect(res.status).toBe(200)
    const body = JSON.stringify(res.body)
    expect(body).not.toContain('secret-in-other-channel')
    expect(body).not.toContain('secret-dm-content')
  })
})

describe('GET /servers/:sid/channels/:cid/messages', () => {
  it('returns messages oldest-first with live author data', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    await app().post(`/servers/${server.id}/channels/${c.id}/messages`).set(auth(u)).send({ content: 'one' })
    await app().post(`/servers/${server.id}/channels/${c.id}/messages`).set(auth(u)).send({ content: 'two' })

    const res = await app().get(`/servers/${server.id}/channels/${c.id}/messages`).set(auth(u))
    expect(res.status).toBe(200)
    expect(res.body.messages.map((m: any) => m.content)).toEqual(['one', 'two'])
    // resolveMessages attaches live author data rather than the frozen snapshot.
    expect(res.body.messages[0]).toHaveProperty('authorAvatarCrop')
  })

  it('does not leak another channel\'s messages', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const other = (await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: 'second', type: 'text' })).body.channel
    await app().post(`/servers/${server.id}/channels/${c.id}/messages`).set(auth(u)).send({ content: 'in first' })

    const res = await app().get(`/servers/${server.id}/channels/${other.id}/messages`).set(auth(u))
    expect(res.body.messages).toHaveLength(0)
  })

  it('403s a non-member', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    const res = await app().get(`/servers/${server.id}/channels/${textOf(channels).id}/messages`).set(auth(b))
    expect(res.status).toBe(403)
  })

  // Exercises resolveMessages' own conversation scoping directly (the POST
  // response's replyTo is built by sendChannelMessage's separate inline
  // query, not by resolveMessages) — a regression here would only show up on
  // a later GET, exactly like the DM/group leak this mirrors.
  it('resolveMessages scopes replyTo to this channel on GET, and still resolves a same-channel reply', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)
    const other = (await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: 'second', type: 'text' })).body.channel

    const secret = await app().post(`/servers/${server.id}/channels/${other.id}/messages`)
      .set(auth(u)).send({ content: 'secret-in-other-channel-get' })
    const secretId = secret.body.message._id

    const original = await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(u)).send({ content: 'the original' })
    const originalId = original.body.message._id

    await Message.create({
      conversationId: c.id, kind: 'channel', authorId: u.id, authorName: u.username,
      content: 'poisoned reply', replyToIds: [secretId, originalId],
    })

    const res = await app().get(`/servers/${server.id}/channels/${c.id}/messages`).set(auth(u))
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain('secret-in-other-channel-get')
    const msg = res.body.messages.find((m: any) => m.content === 'poisoned reply')
    expect(msg.replyTo).toEqual([{ id: originalId, author: u.username, content: 'the original' }])
  })

  // getChannelMessages loaded an entire channel's history unbounded, and
  // resolveMessages then did an unbounded $in across every reply target in
  // that history. Pagination must match the DM path's contract exactly
  // (server/controllers/messagesController.ts getDMMessages): `limit`
  // defaults to 50 and caps at 100, `before` filters createdAt < that value,
  // and the response stays oldest-first within the returned page.
  it('defaults to a 50-message page and pages backward with before, matching the DM contract', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const c = textOf(channels)

    // Created directly against the model so timestamps are explicit and
    // strictly increasing — 55 sequential REST posts would be both slow and
    // vulnerable to two calls landing in the same millisecond.
    const base = Date.now() - 200_000
    for (let i = 0; i < 55; i++) {
      await Message.create({
        conversationId: c.id, kind: 'channel', authorId: u.id, authorName: u.username,
        content: `m${i}`, replyToIds: [], createdAt: new Date(base + i * 1000),
      })
    }

    const page1 = await app().get(`/servers/${server.id}/channels/${c.id}/messages`).set(auth(u))
    expect(page1.status).toBe(200)
    expect(page1.body.messages).toHaveLength(50)
    // Oldest-first within the page: the 50 most recent messages, m5..m54.
    expect(page1.body.messages[0].content).toBe('m5')
    expect(page1.body.messages[49].content).toBe('m54')

    const oldestInPage1 = page1.body.messages[0].createdAt
    const page2 = await app().get(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(u)).query({ before: oldestInPage1 })
    expect(page2.status).toBe(200)
    expect(page2.body.messages.map((m: any) => m.content)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
  })
})
