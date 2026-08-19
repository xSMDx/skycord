import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { ServerInvite } from '../models/ServerInvite'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body.server
const mkInvite = async (u: TestUser, sid: string, expiry = '24h') =>
  (await app().post(`/servers/${sid}/invites`).set(auth(u)).send({ expiry })).body.invite

describe('GET /invites/:code', () => {
  it('previews a server without joining it', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await app().patch(`/servers/${s.id}`).set(auth(a))
      .send({ description: 'a nice place', bannerColor: '#5865f2' })
    const inv = await mkInvite(a, s.id)

    const res = await app().get(`/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(200)
    expect(res.body.server.name).toBe('EA')
    expect(res.body.server.description).toBe('a nice place')
    expect(res.body.server.bannerColor).toBe('#5865f2')
    expect(res.body.server.memberCount).toBe(1)
    expect(res.body.alreadyMember).toBe(false)

    // Previewing must not join.
    const after = await app().get(`/servers/${s.id}`).set(auth(b))
    expect(after.status).toBe(403)

    // Previewing must not mutate the invite either.
    expect((await ServerInvite.findOne({ code: inv.code }))!.uses).toBe(0)
  })

  it('does not leak sensitive fields and returns only allowed keys', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    const res = await app().get(`/invites/${inv.code}`).set(auth(b))

    // Must not leak members, channels, owner, or createdAt
    expect(res.body.server).not.toHaveProperty('members')
    expect(res.body.server).not.toHaveProperty('owner')
    expect(res.body.server).not.toHaveProperty('createdAt')
    expect(res.body).not.toHaveProperty('channels')

    // Server must contain exactly these keys and no others
    const allowedServerKeys = ['id', 'name', 'icon', 'iconCrop', 'bannerColor', 'description', 'memberCount']
    expect(Object.keys(res.body.server).sort()).toEqual(allowedServerKeys.sort())
  })

  it('tells an existing member they are already in', async () => {
    const a = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    const res = await app().get(`/invites/${inv.code}`).set(auth(a))
    expect(res.status).toBe(200)
    expect(res.body.alreadyMember).toBe(true)
  })

  it('404s an unknown code', async () => {
    const u = await register()
    expect((await app().get('/invites/nope').set(auth(u))).status).toBe(404)
  })

  it('410s an expired code, distinctly from unknown', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    await ServerInvite.updateOne({ code: inv.code }, { expiresAt: new Date(Date.now() - 1000) })
    const res = await app().get(`/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(410)
    expect(res.body.message).toMatch(/expired/i)
  })

  it('reports a full server without joining', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    const inv = await mkInvite(a, s.id)
    const filler = Array.from({ length: 99 }, () => new Types.ObjectId())
    await Server.updateOne({ _id: s.id }, { $push: { members: { $each: filler } } })

    const res = await app().get(`/invites/${inv.code}`).set(auth(b))
    expect(res.status).toBe(200)
    expect(res.body.full).toBe(true)
  })
})
