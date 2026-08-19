import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'

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
