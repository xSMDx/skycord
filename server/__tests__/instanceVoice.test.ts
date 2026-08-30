/**
 * Instance-level voice servers.
 *
 * Two properties matter and neither is obvious from the happy path: a bad file
 * must stop the process rather than surface when someone joins a call, and the
 * operator's credentials must never reach a guild owner — they are not the
 * person who configured these.
 */
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import {
  parseInstanceVoiceServers, setInstanceVoiceServers, slugify,
  loadInstanceVoiceServers, _resetInstanceVoiceForTests, type InstanceVoiceServer,
} from '../config/instanceVoice'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveForChannel, resolveForConversation } from '../utils/resolveVoiceServer'
import { Channel } from '../models/Channel'
import { Types } from 'mongoose'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)
afterEach(_resetInstanceVoiceForTests)

const entry = (over: Record<string, unknown> = {}) => ({
  name: 'Frankfurt', url: 'wss://fra.example.com',
  apiKey: 'APIfra', apiSecret: 'secret-fra', ...over,
})

const LIST: InstanceVoiceServer[] = [
  { id: 'instance:frankfurt', name: 'Frankfurt', url: 'wss://fra.example.com',
    apiKey: 'APIfra', apiSecret: 'secret-fra', isDefault: true },
  { id: 'instance:tokyo', name: 'Tokyo', url: 'wss://tyo.example.com',
    apiKey: 'APItyo', apiSecret: 'secret-tyo', isDefault: false },
]

describe('parsing the file', () => {
  it('accepts a normal list and derives ids from the names', () => {
    const list = parseInstanceVoiceServers([entry(), entry({ name: 'Singapore SG' })])
    expect(list.map(s => s.id)).toEqual(['instance:frankfurt', 'instance:singapore-sg'])
  })

  it('treats an empty list, null and a missing file alike', () => {
    expect(parseInstanceVoiceServers([])).toEqual([])
    expect(parseInstanceVoiceServers(null)).toEqual([])
    expect(parseInstanceVoiceServers(undefined)).toEqual([])
  })

  it('makes the first entry the default when none is marked', () => {
    // "The instance default" has to mean something, or resolution has no floor.
    const list = parseInstanceVoiceServers([entry(), entry({ name: 'Tokyo' })])
    expect(list.map(s => s.isDefault)).toEqual([true, false])
  })

  it('honours an explicit default', () => {
    const list = parseInstanceVoiceServers([entry(), entry({ name: 'Tokyo', default: true })])
    expect(list.find(s => s.isDefault)!.name).toBe('Tokyo')
  })

  const refuses = (raw: unknown, why: RegExp) =>
    expect(() => parseInstanceVoiceServers(raw)).toThrow(why)

  it('refuses two entries marked default', () => {
    refuses([entry({ default: true }), entry({ name: 'Tokyo', default: true })], /at most one/)
  })

  it('refuses two entries with the same name', () => {
    // They would collide on id, and which one you got would depend on order.
    refuses([entry(), entry()], /both named/)
  })

  it('refuses a plaintext ws:// url to a remote host', () => {
    // A page on HTTPS cannot open one, so it would fail for every user.
    refuses([entry({ url: 'ws://fra.example.com' })], /unusable url/)
  })

  it('accepts ws:// for localhost, which is how you develop', () => {
    expect(parseInstanceVoiceServers([entry({ url: 'ws://localhost:7880' })])).toHaveLength(1)
  })

  it('refuses a missing name, key or secret', () => {
    refuses([entry({ name: '' })], /has no name/)
    refuses([entry({ apiKey: '' })], /has no apiKey/)
    refuses([entry({ apiSecret: '' })], /has no apiSecret/)
  })

  it('refuses a name with nothing to make an id from', () => {
    refuses([entry({ name: '!!!' })], /no letters or digits/)
  })

  it('refuses anything that is not an array', () => {
    refuses({ name: 'Frankfurt' }, /must contain a JSON array/)
  })

  it('names the offending entry, so a long file can be fixed', () => {
    refuses([entry(), entry({ name: 'Tokyo', apiKey: '' })], /entry 2/)
  })
})

describe('reading the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skycord-voice-'))
  const at = (name: string) => join(dir, name)
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reads and validates a real file', () => {
    const p = at('good.json')
    writeFileSync(p, JSON.stringify([entry()]))
    expect(loadInstanceVoiceServers(p).map(s => s.id)).toEqual(['instance:frankfurt'])
  })

  it('treats a missing file as no instance servers', () => {
    // The normal case for a deployment using only LIVEKIT_URL, so it must be
    // silent rather than a warning or a failure.
    expect(loadInstanceVoiceServers(at('nope.json'))).toEqual([])
    expect(loadInstanceVoiceServers(undefined)).toEqual([])
  })

  it('names the path when the JSON is malformed', () => {
    // A syntax error reported without the path is one of the least helpful
    // things you can hand a self-hoster.
    const p = at('broken.json')
    writeFileSync(p, '[{ "name": ')
    expect(() => loadInstanceVoiceServers(p)).toThrow(/broken.json/)
  })

  it('refuses a file whose contents fail validation', () => {
    const p = at('remote-ws.json')
    writeFileSync(p, JSON.stringify([entry({ url: 'ws://remote.example.com' })]))
    expect(() => loadInstanceVoiceServers(p)).toThrow(/unusable url/)
  })
})

describe('slugify', () => {
  it('collapses punctuation and spaces into single hyphens', () => {
    expect(slugify('  Frankfurt — EU  West ')).toBe('frankfurt-eu-west')
  })
})

describe('resolution', () => {
  it('a channel can name an instance server without owning it', async () => {
    setInstanceVoiceServers(LIST)
    const hit = await resolveForChannel(new Types.ObjectId(), 'instance:tokyo')
    expect(hit).toMatchObject({ id: 'instance:tokyo', name: 'Tokyo', apiSecret: 'secret-tyo' })
  })

  it('falls back rather than failing when the operator removes one', async () => {
    // The file belongs to the operator and can change between restarts. A
    // channel pointing at a deleted entry keeps working on the default.
    setInstanceVoiceServers(LIST)
    const hit = await resolveForChannel(new Types.ObjectId(), 'instance:gone')
    expect(hit).toMatchObject({ id: 'instance:frankfurt' })
  })

  it('uses the marked default when a channel names nothing', async () => {
    setInstanceVoiceServers(LIST)
    expect(await resolveForChannel(new Types.ObjectId(), null))
      .toMatchObject({ id: 'instance:frankfurt' })
  })

  it('a DM preference may name one, with no membership check', async () => {
    // The whole point of the file: offered to everyone on the build.
    setInstanceVoiceServers(LIST)
    expect(await resolveForConversation('instance:tokyo', []))
      .toMatchObject({ id: 'instance:tokyo' })
  })

  it('with no file at all, the old LIVEKIT_URL trio still answers', async () => {
    // Every deployment predating the file has exactly this, and must be
    // untouched by the feature existing.
    setInstanceVoiceServers([])
    const hit = await resolveForChannel(new Types.ObjectId(), null)
    expect(hit === null || hit.id === null).toBe(true)
  })
})

describe('the API', () => {
  const mkServer = async (u: TestUser) =>
    (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

  it('lists them to a guild owner, without any credential', async () => {
    setInstanceVoiceServers(LIST)
    const u = await register()
    const srv = await mkServer(u)
    const res = await app().get(`/servers/${srv.server.id}/voice-servers`).set(auth(u))

    const inst = res.body.voiceServers.find((v: any) => v.id === 'instance:frankfurt')
    expect(inst).toMatchObject({ name: 'Frankfurt', scope: 'instance' })
    // Not the key, not even a hint of the secret. A guild owner did not
    // configure these and has no business seeing the operator's credentials.
    expect(inst.apiKey).toBe('')
    expect(inst.secretHint).toBe('')
    expect(JSON.stringify(res.body)).not.toContain('secret-fra')
  })

  it('lets a channel be pointed at one', async () => {
    setInstanceVoiceServers(LIST)
    const u = await register()
    const srv = await mkServer(u)
    const voice = srv.channels.find((c: any) => c.type === 'voice')

    const res = await app().patch(`/servers/${srv.server.id}/channels/${voice.id}`)
      .set(auth(u)).send({ voiceServer: 'instance:frankfurt' })
    expect(res.status).toBe(200)
    expect(res.body.channel.voiceServer).toBe('instance:frankfurt')

    const row = await Channel.findById(voice.id).lean()
    expect(row!.voiceServer).toBe('instance:frankfurt')
  })

  it('refuses an instance id this build does not offer', async () => {
    setInstanceVoiceServers(LIST)
    const u = await register()
    const srv = await mkServer(u)
    const voice = srv.channels.find((c: any) => c.type === 'voice')
    const res = await app().patch(`/servers/${srv.server.id}/channels/${voice.id}`)
      .set(auth(u)).send({ voiceServer: 'instance:nowhere' })
    expect(res.status).toBe(400)
  })

  it('refuses to edit or delete one from the app', async () => {
    setInstanceVoiceServers(LIST)
    const u = await register()
    const srv = await mkServer(u)
    const base = `/servers/${srv.server.id}/voice-servers/instance:frankfurt`

    const patched = await app().patch(base).set(auth(u)).send({ name: 'Renamed' })
    // 400 with a sentence, not 404 — it exists, it is simply not ours to change.
    expect(patched.status).toBe(400)
    expect(patched.body.message).toMatch(/provided by this instance/i)

    expect((await app().delete(base).set(auth(u))).status).toBe(400)
  })
})
