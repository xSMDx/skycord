/**
 * Where a call actually lands.
 *
 * The failure this file exists to prevent is silent: two people in one DM
 * minting tokens against two DIFFERENT LiveKit servers, joining rooms of the
 * same name on each, and hearing nothing while the UI shows a call in
 * progress. Nothing errors, nothing logs — the call is simply dead. So the
 * property under test is agreement, not correctness of any single answer.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { Conversation } from '../models/Conversation'
import { roomFor } from '../controllers/voiceController'
import { getCallVoiceServer } from '../sockets/chatSocket'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

const addVoiceServer = (u: TestUser, sid: string, name = 'Frankfurt') =>
  app().post(`/servers/${sid}/voice-servers`).set(auth(u)).send({
    name, url: 'wss://livekit.example.com', apiKey: 'APIkey123', apiSecret: 'supersecretvalue',
  })

const token = (u: TestUser, conversationId: string, kind: string, voiceServerId?: string | null) =>
  app().post('/voice/token').set(auth(u)).send({ conversationId, kind, voiceServerId })

const move = (u: TestUser, conversationId: string, kind: string, voiceServerId: string | null) =>
  app().post('/voice/move').set(auth(u)).send({ conversationId, kind, voiceServerId })

describe('DM calls agree on one media server', () => {
  it('the second caller is handed what the first one fixed, not their own preference', async () => {
    const a = await register(), b = await register()
    const srv = await mkServer(a)
    await Server.updateOne({ _id: srv.server.id }, { $push: { members: b.id } })
    const vs = (await addVoiceServer(a, srv.server.id)).body.voiceServer

    // A dials asking for the registered server; B dials asking for nothing.
    const first  = await token(a, b.id, 'dm', vs.id)
    const second = await token(b, a.id, 'dm')

    expect(first.body.voiceServer.id).toBe(vs.id)
    expect(second.body.voiceServer.id).toBe(vs.id)
  })

  it('and the other way round — whoever is FIRST decides, not whoever has a preference', async () => {
    const a = await register(), b = await register()
    const srv = await mkServer(a)
    await Server.updateOne({ _id: srv.server.id }, { $push: { members: b.id } })
    const vs = (await addVoiceServer(a, srv.server.id)).body.voiceServer

    const first  = await token(a, b.id, 'dm')          // no preference — instance
    const second = await token(b, a.id, 'dm', vs.id)   // asks for the registered one

    expect(first.body.voiceServer.id).toBeNull()
    // Refused, deliberately: honouring it would move A without telling them.
    expect(second.body.voiceServer.id).toBeNull()
  })

  it('rejoining does not relocate a call that is already under way', async () => {
    const a = await register(), b = await register()
    const srv = await mkServer(a)
    await Server.updateOne({ _id: srv.server.id }, { $push: { members: b.id } })
    const vs = (await addVoiceServer(a, srv.server.id)).body.voiceServer

    await token(a, b.id, 'dm')
    const again = await token(a, b.id, 'dm', vs.id)
    expect(again.body.voiceServer.id).toBeNull()
  })

  it('a preference naming a server the caller is not in is ignored', async () => {
    const a = await register(), stranger = await register()
    const theirs = await mkServer(stranger)
    const vs = (await addVoiceServer(stranger, theirs.server.id)).body.voiceServer

    const res = await token(a, stranger.id, 'dm', vs.id)
    expect(res.body.voiceServer.id).toBeNull()
  })
})

describe('POST /voice/move', () => {
  it('moves the call and re-answers every later join with the new server', async () => {
    const a = await register(), b = await register()
    const srv = await mkServer(a)
    await Server.updateOne({ _id: srv.server.id }, { $push: { members: b.id } })
    const vs = (await addVoiceServer(a, srv.server.id)).body.voiceServer

    await token(a, b.id, 'dm')                        // fixed on the instance
    const moved = await move(b, a.id, 'dm', vs.id)    // the OTHER person moves it
    expect(moved.status).toBe(200)
    expect(moved.body.voiceServer.id).toBe(vs.id)

    expect((await token(a, b.id, 'dm')).body.voiceServer.id).toBe(vs.id)
    expect(getCallVoiceServer(roomFor('dm', b.id, a.id))).toBe(vs.id)
  })

  it('refuses a channel — that server is a channel setting, not a call control', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const voice = srv.channels.find((c: any) => c.type === 'voice')
    expect((await move(u, voice.id, 'channel', null)).status).toBe(400)
  })

  it('refuses a group the caller is not in', async () => {
    const a = await register(), b = await register(), c = await register()
    // Seeded against the model, the same way groupMessages.test.ts does it.
    const group = await Conversation.create({
      type: 'group', owner: a.id, members: [a.id, b.id], lastMessageAt: new Date(),
    })
    expect((await move(c, group._id.toString(), 'group', null)).status).toBe(403)
  })

  it('degrades to the instance rather than failing when the target is unusable', async () => {
    const a = await register(), b = await register()
    await token(a, b.id, 'dm')
    const res = await move(a, b.id, 'dm', '6a9469cb2a3371962df8359f')
    expect(res.status).toBe(200)
    expect(res.body.voiceServer.id).toBeNull()
  })
})
