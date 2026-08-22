import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { Conversation } from '../models/Conversation'
import { roomFor } from '../controllers/voiceController'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

// No join endpoint yet — tests that need a non-owner *member* seed membership
// directly against the model, same pattern as channels.test.ts.
const joinAsMember = async (sid: string, uid: string) =>
  Server.updateOne({ _id: sid }, { $push: { members: uid } })

describe('roomFor', () => {
  it('produces voice:<channelId> for a channel — never chan:<channelId>, which is the Socket.IO text room for the same id', () => {
    expect(roomFor('channel', 'abc123', 'someUser')).toBe('voice:abc123')
  })
})

describe('POST /voice/token — kind: channel', () => {
  it('mints a token for a server member requesting a voice channel', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const voice = channels.find((c: any) => c.type === 'voice')
    const res = await app().post('/voice/token').set(auth(u))
      .send({ conversationId: voice.id, kind: 'channel' })
    expect(res.status).toBe(200)
    expect(res.body.token).toEqual(expect.any(String))
    expect(res.body.url).toEqual(expect.any(String))
    expect(res.body.room).toBe(`voice:${voice.id}`)
  })

  it('mints a token for a non-owner member of the server too', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const voice = channels.find((c: any) => c.type === 'voice')
    const res = await app().post('/voice/token').set(auth(b))
      .send({ conversationId: voice.id, kind: 'channel' })
    expect(res.status).toBe(200)
    expect(res.body.room).toBe(`voice:${voice.id}`)
  })

  it('refuses a text channel with a 400 — a voice call in a text channel is not a thing', async () => {
    const u = await register()
    const { channels } = await mkServer(u)
    const text = channels.find((c: any) => c.type === 'text')
    const res = await app().post('/voice/token').set(auth(u))
      .send({ conversationId: text.id, kind: 'channel' })
    expect(res.status).toBe(400)
  })

  // loadServer (the shared authorisation boundary this mirrors) answers 403,
  // not 404, for a stranger who never joined — matched here rather than
  // inventing a different status for the same question.
  it('403s a non-member of the server that owns the channel', async () => {
    const a = await register(), b = await register()
    const { channels } = await mkServer(a)
    const voice = channels.find((c: any) => c.type === 'voice')
    const res = await app().post('/voice/token').set(auth(b))
      .send({ conversationId: voice.id, kind: 'channel' })
    expect(res.status).toBe(403)
  })

  it('404s a nonexistent (but well-formed) channel id', async () => {
    const u = await register()
    const res = await app().post('/voice/token').set(auth(u))
      .send({ conversationId: '507f1f77bcf86cd799439011', kind: 'channel' })
    expect(res.status).toBe(404)
  })

  it('does not 500 on a malformed channel id', async () => {
    const u = await register()
    const res = await app().post('/voice/token').set(auth(u))
      .send({ conversationId: 'not-an-object-id', kind: 'channel' })
    expect(res.status).toBeLessThan(500)
  })
})

describe('POST /voice/token — kind: dm and group still work', () => {
  it('mints a token for a dm', async () => {
    const a = await register(), b = await register()
    const res = await app().post('/voice/token').set(auth(a))
      .send({ conversationId: b.id, kind: 'dm' })
    expect(res.status).toBe(200)
    expect(res.body.token).toEqual(expect.any(String))
    expect(res.body.url).toEqual(expect.any(String))
    expect(res.body.room).toEqual(expect.any(String))
  })

  it('mints a token for a group', async () => {
    const u = await register()
    // Created directly against the model, same as groupMessages.test.ts —
    // the real create-group endpoint needs friendship setup irrelevant here.
    const group = await Conversation.create({
      type: 'group', owner: u.id, members: [u.id], lastMessageAt: new Date(),
    })
    const groupId = group._id.toString()
    const res = await app().post('/voice/token').set(auth(u))
      .send({ conversationId: groupId, kind: 'group' })
    expect(res.status).toBe(200)
    expect(res.body.room).toBe(`group:${groupId}`)
  })
})
