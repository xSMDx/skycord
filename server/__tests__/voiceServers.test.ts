/**
 * Per-server LiveKit servers.
 *
 * The properties worth pinning are the ones that would be quietly wrong: a
 * secret leaking into a response, a secret decrypting to something other than
 * what was typed, and a channel resolving to a media server its owner never
 * offered it.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { VoiceServer, MAX_VOICE_SERVERS } from '../models/VoiceServer'
import { Channel } from '../models/Channel'
import { seal, open, hint } from '../utils/secretBox'
import { resolveForChannel } from '../utils/resolveVoiceServer'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

const add = (u: TestUser, sid: string, over: Record<string, unknown> = {}) =>
  app().post(`/servers/${sid}/voice-servers`).set(auth(u)).send({
    name: 'Frankfurt', url: 'wss://livekit.example.com',
    apiKey: 'APIkey123', apiSecret: 'supersecretvalue', ...over,
  })

describe('secretBox', () => {
  it('round-trips', () => {
    const s = 'supersecretvalue'
    expect(open(seal(s))).toBe(s)
  })

  it('produces a different ciphertext each time', () => {
    // A fresh IV per encryption — identical output would leak that two servers
    // share a secret.
    expect(seal('same')).not.toBe(seal('same'))
  })

  it('refuses a tampered value rather than returning garbage', () => {
    const sealed = seal('supersecretvalue')
    const parts = sealed.split('.')
    parts[3] = Buffer.from('tampered').toString('base64url')
    expect(open(parts.join('.'))).toBeNull()
  })

  it('returns null for nonsense instead of throwing', () => {
    expect(open('not-sealed')).toBeNull()
    expect(open('')).toBeNull()
  })

  it('hints without revealing', () => {
    expect(hint('supersecretvalue')).toBe('••••alue')
    expect(hint('ab')).toBe('••••')
  })
})

describe('POST /servers/:sid/voice-servers', () => {
  it('registers one and never returns the secret', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const res = await add(u, srv.server.id)

    expect(res.status).toBe(201)
    expect(res.body.voiceServer.name).toBe('Frankfurt')
    // The whole response body, not just the field — a secret leaking through
    // some other key is the failure this is actually guarding against.
    expect(JSON.stringify(res.body)).not.toContain('supersecretvalue')
    expect(res.body.voiceServer.secretHint).toBe('••••alue')
  })

  it('stores the secret encrypted, not in the clear', async () => {
    const u = await register()
    const srv = await mkServer(u)
    await add(u, srv.server.id)

    const row = await VoiceServer.findOne({}).select('+apiSecret').lean()
    expect(row!.apiSecret).not.toBe('supersecretvalue')
    expect(row!.apiSecret.startsWith('v1.')).toBe(true)
    expect(open(row!.apiSecret)).toBe('supersecretvalue')
  })

  it('omits the secret unless explicitly selected', async () => {
    const u = await register()
    const srv = await mkServer(u)
    await add(u, srv.server.id)
    // select:false — a forgotten .select() must not leak it.
    const row = await VoiceServer.findOne({}).lean()
    expect((row as any).apiSecret).toBeUndefined()
  })

  it('the first one becomes the default', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const res = await add(u, srv.server.id)
    expect(res.body.voiceServer.isDefault).toBe(true)
  })

  it('a new default demotes the old one', async () => {
    const u = await register()
    const srv = await mkServer(u)
    await add(u, srv.server.id, { name: 'A' })
    await add(u, srv.server.id, { name: 'B', isDefault: true })

    const rows = await VoiceServer.find({}).sort({ name: 1 }).lean()
    expect(rows.map(r => [r.name, r.isDefault])).toEqual([['A', false], ['B', true]])
  })

  it('rejects a plaintext ws:// URL that is not localhost', async () => {
    const u = await register()
    const srv = await mkServer(u)
    // A page on HTTPS cannot open ws:// to a remote host — storing it would
    // save a value that fails in every browser.
    const res = await add(u, srv.server.id, { url: 'ws://livekit.example.com' })
    expect(res.status).toBe(400)
  })

  it('allows ws://localhost, which is how you test with Docker', async () => {
    const u = await register()
    const srv = await mkServer(u)
    expect((await add(u, srv.server.id, { url: 'ws://localhost:7880' })).status).toBe(201)
  })

  it('rejects a non-websocket URL', async () => {
    const u = await register()
    const srv = await mkServer(u)
    expect((await add(u, srv.server.id, { url: 'https://livekit.example.com' })).status).toBe(400)
  })

  it('refuses a duplicate name, case-insensitively', async () => {
    const u = await register()
    const srv = await mkServer(u)
    await add(u, srv.server.id, { name: 'Frankfurt' })
    expect((await add(u, srv.server.id, { name: 'frankfurt' })).status).toBe(400)
  })

  it('caps the list', async () => {
    const u = await register()
    const srv = await mkServer(u)
    for (let i = 0; i < MAX_VOICE_SERVERS; i++) await add(u, srv.server.id, { name: `s${i}` })
    expect((await add(u, srv.server.id, { name: 'one-too-many' })).status).toBe(400)
  })

  it('only the owner can add one', async () => {
    const owner = await register()
    const srv = await mkServer(owner)
    const other = await register()
    expect((await add(other, srv.server.id)).status).toBe(403)
  })
})

describe('PATCH / DELETE', () => {
  it('renaming does not wipe the secret', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const { body } = await add(u, srv.server.id)

    await app().patch(`/servers/${srv.server.id}/voice-servers/${body.voiceServer.id}`)
      .set(auth(u)).send({ name: 'Frankfurt 2' })

    const row = await VoiceServer.findById(body.voiceServer.id).select('+apiSecret').lean()
    expect(open(row!.apiSecret)).toBe('supersecretvalue')
  })

  it('deleting clears channels that pointed at it', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const { body } = await add(u, srv.server.id)
    const voice = srv.channels.find((c: any) => c.type === 'voice')

    await Channel.updateOne({ _id: voice.id }, { voiceServer: body.voiceServer.id })
    await app().delete(`/servers/${srv.server.id}/voice-servers/${body.voiceServer.id}`).set(auth(u))

    expect((await Channel.findById(voice.id).lean())!.voiceServer).toBeNull()
  })

  it('deleting the default promotes another', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const first  = (await add(u, srv.server.id, { name: 'A' })).body.voiceServer
    await add(u, srv.server.id, { name: 'B' })

    await app().delete(`/servers/${srv.server.id}/voice-servers/${first.id}`).set(auth(u))

    // Otherwise a server has entries but no default, and silently falls back
    // to the instance while the owner looks at a list of their own servers.
    const rows = await VoiceServer.find({}).lean()
    expect(rows).toHaveLength(1)
    expect(rows[0].isDefault).toBe(true)
  })

  it('cannot touch another server\'s entry by id', async () => {
    const a = await register()
    const srvA = await mkServer(a)
    const { body } = await add(a, srvA.server.id)

    const b = await register()
    const srvB = await mkServer(b)
    // Owner of B, but the id belongs to A — scoped queries make this a 404.
    const res = await app().delete(`/servers/${srvB.server.id}/voice-servers/${body.voiceServer.id}`).set(auth(b))
    expect(res.status).toBe(404)
    expect(await VoiceServer.countDocuments({})).toBe(1)
  })
})

describe('resolution', () => {
  it("a channel pointing at another server's entry does not use it", async () => {
    const a = await register()
    const srvA = await mkServer(a)
    const foreign = (await add(a, srvA.server.id)).body.voiceServer

    const b = await register()
    const srvB = await mkServer(b)

    // resolveForChannel scopes the lookup by guild, so B asking for A's entry
    // falls through rather than minting a token against a media server B was
    // never offered — which would let any owner route another server's audio
    // through a box they control just by knowing an id.
    const resolved = await resolveForChannel(srvB.server.id as any, foreign.id as any)
    expect(resolved?.id).not.toBe(foreign.id)
  })

  it('falls back to the guild default when the channel names none', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const added = (await add(u, srv.server.id)).body.voiceServer

    const resolved = await resolveForChannel(srv.server.id as any, null)
    expect(resolved?.id).toBe(added.id)
    expect(resolved?.apiSecret).toBe('supersecretvalue')   // decrypted for use
  })
})
