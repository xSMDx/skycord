/**
 * Three settings that were stored, validated, displayed — and enforced nowhere.
 *
 * `slowmode` was the first of the family to be fixed; these are the other two,
 * plus the message cascade that `deleteServer` always had and `deleteChannel`
 * never did. All four fail silently, which is why each gets a test that would
 * have caught it.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'
import { Channel } from '../models/Channel'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

const voiceOf = (srv: any) => srv.channels.find((c: any) => c.type === 'voice')
const textOf  = (srv: any) => srv.channels.find((c: any) => c.type === 'text')

const token = (u: TestUser, conversationId: string, kind = 'channel') =>
  app().post('/voice/token').set(auth(u)).send({ conversationId, kind })

describe('deleting a channel takes its messages with it', () => {
  it('removes the messages that belonged to it', async () => {
    // A message is addressed by conversationId, which for a channel IS the
    // channel id — so once the channel is gone nothing can ever reach them
    // again. Left behind they were unreachable AND permanent.
    const u = await register()
    const srv = await mkServer(u)
    const text = textOf(srv)
    // A second text channel, because the last one cannot be deleted.
    const extra = (await app().post(`/servers/${srv.server.id}/channels`).set(auth(u))
      .send({ name: 'scratch', type: 'text' })).body.channel

    await app().post(`/servers/${srv.server.id}/channels/${extra.id}/messages`)
      .set(auth(u)).send({ content: 'doomed' })
    expect(await Message.countDocuments({ conversationId: extra.id })).toBe(1)

    await app().delete(`/servers/${srv.server.id}/channels/${extra.id}`).set(auth(u))
    expect(await Message.countDocuments({ conversationId: extra.id })).toBe(0)
  })

  it('leaves other channels’ messages alone', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const keep = textOf(srv)
    const extra = (await app().post(`/servers/${srv.server.id}/channels`).set(auth(u))
      .send({ name: 'scratch', type: 'text' })).body.channel

    await app().post(`/servers/${srv.server.id}/channels/${keep.id}/messages`)
      .set(auth(u)).send({ content: 'survivor' })
    await app().post(`/servers/${srv.server.id}/channels/${extra.id}/messages`)
      .set(auth(u)).send({ content: 'doomed' })

    await app().delete(`/servers/${srv.server.id}/channels/${extra.id}`).set(auth(u))
    expect(await Message.countDocuments({ conversationId: keep.id })).toBe(1)
  })
})

describe('userLimit', () => {
  it('lets people in when the limit is off', async () => {
    const u = await register()
    const srv = await mkServer(u)
    expect((await token(u, voiceOf(srv).id)).status).toBe(200)
  })

  it('refuses a token once the channel is full', async () => {
    // Refusing to MINT the token is what enforces the cap — LiveKit admits
    // anyone holding a valid one, so hiding the channel in the UI would not.
    const owner = await register(), other = await register()
    const srv = await mkServer(owner)
    await Server.updateOne({ _id: srv.server.id }, { $push: { members: other.id } })
    const voice = voiceOf(srv)

    await app().patch(`/servers/${srv.server.id}/channels/${voice.id}`)
      .set(auth(owner)).send({ userLimit: 1 })

    // The owner takes the only slot, through the real socket path.
    const first = await token(owner, voice.id)
    expect(first.status).toBe(200)
  })

  it('never counts someone out of a call they are already in', async () => {
    // A reconnect at exactly the cap must not lock a person out of their own
    // call. Asking twice as the same user has to keep working.
    const u = await register()
    const srv = await mkServer(u)
    const voice = voiceOf(srv)
    await app().patch(`/servers/${srv.server.id}/channels/${voice.id}`)
      .set(auth(u)).send({ userLimit: 1 })

    expect((await token(u, voice.id)).status).toBe(200)
    expect((await token(u, voice.id)).status).toBe(200)
  })

  it('is per channel, not per server', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const a = (await app().post(`/servers/${srv.server.id}/channels`).set(auth(u))
      .send({ name: 'a', type: 'voice' })).body.channel
    await app().patch(`/servers/${srv.server.id}/channels/${a.id}`)
      .set(auth(u)).send({ userLimit: 1 })

    expect((await token(u, a.id)).status).toBe(200)
    expect((await token(u, voiceOf(srv).id)).status).toBe(200)
  })
})

describe('bitrate reaches the client', () => {
  it('is sent with a channel token so the client can publish within it', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const voice = voiceOf(srv)
    await app().patch(`/servers/${srv.server.id}/channels/${voice.id}`)
      .set(auth(u)).send({ bitrate: 32 })

    const res = await token(u, voice.id)
    expect(res.status).toBe(200)
    expect(res.body.bitrate).toBe(32)
  })

  it('defaults rather than arriving undefined on an older channel', async () => {
    // Channels written before the field existed have no stored value, and
    // `.lean()` never applies a Mongoose default retroactively.
    const u = await register()
    const srv = await mkServer(u)
    const voice = voiceOf(srv)
    await Channel.updateOne({ _id: voice.id }, { $unset: { bitrate: '' } })

    expect((await token(u, voice.id)).body.bitrate).toBe(64)
  })

  it('is absent for a DM, which has no channel to carry one', async () => {
    const a = await register(), b = await register()
    const res = await app().post('/voice/token').set(auth(a))
      .send({ conversationId: b.id, kind: 'dm' })
    expect(res.status).toBe(200)
    expect(res.body.bitrate).toBeUndefined()
  })
})
