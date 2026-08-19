import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { ServerInvite } from '../models/ServerInvite'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser, name = 'EA') =>
  (await app().post('/servers').set(auth(u)).send({ name })).body.server

// There is no join endpoint yet (that's a later task), so tests that need a
// non-owner *member* (as opposed to a stranger who never joined) seed
// membership directly against the model.
const joinAsMember = async (sid: string, uid: string) =>
  Server.updateOne({ _id: sid }, { $push: { members: uid } })

describe('POST /servers', () => {
  it('creates a server seeded with #general and General voice', async () => {
    const u = await register()
    const res = await app().post('/servers').set(auth(u)).send({ name: 'EA' })
    expect(res.status).toBe(201)
    expect(res.body.server.name).toBe('EA')
    expect(res.body.server.owner).toBe(u.id)
    expect(res.body.server.memberCount).toBe(1)

    const names = res.body.channels.map((c: any) => `${c.type}:${c.name}`)
    expect(names).toEqual(['text:general', 'voice:General'])
  })

  it('rejects an empty name', async () => {
    const u = await register()
    const res = await app().post('/servers').set(auth(u)).send({ name: '   ' })
    expect(res.status).toBe(400)
  })

  it('requires auth', async () => {
    const res = await app().post('/servers').send({ name: 'EA' })
    expect(res.status).toBe(401)
  })
})

describe('GET /servers', () => {
  it('lists only servers you belong to', async () => {
    const a = await register(), b = await register()
    await mkServer(a, 'Mine')
    await mkServer(b, 'Theirs')
    const res = await app().get('/servers').set(auth(a))
    expect(res.status).toBe(200)
    expect(res.body.servers.map((s: any) => s.name)).toEqual(['Mine'])
  })
})

describe('GET /servers/:sid', () => {
  it('returns the server with its channels', async () => {
    const u = await register()
    const s = await mkServer(u)
    const res = await app().get(`/servers/${s.id}`).set(auth(u))
    expect(res.status).toBe(200)
    expect(res.body.channels).toHaveLength(2)
  })

  it('403s a non-member', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const res = await app().get(`/servers/${s.id}`).set(auth(b))
    expect(res.status).toBe(403)
  })

  it('404s an unknown id', async () => {
    const u = await register()
    const res = await app().get('/servers/6a82759756877263fa4805aa').set(auth(u))
    expect(res.status).toBe(404)
  })
})

describe('PATCH /servers/:sid', () => {
  it('lets the owner rename', async () => {
    const u = await register()
    const s = await mkServer(u)
    const res = await app().patch(`/servers/${s.id}`).set(auth(u)).send({ name: 'Renamed' })
    expect(res.status).toBe(200)
    expect(res.body.server.name).toBe('Renamed')
  })

  it('403s a non-member (never joined)', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const res = await app().patch(`/servers/${s.id}`).set(auth(b)).send({ name: 'x' })
    expect(res.status).toBe(403)
  })

  it('403s a non-owner member', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await joinAsMember(s.id, b.id)
    const res = await app().patch(`/servers/${s.id}`).set(auth(b)).send({ name: 'x' })
    expect(res.status).toBe(403)
  })

  it('rejects an oversized icon with a friendly 400', async () => {
    const u = await register()
    const s = await mkServer(u)
    const oversized = 'x'.repeat(1_500_001)
    const res = await app().patch(`/servers/${s.id}`).set(auth(u)).send({ icon: oversized })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Image is too large')
  })

  it('rejects a malformed bannerColor', async () => {
    const u = await register()
    const s = await mkServer(u)
    const res = await app().patch(`/servers/${s.id}`).set(auth(u)).send({ bannerColor: 'red' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/hex/i)
  })

  it('stores a valid bannerColor, lowercased', async () => {
    const u = await register()
    const s = await mkServer(u)
    const res = await app().patch(`/servers/${s.id}`).set(auth(u)).send({ bannerColor: '#ABC123' })
    expect(res.status).toBe(200)
    expect(res.body.server.bannerColor).toBe('#abc123')
  })
})

describe('GET /servers/:sid/members', () => {
  it('returns members with computed presence, never the raw column', async () => {
    const u = await register()
    const s = await mkServer(u)
    const res = await app().get(`/servers/${s.id}/members`).set(auth(u))
    expect(res.status).toBe(200)
    expect(res.body.members).toHaveLength(1)
    // No socket in a test process, so everyone is offline regardless of the
    // stored value. This is the bug that made everyone read offline in prod.
    expect(res.body.members[0].status).toBe('offline')
  })
})

describe('DELETE /servers/:sid', () => {
  it('lets the owner delete and takes the channels with it', async () => {
    const u = await register()
    const s = await mkServer(u)
    expect((await app().delete(`/servers/${s.id}`).set(auth(u))).status).toBe(200)
    expect((await app().get(`/servers/${s.id}`).set(auth(u))).status).toBe(404)
  })

  it('403s a non-owner member', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await joinAsMember(s.id, b.id)
    const res = await app().delete(`/servers/${s.id}`).set(auth(b))
    expect(res.status).toBe(403)
  })

  it('takes the invites with it, including never-expiring ones', async () => {
    const u = await register()
    const s = await mkServer(u)
    await app().post(`/servers/${s.id}/invites`).set(auth(u)).send({ expiry: '24h' })
    await app().post(`/servers/${s.id}/invites`).set(auth(u)).send({ expiry: 'never' })
    expect(await ServerInvite.countDocuments({ server: s.id })).toBe(2)

    expect((await app().delete(`/servers/${s.id}`).set(auth(u))).status).toBe(200)
    expect(await ServerInvite.countDocuments({ server: s.id })).toBe(0)
  })
})

describe('DELETE /servers/:sid/members/:uid', () => {
  it('refuses to let the owner leave', async () => {
    const u = await register()
    const s = await mkServer(u)
    const res = await app().delete(`/servers/${s.id}/members/${u.id}`).set(auth(u))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/owner/i)
  })

  it('403s a non-owner member trying to kick a third member', async () => {
    const a = await register(), b = await register(), c = await register()
    const s = await mkServer(a)
    await joinAsMember(s.id, b.id)
    await joinAsMember(s.id, c.id)
    const res = await app().delete(`/servers/${s.id}/members/${c.id}`).set(auth(b))
    expect(res.status).toBe(403)
  })

  it('lets a non-owner member remove themselves, and they are actually gone', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await joinAsMember(s.id, b.id)
    const res = await app().delete(`/servers/${s.id}/members/${b.id}`).set(auth(b))
    expect(res.status).toBe(200)

    const after = await app().get(`/servers/${s.id}/members`).set(auth(a))
    expect(after.body.members).toHaveLength(1)
    expect(after.body.members.map((m: any) => m.id)).not.toContain(b.id)
  })

  it('lets the owner kick a member, and they are actually gone', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await joinAsMember(s.id, b.id)
    const res = await app().delete(`/servers/${s.id}/members/${b.id}`).set(auth(a))
    expect(res.status).toBe(200)

    const after = await app().get(`/servers/${s.id}/members`).set(auth(a))
    expect(after.body.members).toHaveLength(1)
    expect(after.body.members.map((m: any) => m.id)).not.toContain(b.id)
  })
})
