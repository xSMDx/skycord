import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import http from 'http'
import { Types } from 'mongoose'
import request from 'supertest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { createApp } from '../app'
import { Server } from '../models/Server'
import { ServerInvite } from '../models/ServerInvite'
import { Role } from '../models/Role'
import { PERMISSIONS } from '../permissions'

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
const mkCategory = async (u: TestUser, sid: string, name: string) =>
  (await app().post(`/servers/${sid}/categories`).set(auth(u)).send({ name })).body.category
const mkChannel = async (u: TestUser, sid: string, body: Record<string, unknown>) =>
  (await app().post(`/servers/${sid}/channels`).set(auth(u)).send({ type: 'text', ...body })).body.channel

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

  it('mints a 7-day invite', async () => {
    const u = await register()
    const s = await mkServer(u)
    const inv = await mkInvite(u, s.id, '7d')
    const ms = new Date(inv.expiresAt).getTime() - Date.now()
    // Comfortably past 24h (the default) and just under 7 days, so this
    // fails if '7d' ever regresses to the default branch.
    expect(ms).toBeGreaterThan(6 * 24 * 3600_000)
    expect(ms).toBeLessThanOrEqual(7 * 24 * 3600_000)
  })

  it('403s a non-member (never joined)', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const res = await app().post(`/servers/${s.id}/invites`).set(auth(b)).send({ expiry: '24h' })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/not a member/i)
  })

  /*
   * Creating an invite is no longer owner-only.
   *
   * CreateInvite is part of the default @everyone set, so an ordinary member
   * can invite unless a server takes that away — Discord's default and what
   * most people expect. This replaced an owner-only check when roles landed,
   * so the change is deliberate rather than a regression.
   */
  it('lets an ordinary member invite, because @everyone may by default', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await joinAsMember(s.id, b.id)
    const res = await app().post(`/servers/${s.id}/invites`).set(auth(b)).send({ expiry: '24h' })
    expect(res.status).toBe(201)
  })

  it('403s once @everyone loses Create Invite', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await joinAsMember(s.id, b.id)
    // Materialise @everyone, then strip the permission from it.
    await app().get(`/servers/${s.id}/roles`).set(auth(a))
    const everyone = await Role.findOne({ server: s.id, isEveryone: true })
    await Role.updateOne(
      { _id: everyone!._id },
      { $set: { permissions: (BigInt(everyone!.permissions) & ~PERMISSIONS.CreateInvite).toString() } },
    )

    const res = await app().post(`/servers/${s.id}/invites`).set(auth(b)).send({ expiry: '24h' })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/create invite/i)
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

  /**
   * This response is the ONLY server-detail payload a joining member ever
   * gets: the client folds it in with the same `receiveDetail` that consumes
   * GET /servers/:sid and then caches the result. When it omitted categories,
   * the joiner's sidebar rendered every channel flat, in the headerless
   * group, and nothing short of a page reload could repair it.
   */
  it('returns the server\'s categories, position-ordered and wire-shaped', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await mkCategory(a, s.id, 'First')
    await mkCategory(a, s.id, 'Second')
    const inv = await mkInvite(a, s.id)

    const res = await app().post(`/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(200)
    expect(res.body.categories.map((c: any) => c.name)).toEqual(['First', 'Second'])
    // Same shape getServer sends — shapeCategory, not a raw document.
    expect(Object.keys(res.body.categories[0]).sort()).toEqual(['id', 'name', 'overwrites', 'position', 'server'])
    expect(res.body.categories[0].server).toBe(s.id)
  })

  it('returns categories the joiner can actually group the returned channels by', async () => {
    // The payload has to be self-sufficient: every non-null `channel.category`
    // must resolve inside the `categories` array of the very same response, or
    // the client buckets those channels as dangling and renders them flat.
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const cat = await mkCategory(a, s.id, 'Chat')
    await mkChannel(a, s.id, { name: 'filed', category: cat.id })
    const inv = await mkInvite(a, s.id)

    const res = await app().post(`/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(200)
    const ids = new Set(res.body.categories.map((c: any) => c.id))
    const filed = res.body.channels.find((c: any) => c.name === 'filed')
    expect(filed.category).toBe(cat.id)
    expect(ids.has(filed.category)).toBe(true)
  })

  it('returns an empty categories array for a server with none', async () => {
    // Present-and-empty, not absent: the client treats an absent list as
    // "never loaded" and refetches, which would be a wasted round trip here.
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    const res = await app().post(`/invites/${inv.code}`).set(auth(b))
    expect(res.body.categories).toEqual([])
  })

  it('returns categories on the idempotent re-join too', async () => {
    // `joined: false` takes a different branch through joinViaInvite. A user
    // who double-clicks the link, or revisits it, must not get a thinner
    // payload than the one that made them a member.
    const a = await register()
    const s = await mkServer(a)
    await mkCategory(a, s.id, 'Chat')
    const inv = await mkInvite(a, s.id)
    const res = await app().post(`/invites/${inv.code}`).set(auth(a))
    expect(res.status).toBe(200)
    expect(res.body.joined).toBe(false)
    expect(res.body.categories.map((c: any) => c.name)).toEqual(['Chat'])
  })

  it('does not leak another server\'s categories', async () => {
    const a = await register(), b = await register()
    const one = await mkServer(a), two = await mkServer(a)
    await mkCategory(a, two.id, 'Theirs')
    const inv = await mkInvite(a, one.id)
    const res = await app().post(`/invites/${inv.code}`).set(auth(b))
    expect(res.body.categories).toEqual([])
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
    expect(res.body.message).toMatch(/manage server/i)
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
    expect(res.body.message).toMatch(/manage server/i)
  })
})
