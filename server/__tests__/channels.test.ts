import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

// There is no join endpoint yet (that's a later task), so tests that need a
// non-owner *member* (as opposed to a stranger who never joined) seed
// membership directly against the model.
const joinAsMember = async (sid: string, uid: string) =>
  Server.updateOne({ _id: sid }, { $push: { members: uid } })

describe('POST /servers/:sid/channels', () => {
  it('appends a text channel after the existing one', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: '💬memes', type: 'text' })
    expect(res.status).toBe(201)
    expect(res.body.channel.name).toBe('💬memes')
    expect(res.body.channel.position).toBe(1)
  })

  it('positions voice channels within their own group', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: 'Chill', type: 'voice' })
    expect(res.body.channel.position).toBe(1)
  })

  it('rejects an unknown type', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: 'x', type: 'forum' })
    expect(res.status).toBe(400)
  })

  it('rejects an empty name', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: '  ', type: 'text' })
    expect(res.status).toBe(400)
  })

  it('403s a non-member (never joined)', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    const res = await app().post(`/servers/${server.id}/channels`)
      .set(auth(b)).send({ name: 'x', type: 'text' })
    expect(res.status).toBe(403)
  })

  it('403s a non-owner member', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const res = await app().post(`/servers/${server.id}/channels`)
      .set(auth(b)).send({ name: 'x', type: 'text' })
    expect(res.status).toBe(403)
  })
})

describe('PATCH /servers/:sid/channels/:cid', () => {
  it('renames', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const text = channels.find((c: any) => c.type === 'text')
    const res = await app().patch(`/servers/${server.id}/channels/${text.id}`)
      .set(auth(u)).send({ name: 'renamed' })
    expect(res.status).toBe(200)
    expect(res.body.channel.name).toBe('renamed')
  })

  it('403s a non-owner member', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const text = channels.find((c: any) => c.type === 'text')
    const res = await app().patch(`/servers/${server.id}/channels/${text.id}`)
      .set(auth(b)).send({ name: 'renamed' })
    expect(res.status).toBe(403)
  })
})

describe('DELETE /servers/:sid/channels/:cid', () => {
  it('refuses to delete the last text channel', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const text = channels.find((c: any) => c.type === 'text')
    const res = await app().delete(`/servers/${server.id}/channels/${text.id}`).set(auth(u))
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/last text channel/i)
  })

  it('deletes a text channel when another remains', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const extra = (await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: 'second', type: 'text' })).body.channel
    const res = await app().delete(`/servers/${server.id}/channels/${extra.id}`).set(auth(u))
    expect(res.status).toBe(200)
    const after = (await app().get(`/servers/${server.id}`).set(auth(u))).body.channels
    expect(after.map((c: any) => c.id)).not.toContain(extra.id)
    expect(after).toHaveLength(2)
    // The seeded text channel survives.
    expect(channels.find((c: any) => c.type === 'text')).toBeTruthy()
  })

  it('deletes the only voice channel happily', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const voice = channels.find((c: any) => c.type === 'voice')
    const res = await app().delete(`/servers/${server.id}/channels/${voice.id}`).set(auth(u))
    expect(res.status).toBe(200)
  })

  it('404s a channel from another server', async () => {
    const u = await register()
    const one = await mkServer(u), two = await mkServer(u)
    const other = two.channels[0]
    const res = await app().delete(`/servers/${one.server.id}/channels/${other.id}`).set(auth(u))
    expect(res.status).toBe(404)
  })

  it('403s a non-owner member', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const extra = (await app().post(`/servers/${server.id}/channels`)
      .set(auth(a)).send({ name: 'second', type: 'text' })).body.channel
    const res = await app().delete(`/servers/${server.id}/channels/${extra.id}`).set(auth(b))
    expect(res.status).toBe(403)
  })

  it('serializes two concurrent deletes of the last two text channels: exactly one wins', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const first = channels.find((c: any) => c.type === 'text')
    const second = (await app().post(`/servers/${server.id}/channels`)
      .set(auth(u)).send({ name: 'second', type: 'text' })).body.channel

    const [r1, r2] = await Promise.all([
      app().delete(`/servers/${server.id}/channels/${first.id}`).set(auth(u)),
      app().delete(`/servers/${server.id}/channels/${second.id}`).set(auth(u)),
    ])

    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([200, 400])

    // Refetch — don't trust the response bodies, prove the invariant against
    // what's actually stored.
    const after = (await app().get(`/servers/${server.id}`).set(auth(u))).body.channels
    expect(after.filter((c: any) => c.type === 'text')).toHaveLength(1)
  })
})
