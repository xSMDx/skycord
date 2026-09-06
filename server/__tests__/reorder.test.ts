import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { Channel } from '../models/Channel'
import { Role } from '../models/Role'
import { PERMISSIONS, serializeBits } from '../permissions'
import { slotsFor } from '../controllers/reorderController'

/**
 * Ordering the sidebar.
 *
 * `position` was written on create and never again, so this is a new write path
 * over data every existing server already has. The two things worth proving are
 * that a reorder does what was asked WITHIN a bucket, and that it leaves every
 * other bucket alone — the failure that would matter is one category's drag
 * quietly reshuffling another's.
 */

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'RO' })).body.server

const mkCategory = async (u: TestUser, sid: string, name = 'Cat') =>
  (await app().post(`/servers/${sid}/categories`).set(auth(u)).send({ name })).body.category

const mkChannel = async (
  u: TestUser, sid: string, name: string,
  type: 'text' | 'voice' = 'text', category: string | null = null,
) =>
  (await app().post(`/servers/${sid}/channels`).set(auth(u))
    .send({ name, type, category })).body.channel

const orderChannels = (
  u: TestUser, sid: string, body: Record<string, unknown>,
) => app().put(`/servers/${sid}/channels/order`).set(auth(u)).send(body)

const orderCategories = (u: TestUser, sid: string, order: string[]) =>
  app().put(`/servers/${sid}/categories/order`).set(auth(u)).send({ order })

/** Channel names in stored order, for one bucket. */
const namesIn = async (sid: string, type: 'text' | 'voice', category: string | null) => {
  const rows = await Channel.find({ server: sid, type, category }).sort({ position: 1 }).lean()
  return rows.map(r => r.name)
}

describe('slotsFor', () => {
  it('returns the same slots it was given, in ascending order', () => {
    expect(slotsFor([3, 1, 2])).toEqual([1, 2, 3])
  })

  it('breaks duplicates upward so no two rows can share a slot', () => {
    // Duplicate positions are reachable — two creations racing — and handing
    // the same slot to two rows would leave their order undefined, which is
    // the exact complaint this endpoint exists to fix.
    expect(slotsFor([2, 2, 2])).toEqual([2, 3, 4])
    expect(slotsFor([0, 0, 5])).toEqual([0, 1, 5])
  })

  it('handles the empty and single cases without inventing a slot', () => {
    expect(slotsFor([])).toEqual([])
    expect(slotsFor([7])).toEqual([7])
  })
})

describe('PUT /servers/:sid/channels/order', () => {
  it('leaves the stored order untouched when the request is rejected', async () => {
    // Validation happens before any write, so a bad order cannot half-apply.
    // A partially reordered sidebar would be worse than a refused drag: the
    // person would have to work out what actually moved.
    const u = await register()
    const s = await mkServer(u)
    // The server ships with a 'general' text channel already.
    const a = await mkChannel(u, s.id, 'alpha')
    const b = await mkChannel(u, s.id, 'bravo')

    // Valid ids, valid bucket — but 'general' is missing and 'bravo' is twice.
    const res = await orderChannels(u, s.id, {
      type: 'text', category: null, order: [b.id, a.id, b.id],
    })
    expect(res.status).toBe(400)
    expect(await namesIn(s.id, 'text', null)).toEqual(['general', 'alpha', 'bravo'])
  })

  it('reverses a bucket when asked', async () => {
    const u = await register()
    const s = await mkServer(u)
    const a = await mkChannel(u, s.id, 'alpha')
    const b = await mkChannel(u, s.id, 'bravo')
    const general = (await Channel.findOne({ server: s.id, name: 'general' }).lean())!

    const res = await orderChannels(u, s.id, {
      type: 'text', category: null, order: [b.id, a.id, general._id.toString()],
    })
    expect(res.status).toBe(200)
    expect(res.body.channels.map((c: any) => c.name)).toEqual(['bravo', 'alpha', 'general'])
    expect(await namesIn(s.id, 'text', null)).toEqual(['bravo', 'alpha', 'general'])
  })

  it('leaves every other bucket untouched', async () => {
    // The failure that would actually hurt: one category's drag reshuffling
    // another's, because positions are shared across the whole server.
    const u = await register()
    const s = await mkServer(u)
    const cat = await mkCategory(u, s.id)
    const x = await mkChannel(u, s.id, 'x', 'text', cat.id)
    const y = await mkChannel(u, s.id, 'y', 'text', cat.id)
    const a = await mkChannel(u, s.id, 'alpha')
    const b = await mkChannel(u, s.id, 'bravo')

    const before = await namesIn(s.id, 'text', null)
    const res = await orderChannels(u, s.id, {
      type: 'text', category: cat.id, order: [y.id, x.id],
    })
    expect(res.status).toBe(200)
    expect(await namesIn(s.id, 'text', cat.id)).toEqual(['y', 'x'])
    expect(await namesIn(s.id, 'text', null)).toEqual(before)
    // And the voice bucket, which shares nothing but the server.
    expect(await namesIn(s.id, 'voice', null)).toEqual(['General'])
  })

  it('keeps text and voice separate inside one category', async () => {
    const u = await register()
    const s = await mkServer(u)
    const cat = await mkCategory(u, s.id)
    const t1 = await mkChannel(u, s.id, 't1', 'text', cat.id)
    const t2 = await mkChannel(u, s.id, 't2', 'text', cat.id)
    const v1 = await mkChannel(u, s.id, 'v1', 'voice', cat.id)
    const v2 = await mkChannel(u, s.id, 'v2', 'voice', cat.id)

    await orderChannels(u, s.id, { type: 'voice', category: cat.id, order: [v2.id, v1.id] })
    expect(await namesIn(s.id, 'voice', cat.id)).toEqual(['v2', 'v1'])
    expect(await namesIn(s.id, 'text', cat.id)).toEqual(['t1', 't2'])
  })

  it('refuses a list that omits a channel', async () => {
    // A stale list. Applying it would leave the missing channel wherever it
    // happened to be, which is an order nobody chose.
    const u = await register()
    const s = await mkServer(u)
    const a = await mkChannel(u, s.id, 'alpha')

    const res = await orderChannels(u, s.id, { type: 'text', category: null, order: [a.id] })
    expect(res.status).toBe(409)
  })

  it('refuses a list naming a channel from another bucket', async () => {
    const u = await register()
    const s = await mkServer(u)
    const cat = await mkCategory(u, s.id)
    const inside = await mkChannel(u, s.id, 'inside', 'text', cat.id)

    const res = await orderChannels(u, s.id, {
      type: 'text', category: null, order: [inside.id],
    })
    expect(res.status).toBe(409)
  })

  it('refuses the same id twice', async () => {
    const u = await register()
    const s = await mkServer(u)
    const cat = await mkCategory(u, s.id)
    const x = await mkChannel(u, s.id, 'x', 'text', cat.id)

    const res = await orderChannels(u, s.id, {
      type: 'text', category: cat.id, order: [x.id, x.id],
    })
    expect(res.status).toBe(400)
  })

  it('rejects a missing or unknown type, and an unknown category', async () => {
    const u = await register()
    const s = await mkServer(u)
    expect((await orderChannels(u, s.id, { category: null, order: [] })).status).toBe(400)
    expect((await orderChannels(u, s.id, { type: 'audio', order: [] })).status).toBe(400)
    expect((await orderChannels(u, s.id, {
      type: 'text', category: '6a9c0000f32332598f1f9563', order: [],
    })).status).toBe(404)
    expect((await orderChannels(u, s.id, {
      type: 'text', category: 'nonsense', order: [],
    })).status).toBe(404)
  })

  it('rejects an order that is not a list', async () => {
    const u = await register()
    const s = await mkServer(u)
    expect((await orderChannels(u, s.id, {
      type: 'text', category: null, order: 'first',
    })).status).toBe(400)
  })

  it('needs ManageChannels, not merely membership', async () => {
    const owner = await register()
    const member = await register()
    const s = await mkServer(owner)
    await Server.updateOne({ _id: s.id }, { $push: { members: member.id } })
    const a = await mkChannel(owner, s.id, 'alpha')
    const general = (await Channel.findOne({ server: s.id, name: 'general' }).lean())!

    const res = await orderChannels(member, s.id, {
      type: 'text', category: null, order: [a.id, general._id.toString()],
    })
    expect(res.status).toBe(403)
    expect(await namesIn(s.id, 'text', null)).toEqual(['general', 'alpha'])
  })

  it('accepts a moderator holding ManageChannels', async () => {
    const owner = await register()
    const mod = await register()
    const s = await mkServer(owner)
    await Server.updateOne({ _id: s.id }, { $push: { members: mod.id } })
    const role = await Role.create({
      server: s.id, name: 'mod', position: 5,
      permissions: serializeBits(PERMISSIONS.ManageChannels | PERMISSIONS.ViewChannels),
    })
    await Server.updateOne({ _id: s.id }, { $push: { memberRoles: { user: mod.id, roles: [role._id] } } })

    const a = await mkChannel(owner, s.id, 'alpha')
    const general = (await Channel.findOne({ server: s.id, name: 'general' }).lean())!
    const res = await orderChannels(mod, s.id, {
      type: 'text', category: null, order: [a.id, general._id.toString()],
    })
    expect(res.status).toBe(200)
    expect(await namesIn(s.id, 'text', null)).toEqual(['alpha', 'general'])
  })

  it('refuses a stranger to the server', async () => {
    const owner = await register()
    const outsider = await register()
    const s = await mkServer(owner)
    expect((await orderChannels(outsider, s.id, {
      type: 'text', category: null, order: [],
    })).status).toBe(403)
  })

  it('is a no-op when the order is already what is stored', async () => {
    const u = await register()
    const s = await mkServer(u)
    const a = await mkChannel(u, s.id, 'alpha')
    const general = (await Channel.findOne({ server: s.id, name: 'general' }).lean())!
    const before = await Channel.find({ server: s.id, type: 'text' }).sort({ position: 1 }).lean()

    const res = await orderChannels(u, s.id, {
      type: 'text', category: null, order: [general._id.toString(), a.id],
    })
    expect(res.status).toBe(200)
    const after = await Channel.find({ server: s.id, type: 'text' }).sort({ position: 1 }).lean()
    expect(after.map(c => c.position)).toEqual(before.map(c => c.position))
  })
})

describe('PUT /servers/:sid/categories/order', () => {
  it('orders the categories', async () => {
    const u = await register()
    const s = await mkServer(u)
    const a = await mkCategory(u, s.id, 'A')
    const b = await mkCategory(u, s.id, 'B')
    const c = await mkCategory(u, s.id, 'C')

    const res = await orderCategories(u, s.id, [c.id, a.id, b.id])
    expect(res.status).toBe(200)
    expect(res.body.categories.map((x: any) => x.name)).toEqual(['C', 'A', 'B'])
  })

  it('refuses an incomplete list', async () => {
    const u = await register()
    const s = await mkServer(u)
    const a = await mkCategory(u, s.id, 'A')
    await mkCategory(u, s.id, 'B')

    expect((await orderCategories(u, s.id, [a.id])).status).toBe(409)
  })

  it('needs ManageChannels', async () => {
    const owner = await register()
    const member = await register()
    const s = await mkServer(owner)
    await Server.updateOne({ _id: s.id }, { $push: { members: member.id } })
    const a = await mkCategory(owner, s.id, 'A')

    expect((await orderCategories(member, s.id, [a.id])).status).toBe(403)
  })

  it('does not disturb the channels inside them', async () => {
    const u = await register()
    const s = await mkServer(u)
    const a = await mkCategory(u, s.id, 'A')
    const b = await mkCategory(u, s.id, 'B')
    await mkChannel(u, s.id, 'a1', 'text', a.id)
    await mkChannel(u, s.id, 'a2', 'text', a.id)

    await orderCategories(u, s.id, [b.id, a.id])
    expect(await namesIn(s.id, 'text', a.id)).toEqual(['a1', 'a2'])
  })
})
