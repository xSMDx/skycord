import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { PERMISSIONS, serializeBits, ALL_PERMISSIONS } from '../permissions'

/**
 * What the LiveKit token actually grants.
 *
 * This is the file that proves Speak and Video are real. Everything else about
 * them — the UI badge, the disabled camera button, the resolved bits — is
 * presentation; LiveKit honours the grant baked into this JWT and nothing else.
 * So the assertions here read the token itself rather than the endpoint's own
 * summary of it, because a response field claiming `mayPublishVideo: false`
 * over a token that permits video would be exactly the class of lie this whole
 * area has been about.
 *
 * The token is DECODED, not verified. The signature is LiveKit's business; the
 * claims are ours.
 */

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

interface Grant {
  room?: string
  roomJoin?: boolean
  canPublish?: boolean
  canSubscribe?: boolean
  canPublishSources?: string[]
}

const grantOf = (jwt: string): Grant => {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
  return payload.video ?? {}
}

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'VT' })).body.server

const addVoiceServer = (u: TestUser, sid: string) =>
  app().post(`/servers/${sid}/voice-servers`).set(auth(u)).send({
    name: 'Test', url: 'wss://livekit.example.com',
    apiKey: 'APIkey123', apiSecret: 'supersecretvalue',
  })

const mkVoiceChannel = async (u: TestUser, sid: string) =>
  (await app().post(`/servers/${sid}/channels`).set(auth(u))
    .send({ name: 'Lounge', type: 'voice' })).body.channel

const everyoneRole = async (u: TestUser, sid: string) =>
  (await app().get(`/servers/${sid}/roles`).set(auth(u))).body.roles
    .find((r: any) => r.isEveryone)

/** Deny `bits` to @everyone on one channel. */
const denyOnChannel = async (u: TestUser, sid: string, cid: string, bits: bigint) => {
  const everyone = await everyoneRole(u, sid)
  return app().patch(`/servers/${sid}/channels/${cid}`).set(auth(u)).send({
    overwrites: [{ id: everyone.id, type: 'role', allow: '0', deny: serializeBits(bits) }],
  })
}

const tokenFor = (u: TestUser, cid: string) =>
  app().post('/voice/token').set(auth(u)).send({ conversationId: cid, kind: 'channel' })

/**
 * A member who holds exactly @everyone. The OWNER is useless for these tests:
 * the owner short-circuit in resolve() hands them ALL_PERMISSIONS regardless of
 * any overwrite, so a denial would appear not to work and the test would be
 * measuring the short-circuit instead of the denial.
 */
const plainMember = async (sid: string) => {
  const m = await register()
  await Server.updateOne({ _id: sid }, { $push: { members: m.id } })
  return m
}

describe('the voice token carries the channel permissions', () => {
  it('grants everything to a member the channel does not restrict', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    await addVoiceServer(owner, server.id)
    const ch = await mkVoiceChannel(owner, server.id)
    const member = await plainMember(server.id)

    const res = await tokenFor(member, ch.id)
    expect(res.status).toBe(200)
    const g = grantOf(res.body.token)
    expect(g.canPublish).toBe(true)
    expect(g.canSubscribe).toBe(true)
    // Absent, not empty: canPublishSources SUPERSEDES canPublish in LiveKit, so
    // an empty array here would forbid every source.
    expect(g.canPublishSources).toBeUndefined()
    expect(res.body.mayPublishAudio).toBe(true)
    expect(res.body.mayPublishVideo).toBe(true)
  })

  it('narrows the token to video when Speak is denied on the channel', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    await addVoiceServer(owner, server.id)
    const ch = await mkVoiceChannel(owner, server.id)
    const member = await plainMember(server.id)
    await denyOnChannel(owner, server.id, ch.id, PERMISSIONS.Speak)

    const res = await tokenFor(member, ch.id)
    expect(res.status).toBe(200)
    const g = grantOf(res.body.token)
    expect(g.canPublish).toBe(true)
    expect(g.canPublishSources).not.toContain('microphone')
    expect(g.canPublishSources).toContain('camera')
    expect(res.body.mayPublishAudio).toBe(false)
    expect(res.body.mayPublishVideo).toBe(true)
  })

  it('narrows the token to the microphone when Video is denied', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    await addVoiceServer(owner, server.id)
    const ch = await mkVoiceChannel(owner, server.id)
    const member = await plainMember(server.id)
    await denyOnChannel(owner, server.id, ch.id, PERMISSIONS.Video)

    const res = await tokenFor(member, ch.id)
    const g = grantOf(res.body.token)
    expect(g.canPublishSources).toEqual(['microphone'])
    expect(res.body.mayPublishVideo).toBe(false)
  })

  it('refuses publishing entirely when both are denied', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    await addVoiceServer(owner, server.id)
    const ch = await mkVoiceChannel(owner, server.id)
    const member = await plainMember(server.id)
    await denyOnChannel(owner, server.id, ch.id, PERMISSIONS.Speak | PERMISSIONS.Video)

    const res = await tokenFor(member, ch.id)
    const g = grantOf(res.body.token)
    expect(g.canPublish).toBe(false)
    // Still allowed to listen. A channel someone may Connect to but not speak
    // in is a lecture, not a locked door.
    expect(g.canSubscribe).toBe(true)
  })

  /*
   * UseVoiceActivity must NEVER reach the publish grant. LiveKit cannot express
   * push-to-talk, so the only way to "enforce" it in a token would be to revoke
   * publishing outright — which silences the person instead of gating how they
   * transmit. The assertions at the end of this test are what stop a future
   * refactor from making that trade by accident.
   */
  it('tells the client push-to-talk is mandatory when UseVoiceActivity is denied', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    await addVoiceServer(owner, server.id)
    const ch = await mkVoiceChannel(owner, server.id)
    const member = await plainMember(server.id)
    await denyOnChannel(owner, server.id, ch.id, PERMISSIONS.UseVoiceActivity)

    const res = await tokenFor(member, ch.id)
    expect(res.body.voiceActivity).toBe(false)
    // The publish grant is untouched — they may still speak, just not hands-free.
    const g = grantOf(res.body.token)
    expect(g.canPublish).toBe(true)
    expect(g.canPublishSources).toBeUndefined()
  })
})

describe('server mute reaches the token', () => {
  it('removes the microphone from a muted member who may still film', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    await addVoiceServer(owner, server.id)
    const ch = await mkVoiceChannel(owner, server.id)
    const member = await plainMember(server.id)

    await app().patch(`/servers/${server.id}/members/${member.id}/voice`)
      .set(auth(owner)).send({ mute: true })

    const res = await tokenFor(member, ch.id)
    const g = grantOf(res.body.token)
    expect(g.canPublish).toBe(true)
    expect(g.canPublishSources).not.toContain('microphone')
    expect(g.canPublishSources).not.toContain('screen_share_audio')
    expect(g.canPublishSources).toContain('camera')
    expect(res.body.serverMute).toBe(true)
  })

  it('cuts a deafened member off from both directions', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    await addVoiceServer(owner, server.id)
    const ch = await mkVoiceChannel(owner, server.id)
    const member = await plainMember(server.id)

    await app().patch(`/servers/${server.id}/members/${member.id}/voice`)
      .set(auth(owner)).send({ deafen: true })

    const g = grantOf((await tokenFor(member, ch.id)).body.token)
    expect(g.canPublish).toBe(false)
    expect(g.canSubscribe).toBe(false)
  })

  it('does not restrict the owner, whose permissions cannot be overwritten', async () => {
    // Documents the asymmetry rather than asserting a policy: resolve() hands
    // the owner every bit before any overwrite is consulted.
    const owner = await register()
    const server = await mkServer(owner)
    await addVoiceServer(owner, server.id)
    const ch = await mkVoiceChannel(owner, server.id)
    await denyOnChannel(owner, server.id, ch.id, PERMISSIONS.Speak | PERMISSIONS.Video)

    const g = grantOf((await tokenFor(owner, ch.id)).body.token)
    expect(g.canPublish).toBe(true)
    expect(g.canPublishSources).toBeUndefined()
  })
})

describe('a DM token is never narrowed', () => {
  it('grants everything, because no channel exists to take anything away', async () => {
    const a = await register(), b = await register()
    const server = await mkServer(a)
    await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
    await addVoiceServer(a, server.id)

    const res = await app().post('/voice/token').set(auth(a))
      .send({ conversationId: b.id, kind: 'dm' })
    expect(res.status).toBe(200)
    const g = grantOf(res.body.token)
    expect(g.canPublish).toBe(true)
    expect(g.canSubscribe).toBe(true)
    expect(g.canPublishSources).toBeUndefined()
    // The permission fields are channel-only, so a DM carries none of them and
    // the client reads their absence as unrestricted.
    expect(res.body.mayPublishAudio).toBeUndefined()
    expect(res.body.voiceActivity).toBeUndefined()
  })
})

/** Sanity: the bit constants this file leans on are the ones the server uses. */
describe('the permissions under test exist', () => {
  it('has Speak, Video and UseVoiceActivity inside the full set', () => {
    for (const p of [PERMISSIONS.Speak, PERMISSIONS.Video, PERMISSIONS.UseVoiceActivity]) {
      expect((ALL_PERMISSIONS & p) === p).toBe(true)
    }
  })
})
