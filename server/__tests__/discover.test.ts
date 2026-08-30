/**
 * Discover — the public server directory.
 *
 * The security property under test is the one that matters: a server is
 * listed if and only if its owner published it. Every private friend-group
 * server on the instance is invisible here, which is the whole point of the
 * flag defaulting to false.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server, MAX_SERVER_MEMBERS } from '../models/Server'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser, name = 'EA') =>
  (await app().post('/servers').set(auth(u)).send({ name })).body.server

const publish = (sid: string, u: TestUser) =>
  app().patch(`/servers/${sid}`).set(auth(u)).send({ isPublic: true })

describe('GET /servers/discover', () => {
  it('is empty until an owner publishes something', async () => {
    const owner = await register()
    await mkServer(owner)
    const stranger = await register()

    const res = await app().get('/servers/discover').set(auth(stranger))
    expect(res.status).toBe(200)
    expect(res.body.servers).toEqual([])
  })

  it('lists a published server to a stranger', async () => {
    const owner = await register()
    const srv = await mkServer(owner, 'Poke Haven')
    await publish(srv.id, owner)

    const stranger = await register()
    const res = await app().get('/servers/discover').set(auth(stranger))
    expect(res.body.servers).toHaveLength(1)
    expect(res.body.servers[0].name).toBe('Poke Haven')
    expect(res.body.servers[0].memberCount).toBe(1)
  })

  it('hides servers the caller is already in', async () => {
    const owner = await register()
    const srv = await mkServer(owner)
    await publish(srv.id, owner)

    // The owner is a member, so their own published server is not in their
    // directory — it is already in their rail.
    const res = await app().get('/servers/discover').set(auth(owner))
    expect(res.body.servers).toEqual([])
  })

  it('un-publishing removes it again', async () => {
    const owner = await register()
    const srv = await mkServer(owner)
    await publish(srv.id, owner)
    await app().patch(`/servers/${srv.id}`).set(auth(owner)).send({ isPublic: false })

    const stranger = await register()
    const res = await app().get('/servers/discover').set(auth(stranger))
    expect(res.body.servers).toEqual([])
  })

  it('requires auth', async () => {
    expect((await app().get('/servers/discover')).status).toBe(401)
  })

  it('is not swallowed by GET /servers/:sid', async () => {
    // Route order regression: registered after '/:sid', "discover" arrives as
    // an id, fails ObjectId validation and 404s. A 200 proves the literal
    // route still wins.
    const u = await register()
    expect((await app().get('/servers/discover').set(auth(u))).status).toBe(200)
  })
})

describe('PATCH /servers/:sid { isPublic }', () => {
  it('only the owner can publish', async () => {
    const owner = await register()
    const srv = await mkServer(owner)
    const other = await register()

    const res = await app().patch(`/servers/${srv.id}`).set(auth(other)).send({ isPublic: true })
    expect(res.status).toBe(403)

    const fresh = await Server.findById(srv.id).lean()
    expect(fresh!.isPublic).toBe(false)
  })

  it('defaults to false on a new server', async () => {
    const owner = await register()
    const srv = await mkServer(owner)
    expect(srv.isPublic).toBe(false)
  })
})

describe('POST /servers/:sid/join', () => {
  it('joins a published server without an invite', async () => {
    const owner = await register()
    const srv = await mkServer(owner)
    await publish(srv.id, owner)

    const joiner = await register()
    const res = await app().post(`/servers/${srv.id}/join`).set(auth(joiner)).send({})
    expect(res.status).toBe(200)
    expect(res.body.joined).toBe(true)
    expect(res.body.server.memberCount).toBe(2)
    // The channel list comes back so the client can open it immediately.
    expect(res.body.channels.map((c: any) => c.name)).toContain('general')
  })

  it('refuses a server that was never published', async () => {
    const owner = await register()
    const srv = await mkServer(owner)

    const joiner = await register()
    const res = await app().post(`/servers/${srv.id}/join`).set(auth(joiner)).send({})
    expect(res.status).toBe(404)

    const fresh = await Server.findById(srv.id).lean()
    expect(fresh!.members).toHaveLength(1)
  })

  it('is idempotent for someone already in', async () => {
    const owner = await register()
    const srv = await mkServer(owner)
    await publish(srv.id, owner)

    const joiner = await register()
    await app().post(`/servers/${srv.id}/join`).set(auth(joiner)).send({})
    const again = await app().post(`/servers/${srv.id}/join`).set(auth(joiner)).send({})

    expect(again.status).toBe(200)
    expect(again.body.joined).toBe(false)
    expect(again.body.server.memberCount).toBe(2)
  })

  it('refuses a full server', async () => {
    const owner = await register()
    const srv = await mkServer(owner)
    await publish(srv.id, owner)

    // Fill to the cap with placeholder ids — the guard counts the array, it
    // does not resolve the members.
    const filler = Array.from({ length: MAX_SERVER_MEMBERS - 1 },
      () => new (require('mongoose').Types.ObjectId)())
    await Server.updateOne({ _id: srv.id }, { $push: { members: { $each: filler } } })

    const joiner = await register()
    const res = await app().post(`/servers/${srv.id}/join`).set(auth(joiner)).send({})
    expect(res.status).toBe(409)
  })

  it('404s an unknown id rather than 500ing on a bad ObjectId', async () => {
    const u = await register()
    expect((await app().post('/servers/not-an-id/join').set(auth(u)).send({})).status).toBe(404)
  })

  it('requires auth', async () => {
    const owner = await register()
    const srv = await mkServer(owner)
    await publish(srv.id, owner)
    expect((await app().post(`/servers/${srv.id}/join`).send({})).status).toBe(401)
  })
})
