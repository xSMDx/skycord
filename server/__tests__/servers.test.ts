import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser, name = 'EA') =>
  (await app().post('/servers').set(auth(u)).send({ name })).body.server

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

  it('403s someone who is not a member', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const res = await app().patch(`/servers/${s.id}`).set(auth(b)).send({ name: 'x' })
    expect(res.status).toBe(403)
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
})

describe('DELETE /servers/:sid/members/:uid', () => {
  it('refuses to let the owner leave', async () => {
    const u = await register()
    const s = await mkServer(u)
    const res = await app().delete(`/servers/${s.id}/members/${u.id}`).set(auth(u))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/owner/i)
  })
})
