import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { Server } from '../models/Server'
import { Channel } from '../models/Channel'
import { Category, MAX_CATEGORIES } from '../models/Category'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

// Mirrors channels.test.ts: there is no join endpoint on this branch, so a
// non-owner *member* (as opposed to a stranger who never joined) is seeded
// straight against the model.
const joinAsMember = async (sid: string, uid: string) =>
  Server.updateOne({ _id: sid }, { $push: { members: uid } })

const mkCategory = async (u: TestUser, sid: string, name: string) =>
  (await app().post(`/servers/${sid}/categories`).set(auth(u)).send({ name })).body.category

const mkChannel = async (u: TestUser, sid: string, body: Record<string, unknown>) =>
  app().post(`/servers/${sid}/channels`).set(auth(u)).send({ type: 'text', ...body })

describe('POST /servers/:sid/categories', () => {
  it('creates a category for the owner and shapes it for the wire', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/categories`)
      .set(auth(u)).send({ name: 'Text Channels' })

    expect(res.status).toBe(201)
    expect(res.body.category).toMatchObject({
      server:   server.id,
      name:     'Text Channels',
      position: 0,
    })
    expect(typeof res.body.category.id).toBe('string')
    // The wire shape is exactly these four keys — no _id, no timestamps.
    expect(Object.keys(res.body.category).sort()).toEqual(['id', 'name', 'position', 'server'])
  })

  it('trims the name', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/categories`)
      .set(auth(u)).send({ name: '  Voice  ' })
    expect(res.body.category.name).toBe('Voice')
  })

  it('appends: the second category gets a higher position than the first', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const first  = await mkCategory(u, server.id, 'One')
    const second = await mkCategory(u, server.id, 'Two')
    expect(second.position).toBeGreaterThan(first.position)
  })

  // Position is highest-surviving + 1, not the document count. With a count,
  // deleting a category in the MIDDLE would hand the next one a position that
  // an existing sibling already holds, and the two would render in an
  // arbitrary order. Reusing the position of the category that was at the END
  // is fine and expected — nothing is left there to collide with.
  it('appends past every surviving category when one in the middle is deleted', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const first  = await mkCategory(u, server.id, 'One')
    const middle = await mkCategory(u, server.id, 'Two')
    const last   = await mkCategory(u, server.id, 'Three')
    await app().delete(`/servers/${server.id}/categories/${middle.id}`).set(auth(u))

    const fresh = await mkCategory(u, server.id, 'Four')
    expect(fresh.position).toBeGreaterThan(first.position)
    expect(fresh.position).toBeGreaterThan(last.position)

    const positions = (await app().get(`/servers/${server.id}`).set(auth(u)))
      .body.categories.map((c: any) => c.position)
    expect(new Set(positions).size).toBe(positions.length) // no duplicates
  })

  it('rejects an empty name', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/categories`).set(auth(u)).send({ name: '' })
    expect(res.status).toBe(400)
  })

  it('rejects a whitespace-only name', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/categories`).set(auth(u)).send({ name: '   ' })
    expect(res.status).toBe(400)
    expect(await Category.countDocuments({ server: server.id })).toBe(0)
  })

  it('rejects a name over 100 characters', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().post(`/servers/${server.id}/categories`)
      .set(auth(u)).send({ name: 'x'.repeat(101) })
    expect(res.status).toBe(400)
    expect(await Category.countDocuments({ server: server.id })).toBe(0)
  })

  it(`refuses to create more than ${MAX_CATEGORIES} categories, with a message that says so`, async () => {
    const u = await register()
    const { server } = await mkServer(u)
    // Seeded straight against the model: MAX_CATEGORIES round trips through
    // supertest just to reach the cap would dominate this file's runtime.
    await Category.insertMany(
      Array.from({ length: MAX_CATEGORIES }, (_, i) => ({
        server: new mongoose.Types.ObjectId(server.id), name: `c${i}`, position: i,
      }))
    )
    const res = await app().post(`/servers/${server.id}/categories`)
      .set(auth(u)).send({ name: 'one too many' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(new RegExp(String(MAX_CATEGORIES)))
    expect(await Category.countDocuments({ server: server.id })).toBe(MAX_CATEGORIES)
  })

  it('counts the cap per server, so a full server does not block an empty one', async () => {
    const u = await register()
    const full = await mkServer(u), empty = await mkServer(u)
    await Category.insertMany(
      Array.from({ length: MAX_CATEGORIES }, (_, i) => ({
        server: new mongoose.Types.ObjectId(full.server.id), name: `c${i}`, position: i,
      }))
    )
    const res = await app().post(`/servers/${empty.server.id}/categories`)
      .set(auth(u)).send({ name: 'fine' })
    expect(res.status).toBe(201)
  })

  it('403s a non-owner member', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const res = await app().post(`/servers/${server.id}/categories`).set(auth(b)).send({ name: 'x' })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/owner/i)
  })

  // loadServer is the shared authorisation boundary: a stranger is refused
  // before ownership is ever considered, so the failure they get is the
  // membership one, not the ownership one. Pinned here because the two are
  // easy to conflate and they mean different things to the client.
  it('refuses a stranger who never joined, with the membership failure not the ownership one', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    const res = await app().post(`/servers/${server.id}/categories`).set(auth(b)).send({ name: 'x' })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/not a member/i)
    expect(res.body.message).not.toMatch(/owner/i)
  })

  it('404s an unknown server id', async () => {
    const u = await register()
    const res = await app().post(`/servers/${new mongoose.Types.ObjectId()}/categories`)
      .set(auth(u)).send({ name: 'x' })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /servers/:sid/categories/:cid', () => {
  it('renames and leaves position alone', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    await mkCategory(u, server.id, 'First')
    const cat = await mkCategory(u, server.id, 'Before')
    expect(cat.position).toBe(1)

    const res = await app().patch(`/servers/${server.id}/categories/${cat.id}`)
      .set(auth(u)).send({ name: 'After' })
    expect(res.status).toBe(200)
    expect(res.body.category.name).toBe('After')
    expect(res.body.category.position).toBe(1)

    const stored = await Category.findById(cat.id)
    expect(stored!.name).toBe('After')
    expect(stored!.position).toBe(1)
  })

  it('rejects an empty name', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const cat = await mkCategory(u, server.id, 'Keep')
    const res = await app().patch(`/servers/${server.id}/categories/${cat.id}`)
      .set(auth(u)).send({ name: '  ' })
    expect(res.status).toBe(400)
    expect((await Category.findById(cat.id))!.name).toBe('Keep')
  })

  it('rejects a name over 100 characters', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const cat = await mkCategory(u, server.id, 'Keep')
    const res = await app().patch(`/servers/${server.id}/categories/${cat.id}`)
      .set(auth(u)).send({ name: 'x'.repeat(101) })
    expect(res.status).toBe(400)
    expect((await Category.findById(cat.id))!.name).toBe('Keep')
  })

  it('403s a non-owner member', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const cat = await mkCategory(a, server.id, 'Keep')
    const res = await app().patch(`/servers/${server.id}/categories/${cat.id}`)
      .set(auth(b)).send({ name: 'Renamed' })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/owner/i)
    expect((await Category.findById(cat.id))!.name).toBe('Keep')
  })

  it('refuses a stranger who never joined, with the membership failure', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    const cat = await mkCategory(a, server.id, 'Keep')
    const res = await app().patch(`/servers/${server.id}/categories/${cat.id}`)
      .set(auth(b)).send({ name: 'Renamed' })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/not a member/i)
  })

  it('404s a category id belonging to a different server, and does not rename it', async () => {
    const u = await register()
    const one = await mkServer(u), two = await mkServer(u)
    const cat = await mkCategory(u, two.server.id, 'Theirs')
    const res = await app().patch(`/servers/${one.server.id}/categories/${cat.id}`)
      .set(auth(u)).send({ name: 'Hijacked' })
    expect(res.status).toBe(404)
    expect((await Category.findById(cat.id))!.name).toBe('Theirs')
  })

  it('404s a malformed category id', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().patch(`/servers/${server.id}/categories/not-an-id`)
      .set(auth(u)).send({ name: 'x' })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /servers/:sid/categories/:cid', () => {
  it('reparents its channels to uncategorised instead of deleting them', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const cat = await mkCategory(u, server.id, 'Doomed')

    const one = (await mkChannel(u, server.id, { name: 'one', category: cat.id })).body.channel
    const two = (await mkChannel(u, server.id, { name: 'two', category: cat.id })).body.channel
    expect(one.category).toBe(cat.id)
    expect(two.category).toBe(cat.id)

    const res = await app().delete(`/servers/${server.id}/categories/${cat.id}`).set(auth(u))
    expect(res.status).toBe(200)

    // The point of the test: the channels survive, uncategorised. Asserted on
    // the stored documents, not merely on the 200 above.
    const storedOne = await Channel.findById(one.id)
    const storedTwo = await Channel.findById(two.id)
    expect(storedOne).not.toBeNull()
    expect(storedTwo).not.toBeNull()
    expect(storedOne!.category).toBeNull()
    expect(storedTwo!.category).toBeNull()

    // And nothing else was swept up: the two seeded channels plus these two.
    expect(await Channel.countDocuments({ server: server.id })).toBe(4)
    expect(await Category.findById(cat.id)).toBeNull()

    const after = await app().get(`/servers/${server.id}`).set(auth(u))
    expect(after.body.categories).toHaveLength(0)
    const names = after.body.channels.map((c: any) => c.name)
    expect(names).toContain('one')
    expect(names).toContain('two')
    expect(after.body.channels.every((c: any) => c.category === null)).toBe(true)
  })

  it('leaves channels in other categories alone', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const doomed = await mkCategory(u, server.id, 'Doomed')
    const spared = await mkCategory(u, server.id, 'Spared')
    const a = (await mkChannel(u, server.id, { name: 'a', category: doomed.id })).body.channel
    const b = (await mkChannel(u, server.id, { name: 'b', category: spared.id })).body.channel

    await app().delete(`/servers/${server.id}/categories/${doomed.id}`).set(auth(u))

    expect((await Channel.findById(a.id))!.category).toBeNull()
    expect((await Channel.findById(b.id))!.category!.toString()).toBe(spared.id)
  })

  it('404s a category belonging to a different server and does not delete it', async () => {
    const u = await register()
    const one = await mkServer(u), two = await mkServer(u)
    const cat = await mkCategory(u, two.server.id, 'Theirs')
    const chan = (await mkChannel(u, two.server.id, { name: 'theirs', category: cat.id })).body.channel

    const res = await app().delete(`/servers/${one.server.id}/categories/${cat.id}`).set(auth(u))
    expect(res.status).toBe(404)

    // Still there, and its channel is still in it.
    expect(await Category.findById(cat.id)).not.toBeNull()
    expect((await Channel.findById(chan.id))!.category!.toString()).toBe(cat.id)
  })

  it('403s a non-owner member and keeps the category', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const cat = await mkCategory(a, server.id, 'Keep')
    const res = await app().delete(`/servers/${server.id}/categories/${cat.id}`).set(auth(b))
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/owner/i)
    expect(await Category.findById(cat.id)).not.toBeNull()
  })

  it('refuses a stranger who never joined, with the membership failure', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    const cat = await mkCategory(a, server.id, 'Keep')
    const res = await app().delete(`/servers/${server.id}/categories/${cat.id}`).set(auth(b))
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/not a member/i)
    expect(await Category.findById(cat.id)).not.toBeNull()
  })
})

describe('GET /servers/:sid', () => {
  it('returns categories alongside channels, ordered by position', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    await mkCategory(u, server.id, 'First')
    await mkCategory(u, server.id, 'Second')

    const res = await app().get(`/servers/${server.id}`).set(auth(u))
    expect(res.status).toBe(200)
    expect(res.body.categories.map((c: any) => c.name)).toEqual(['First', 'Second'])
    expect(res.body.categories[0].server).toBe(server.id)
    expect(res.body.channels).toHaveLength(2)
  })

  it('returns an empty categories array for a server with none', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await app().get(`/servers/${server.id}`).set(auth(u))
    expect(res.body.categories).toEqual([])
  })

  it('does not leak another server\'s categories', async () => {
    const u = await register()
    const one = await mkServer(u), two = await mkServer(u)
    await mkCategory(u, two.server.id, 'Theirs')
    const res = await app().get(`/servers/${one.server.id}`).set(auth(u))
    expect(res.body.categories).toEqual([])
  })

  // shapeChannel reads channels through `.lean()`, which skips hydration and
  // therefore skips the schema's `default: null` — a row written before the
  // `category` path existed comes back with the key simply absent, i.e.
  // `undefined`, not `null` (pinned in categoryModel.test.ts). The guard in
  // shapeChannel is what turns that into a clean `null` on the wire; without
  // it this request throws on `undefined.toString()` and every server that
  // predates categories fails to open.
  it('shapes a legacy channel row that has no category key at all as null', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const now = new Date()
    const { insertedId } = await mongoose.connection.collection('channels').insertOne({
      server: new mongoose.Types.ObjectId(server.id),
      name: 'legacy', type: 'text', position: 9, createdAt: now, updatedAt: now,
    })

    const res = await app().get(`/servers/${server.id}`).set(auth(u))
    expect(res.status).toBe(200)
    const legacy = res.body.channels.find((c: any) => c.id === insertedId.toString())
    expect(legacy).toBeTruthy()
    expect(legacy.category).toBeNull()
  })
})

describe('channel category assignment', () => {
  it('stores a category given at creation and returns it on the wire', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const cat = await mkCategory(u, server.id, 'Posts')
    const res = await mkChannel(u, server.id, { name: 'posts', category: cat.id })

    expect(res.status).toBe(201)
    expect(res.body.channel.category).toBe(cat.id)
    expect((await Channel.findById(res.body.channel.id))!.category!.toString()).toBe(cat.id)
  })

  it('defaults to uncategorised when no category is given', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await mkChannel(u, server.id, { name: 'loose' })
    expect(res.status).toBe(201)
    expect(res.body.channel.category).toBeNull()
  })

  it('refuses a category id belonging to another server and creates nothing', async () => {
    const u = await register()
    const one = await mkServer(u), two = await mkServer(u)
    const theirs = await mkCategory(u, two.server.id, 'Theirs')

    const res = await mkChannel(u, one.server.id, { name: 'sneaky', category: theirs.id })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/categor/i)
    // Not silently stored under a foreign category — not stored at all.
    expect(await Channel.countDocuments({ server: one.server.id })).toBe(2)
  })

  it('refuses a category id that does not exist', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await mkChannel(u, server.id, { name: 'x', category: String(new mongoose.Types.ObjectId()) })
    expect(res.status).toBe(400)
    expect(await Channel.countDocuments({ server: server.id })).toBe(2)
  })

  it('refuses a malformed category id', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const res = await mkChannel(u, server.id, { name: 'x', category: 'not-an-id' })
    expect(res.status).toBe(400)
    expect(await Channel.countDocuments({ server: server.id })).toBe(2)
  })

  it('moves a channel between categories via PATCH', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const from = await mkCategory(u, server.id, 'From')
    const to   = await mkCategory(u, server.id, 'To')
    const chan = (await mkChannel(u, server.id, { name: 'mover', category: from.id })).body.channel

    const res = await app().patch(`/servers/${server.id}/channels/${chan.id}`)
      .set(auth(u)).send({ category: to.id })
    expect(res.status).toBe(200)
    expect(res.body.channel.category).toBe(to.id)
    expect(res.body.channel.name).toBe('mover') // a category move is not a rename
    expect((await Channel.findById(chan.id))!.category!.toString()).toBe(to.id)
  })

  it('moves a channel back to uncategorised with category: null', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const cat  = await mkCategory(u, server.id, 'Posts')
    const chan = (await mkChannel(u, server.id, { name: 'mover', category: cat.id })).body.channel

    const res = await app().patch(`/servers/${server.id}/channels/${chan.id}`)
      .set(auth(u)).send({ category: null })
    expect(res.status).toBe(200)
    expect(res.body.channel.category).toBeNull()
    expect((await Channel.findById(chan.id))!.category).toBeNull()
  })

  it('renames and recategorises in one PATCH', async () => {
    const u = await register()
    const { server } = await mkServer(u)
    const cat  = await mkCategory(u, server.id, 'Posts')
    const chan = (await mkChannel(u, server.id, { name: 'before' })).body.channel

    const res = await app().patch(`/servers/${server.id}/channels/${chan.id}`)
      .set(auth(u)).send({ name: 'after', category: cat.id })
    expect(res.status).toBe(200)
    expect(res.body.channel.name).toBe('after')
    expect(res.body.channel.category).toBe(cat.id)
  })

  it('refuses to PATCH a channel into another server\'s category', async () => {
    const u = await register()
    const one = await mkServer(u), two = await mkServer(u)
    const theirs = await mkCategory(u, two.server.id, 'Theirs')
    const chan = one.channels.find((c: any) => c.type === 'text')

    const res = await app().patch(`/servers/${one.server.id}/channels/${chan.id}`)
      .set(auth(u)).send({ category: theirs.id })
    expect(res.status).toBe(400)
    expect((await Channel.findById(chan.id))!.category).toBeNull()
  })

  it('still rejects a PATCH that names nothing at all', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const chan = channels.find((c: any) => c.type === 'text')
    const res = await app().patch(`/servers/${server.id}/channels/${chan.id}`).set(auth(u)).send({})
    expect(res.status).toBe(400)
  })

  it('still rejects a blank rename even when a valid category rides along', async () => {
    const u = await register()
    const { server, channels } = await mkServer(u)
    const cat = await mkCategory(u, server.id, 'Posts')
    const chan = channels.find((c: any) => c.type === 'text')
    const res = await app().patch(`/servers/${server.id}/channels/${chan.id}`)
      .set(auth(u)).send({ name: '  ', category: cat.id })
    expect(res.status).toBe(400)
    expect((await Channel.findById(chan.id))!.category).toBeNull()
  })

  it('403s a non-owner member trying to move a channel', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const cat = await mkCategory(a, server.id, 'Posts')
    const chan = channels.find((c: any) => c.type === 'text')
    const res = await app().patch(`/servers/${server.id}/channels/${chan.id}`)
      .set(auth(b)).send({ category: cat.id })
    expect(res.status).toBe(403)
    expect((await Channel.findById(chan.id))!.category).toBeNull()
  })
})

describe('category socket events', () => {
  it('announces category:created to a connected member', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)

    const bSock = track(await connectSocket(sockets.url, b.token))
    const received = nextEvent(bSock, 'category:created')

    await app().post(`/servers/${server.id}/categories`).set(auth(a)).send({ name: 'Live' })

    const payload = await received
    expect(payload.serverId).toBe(server.id)
    expect(payload.category.name).toBe('Live')
    expect(payload.category.server).toBe(server.id)
  })

  it('announces category:updated to a connected member', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const cat = await mkCategory(a, server.id, 'Before')

    const bSock = track(await connectSocket(sockets.url, b.token))
    const received = nextEvent(bSock, 'category:updated')

    await app().patch(`/servers/${server.id}/categories/${cat.id}`).set(auth(a)).send({ name: 'After' })

    const payload = await received
    expect(payload.serverId).toBe(server.id)
    expect(payload.category.id).toBe(cat.id)
    expect(payload.category.name).toBe('After')
  })

  // Ids only: the client already knows which channels were in the category and
  // reparents them locally. Shipping the channel list here would make the
  // event a second source of truth for something the client can derive.
  it('announces category:deleted with ids only', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const cat = await mkCategory(a, server.id, 'Doomed')

    const bSock = track(await connectSocket(sockets.url, b.token))
    const received = nextEvent(bSock, 'category:deleted')

    await app().delete(`/servers/${server.id}/categories/${cat.id}`).set(auth(a))

    const payload = await received
    expect(Object.keys(payload).sort()).toEqual(['categoryId', 'serverId'])
    expect(payload.serverId).toBe(server.id)
    expect(payload.categoryId).toBe(cat.id)
  })

  it('does not announce to someone who is not a member', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)

    const bSock = track(await connectSocket(sockets.url, b.token))
    let seen = false
    bSock.on('category:created', () => { seen = true })

    await app().post(`/servers/${server.id}/categories`).set(auth(a)).send({ name: 'Private' })

    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
  })
})
