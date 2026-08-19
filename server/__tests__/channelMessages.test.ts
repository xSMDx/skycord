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
})
