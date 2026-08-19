import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import http from 'http'
import { Types } from 'mongoose'
import request from 'supertest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { createApp } from '../app'
import { Server } from '../models/Server'
import { ServerInvite } from '../models/ServerInvite'

// There is no join endpoint that a test could use here without itself
// depending on the behaviour under test (POST /invites/:code), so tests
// that need a non-owner *member* (as opposed to a stranger who never
// joined) seed membership directly against the model — same pattern as
// channels.test.ts and servers.test.ts.
const joinAsMember = async (sid: string, uid: string) =>
  Server.updateOne({ _id: sid }, { $push: { members: uid } })

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body.server
const mkInvite = async (u: TestUser, sid: string, expiry: '24h' | '7d' | 'never' = '24h') =>
  (await app().post(`/servers/${sid}/invites`).set(auth(u)).send({ expiry })).body.invite

describe('POST /servers/:sid/invites', () => {
  it('mints a 24h invite by default', async () => {
    const u = await register()
    const s = await mkServer(u)
    const res = await app().post(`/servers/${s.id}/invites`).set(auth(u)).send({ expiry: '24h' })
    expect(res.status).toBe(201)
    expect(res.body.invite.code).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(res.body.invite.uses).toBe(0)
    const ms = new Date(res.body.invite.expiresAt).getTime() - Date.now()
    expect(ms).toBeGreaterThan(23 * 3600_000)
  })

  it('mints a never-expiring invite with a null expiry', async () => {
    const u = await register()
    const s = await mkServer(u)
    const inv = await mkInvite(u, s.id, 'never')
    expect(inv.expiresAt).toBeNull()
  })

  it('403s a non-member (never joined)', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const res = await app().post(`/servers/${s.id}/invites`).set(auth(b)).send({ expiry: '24h' })
    expect(res.status).toBe(403)
  })

  it('403s a non-owner member', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await joinAsMember(s.id, b.id)
    const res = await app().post(`/servers/${s.id}/invites`).set(auth(b)).send({ expiry: '24h' })
    expect(res.status).toBe(403)
  })
})

describe('POST /invites/:code', () => {
  it('joins the server and increments uses', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)

    const res = await app().post(`/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(200)
    expect(res.body.server.id).toBe(s.id)
    expect(res.body.channels).toHaveLength(2)

    const after = (await app().get(`/servers/${s.id}/members`).set(auth(b))).body.members
    expect(after).toHaveLength(2)
    const stored = await ServerInvite.findOne({ code: inv.code })
    expect(stored!.uses).toBe(1)
  })

  it('is idempotent for someone already in', async () => {
    const a = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    const res = await app().post(`/invites/${inv.code}`).set(auth(a))
    expect(res.status).toBe(200)
    const members = (await app().get(`/servers/${s.id}/members`).set(auth(a))).body.members
    expect(members).toHaveLength(1)
    const stored = await ServerInvite.findOne({ code: inv.code })
    expect(stored!.uses).toBe(0)
  })

  it('handles two concurrent joins by the same user without duplicating the member or double-counting uses', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)

    // A single already-listening server shared by both requests. Two
    // separate `app()` calls each bind their own ephemeral supertest
    // server, and the extra listen()-setup jitter between them is enough
    // to accidentally serialize the requests, masking the very race this
    // test exists to catch — so both concurrent POSTs go through one
    // shared server instead, the way two real simultaneous clients would.
    const server = http.createServer(createApp())
    await new Promise<void>(resolve => server.listen(0, resolve))
    let r1: request.Response, r2: request.Response
    try {
      const client = () => request(server)
      ;[r1, r2] = await Promise.all([
        client().post(`/invites/${inv.code}`).set(auth(b)),
        client().post(`/invites/${inv.code}`).set(auth(b)),
      ])
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)

    // The /members endpoint queries with $in, which silently de-dupes a
    // repeated id — it would report the right count even if the stored
    // array holds `b` twice. Check both: the public view, and the raw
    // document, which is where a duplicate actually shows up.
    const after = (await app().get(`/servers/${s.id}/members`).set(auth(b))).body.members
    expect(after).toHaveLength(2)
    const raw = await Server.findById(s.id).lean()
    expect(raw!.members).toHaveLength(2)
    const stored = await ServerInvite.findOne({ code: inv.code })
    expect(stored!.uses).toBe(1)
  })

  it('404s an unknown code', async () => {
    const u = await register()
    const res = await app().post('/invites/nope').set(auth(u))
    expect(res.status).toBe(404)
  })

  it('410s an expired invite, distinctly from unknown', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    await ServerInvite.updateOne({ code: inv.code }, { expiresAt: new Date(Date.now() - 1000) })
    const res = await app().post(`/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(410)
    expect(res.body.message).toMatch(/expired/i)
  })

  it('409s when the server is full', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    // Pad to the cap without registering 99 accounts.
    const filler = Array.from({ length: 99 }, () => new Types.ObjectId())
    await Server.updateOne({ _id: s.id }, { $push: { members: { $each: filler } } })
    const res = await app().post(`/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/full/i)
  })
})

describe('DELETE /servers/:sid/invites/:code', () => {
  it('revokes, and the code stops working', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    expect((await app().delete(`/servers/${s.id}/invites/${inv.code}`).set(auth(a))).status).toBe(200)
    expect((await app().post(`/invites/${inv.code}`).set(auth(b))).status).toBe(404)
  })

  it('403s a non-owner member', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    await joinAsMember(s.id, b.id)
    const res = await app().delete(`/servers/${s.id}/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(403)
  })
})

describe('GET /servers/:sid/invites', () => {
  it('lists active invites for the owner', async () => {
    const u = await register()
    const s = await mkServer(u)
    await mkInvite(u, s.id)
    const res = await app().get(`/servers/${s.id}/invites`).set(auth(u))
    expect(res.status).toBe(200)
    expect(res.body.invites).toHaveLength(1)
    expect(res.body.invites[0].inviter.username).toBe(u.username)
  })

  it('403s a non-owner member', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await mkInvite(a, s.id)
    await joinAsMember(s.id, b.id)
    const res = await app().get(`/servers/${s.id}/invites`).set(auth(b))
    expect(res.status).toBe(403)
  })
})
