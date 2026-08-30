/**
 * Channel Overview settings — topic, slowmode, user limit, bitrate.
 *
 * The cases worth pinning are the ones where a plausible implementation is
 * silently wrong: 0 meaning "off" rather than "unset", a channel that predates
 * these fields reading as broken rather than as default, and a rejected value
 * leaving a partial write behind.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Channel, MAX_BITRATE, MIN_BITRATE, MAX_USER_LIMIT, MAX_SLOWMODE } from '../models/Channel'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

/** The seeded #general (text) and General (voice). */
const channels = (body: any) => ({
  text:  body.channels.find((c: any) => c.type === 'text'),
  voice: body.channels.find((c: any) => c.type === 'voice'),
})

const patch = (u: TestUser, sid: string, cid: string, body: object) =>
  app().patch(`/servers/${sid}/channels/${cid}`).set(auth(u)).send(body)

describe('defaults', () => {
  it('a new channel comes back with usable defaults, not nulls', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const { text, voice } = channels(srv)

    expect(text.topic).toBeNull()
    expect(text.slowmode).toBe(0)
    expect(voice.userLimit).toBe(0)      // 0 = unlimited
    expect(voice.bitrate).toBe(64)
  })

  it('a channel that predates these fields reads as default, not undefined', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const { voice } = channels(srv)

    // Strip the fields entirely, which is exactly what an old document looks
    // like. `.lean()` skips hydration, so Mongoose defaults do NOT fill these
    // in on read — shapeChannel has to.
    await Channel.updateOne({ _id: voice.id },
      { $unset: { topic: '', slowmode: '', userLimit: '', bitrate: '' } })

    const res = await app().get(`/servers/${srv.server.id}`).set(auth(u))
    const fresh = res.body.channels.find((c: any) => c.id === voice.id)
    expect(fresh.bitrate).toBe(64)
    expect(fresh.userLimit).toBe(0)
    expect(fresh.slowmode).toBe(0)
    expect(fresh.topic).toBeNull()
  })
})

describe('saving Overview fields', () => {
  it('saves a topic, and an empty string clears it', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const { text } = channels(srv)

    await patch(u, srv.server.id, text.id, { topic: '  rules and links  ' })
    let fresh = await Channel.findById(text.id).lean()
    expect(fresh!.topic).toBe('rules and links')      // trimmed

    await patch(u, srv.server.id, text.id, { topic: '' })
    fresh = await Channel.findById(text.id).lean()
    expect(fresh!.topic).toBeNull()                   // cleared, not ''
  })

  it('saves a settings change on its own, without a name', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const { voice } = channels(srv)

    // The "nothing to change" guard used to count only name and category, so
    // a settings-only save was a 400.
    const res = await patch(u, srv.server.id, voice.id, { bitrate: 96 })
    expect(res.status).toBe(200)
    expect((await Channel.findById(voice.id).lean())!.bitrate).toBe(96)
  })

  it('an empty body is still refused', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const { text } = channels(srv)
    expect((await patch(u, srv.server.id, text.id, {})).status).toBe(400)
  })

  it('keeps 0 rather than treating it as unset', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const { voice } = channels(srv)

    await patch(u, srv.server.id, voice.id, { userLimit: 12 })
    await patch(u, srv.server.id, voice.id, { userLimit: 0 })

    // `?? 0` in shapeChannel, not `|| 0` — with `||` this reads as the default
    // and "unlimited" becomes unreachable once you have set a limit.
    const res = await app().get(`/servers/${srv.server.id}`).set(auth(u))
    const fresh = res.body.channels.find((c: any) => c.id === voice.id)
    expect(fresh.userLimit).toBe(0)
  })
})

describe('clamping', () => {
  it('pins out-of-range numbers instead of rejecting them', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const { text, voice } = channels(srv)

    await patch(u, srv.server.id, voice.id, { bitrate: 9999, userLimit: 5000 })
    await patch(u, srv.server.id, text.id,  { slowmode: 999999 })

    const v = await Channel.findById(voice.id).lean()
    const t = await Channel.findById(text.id).lean()
    expect(v!.bitrate).toBe(MAX_BITRATE)
    expect(v!.userLimit).toBe(MAX_USER_LIMIT)
    expect(t!.slowmode).toBe(MAX_SLOWMODE)
  })

  it('pins below the floor too', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const { voice } = channels(srv)

    await patch(u, srv.server.id, voice.id, { bitrate: -50 })
    expect((await Channel.findById(voice.id).lean())!.bitrate).toBe(MIN_BITRATE)
  })

  it('falls back rather than storing NaN', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const { voice } = channels(srv)

    await patch(u, srv.server.id, voice.id, { bitrate: 'loud' })
    expect((await Channel.findById(voice.id).lean())!.bitrate).toBe(64)
  })
})

describe('authorisation', () => {
  it('a non-owner cannot change settings', async () => {
    const owner = await register()
    const srv = await mkServer(owner)
    const { text } = channels(srv)
    const other = await register()

    const res = await patch(other, srv.server.id, text.id, { topic: 'mine now' })
    expect(res.status).toBe(403)
    expect((await Channel.findById(text.id).lean())!.topic).toBeNull()
  })
})

describe('partial writes', () => {
  it('a rejected name does not leave the settings saved', async () => {
    const u = await register()
    const srv = await mkServer(u)
    const { text } = channels(srv)

    // Blank name is a 400. The topic in the same body must not survive it.
    const res = await patch(u, srv.server.id, text.id, { name: '   ', topic: 'should not stick' })
    expect(res.status).toBe(400)
    expect((await Channel.findById(text.id).lean())!.topic).toBeNull()
  })
})
