/**
 * Invites that point at a voice channel.
 *
 * "Invite to Voice" is a normal server invite with a destination attached:
 * follow it and you should not merely land in the server, you should land in
 * the room the person who sent it is sitting in. The server's whole job here
 * is to carry that destination honestly — through minting, through preview,
 * and through the join — and to keep it from becoming a way to point at
 * something the invite has no business naming.
 *
 * Two failure modes drive most of these tests:
 *
 * 1. **The channel can outlive neither the server nor the invite.** A voice
 *    channel deleted after the invite was sent must degrade to a plain server
 *    invite, not a 500 and not a refusal. The invite's primary promise is the
 *    server; the channel is the bonus.
 *
 * 2. **A channel from another server must be refused at mint time**, exactly
 *    as `updateChannel` refuses a category belonging to somewhere else. An
 *    invite that quietly stored a foreign channel id would hand the joiner a
 *    room they cannot see, in a server they are not in.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Channel } from '../models/Channel'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser, name = 'EA') =>
  (await app().post('/servers').set(auth(u)).send({ name })).body.server
const mkVoice = async (u: TestUser, sid: string, name = 'General') =>
  (await app().post(`/servers/${sid}/channels`).set(auth(u)).send({ type: 'voice', name })).body.channel
const mkInvite = (u: TestUser, sid: string, body: Record<string, unknown> = {}) =>
  app().post(`/servers/${sid}/invites`).set(auth(u)).send(body)

describe('minting an invite that names a voice channel', () => {
  it('carries the channel', async () => {
    const a = await register()
    const s = await mkServer(a)
    const v = await mkVoice(a, s.id)

    const res = await mkInvite(a, s.id, { channel: v.id })

    expect(res.status).toBe(201)
    expect(res.body.invite.channel).toEqual({ id: v.id, name: 'General' })
  })

  it('a plain server invite still has none', async () => {
    // The field is additive. Every existing caller sends no channel and must
    // keep getting an ordinary server invite.
    const a = await register()
    const s = await mkServer(a)

    const res = await mkInvite(a, s.id, { expiry: '7d' })

    expect(res.status).toBe(201)
    expect(res.body.invite.channel).toBeNull()
  })

  it('refuses a channel belonging to a different server', async () => {
    const a = await register()
    const mine  = await mkServer(a, 'Mine')
    const other = await mkServer(a, 'Other')
    const foreign = await mkVoice(a, other.id)

    const res = await mkInvite(a, mine.id, { channel: foreign.id })

    expect(res.status).toBe(400)
  })

  it('refuses a text channel — you cannot be "in" one', async () => {
    const a = await register()
    const s = await mkServer(a)
    const text = (await app().post(`/servers/${s.id}/channels`).set(auth(a))
      .send({ type: 'text', name: 'general' })).body.channel

    const res = await mkInvite(a, s.id, { channel: text.id })

    expect(res.status).toBe(400)
  })

  it('refuses an id that is not a channel at all, rather than casting it', async () => {
    const a = await register()
    const s = await mkServer(a)

    expect((await mkInvite(a, s.id, { channel: 'not-an-id' })).status).toBe(400)
  })
})

describe('previewing one', () => {
  it('names the voice channel', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const v = await mkVoice(a, s.id, 'Lounge')
    const inv = (await mkInvite(a, s.id, { channel: v.id })).body.invite

    const res = await app().get(`/invites/${inv.code}`).set(auth(b))

    expect(res.status).toBe(200)
    expect(res.body.channel).toEqual({ id: v.id, name: 'Lounge' })
  })

  it('says null for a plain invite', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = (await mkInvite(a, s.id)).body.invite

    const res = await app().get(`/invites/${inv.code}`).set(auth(b))

    expect(res.body.channel ?? null).toBeNull()
  })

  it('says null once the channel has been deleted', async () => {
    // Preview is what the card renders before anyone commits, so it must not
    // promise a room that is gone.
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const v = await mkVoice(a, s.id)
    const inv = (await mkInvite(a, s.id, { channel: v.id })).body.invite
    await Channel.deleteOne({ _id: v.id })

    const res = await app().get(`/invites/${inv.code}`).set(auth(b))

    expect(res.status).toBe(200)
    expect(res.body.channel ?? null).toBeNull()
  })
})

describe('joining through one', () => {
  it('hands back the channel so the client knows where to land', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const v = await mkVoice(a, s.id, 'Lounge')
    const inv = (await mkInvite(a, s.id, { channel: v.id })).body.invite

    const res = await app().post(`/invites/${inv.code}`).set(auth(b))

    expect(res.status).toBe(200)
    expect(res.body.joined).toBe(true)
    expect(res.body.channel).toEqual({ id: v.id, name: 'Lounge' })
  })

  it('an already-member still gets the channel back', async () => {
    // There is no join to perform, but the destination is the whole point of
    // the link — someone already in the server who clicks "join voice" must
    // still be taken to the room.
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const v = await mkVoice(a, s.id)
    const inv = (await mkInvite(a, s.id, { channel: v.id })).body.invite

    await app().post(`/invites/${inv.code}`).set(auth(b))       // first join
    const res = await app().post(`/invites/${inv.code}`).set(auth(b))  // again

    expect(res.status).toBe(200)
    expect(res.body.joined).toBe(false)
    expect(res.body.channel).toEqual({ id: v.id, name: expect.any(String) })
  })

  it('still joins the server when the channel is gone', async () => {
    // The degradation that matters: the invite keeps its primary promise.
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const v = await mkVoice(a, s.id)
    const inv = (await mkInvite(a, s.id, { channel: v.id })).body.invite
    await Channel.deleteOne({ _id: v.id })

    const res = await app().post(`/invites/${inv.code}`).set(auth(b))

    expect(res.status).toBe(200)
    expect(res.body.joined).toBe(true)
    expect(res.body.channel ?? null).toBeNull()
  })

  it('a plain invite still returns no channel', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = (await mkInvite(a, s.id)).body.invite

    const res = await app().post(`/invites/${inv.code}`).set(auth(b))

    expect(res.body.joined).toBe(true)
    expect(res.body.channel ?? null).toBeNull()
  })
})
