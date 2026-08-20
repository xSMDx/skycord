import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { connectDb, disconnectDb, resetDb } from './helpers'
import { Category } from '../models/Category'
import { Channel } from '../models/Channel'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const server = () => new mongoose.Types.ObjectId()

describe('Category model', () => {
  it('defaults to position 0', async () => {
    const c = await Category.create({ server: server(), name: 'Text Channels' })
    expect(c.position).toBe(0)
  })

  it('requires a name', async () => {
    await expect(Category.create({ server: server() })).rejects.toThrow()
  })

  it('requires a server', async () => {
    await expect(Category.create({ name: 'Orphan' })).rejects.toThrow()
  })

  it('caps the name length', async () => {
    await expect(Category.create({ server: server(), name: 'x'.repeat(101) })).rejects.toThrow()
  })
})

describe('Channel.category', () => {
  it('is null by default on a newly created channel', async () => {
    const c = await Channel.create({ server: server(), name: 'general' })
    expect(c.category).toBeNull()
  })

  it('on a legacy row written before the field existed, hydrated reads null but .lean() reads undefined', async () => {
    // Simulates a channel document from before `category` was added to the
    // schema: inserted through the raw driver, bypassing Mongoose entirely,
    // so there is no `category` key in the stored row at all.
    const now = new Date()
    const { insertedId } = await mongoose.connection.collection('channels').insertOne({
      server: server(), name: 'general', type: 'text', position: 0,
      createdAt: now, updatedAt: now,
    })

    // Hydration runs the raw row through the schema, which backfills the
    // declared `default: null` for any path missing from the document — so
    // a hydrated read of a legacy row looks identical to a freshly created
    // uncategorised channel. `.lean()` skips hydration and returns the raw
    // driver object unmodified: no schema, no defaults, so the missing key
    // stays missing and reads as `undefined`, not `null`. Code that branches
    // on `=== null` vs `=== undefined` (rather than just falsiness) will see
    // different things depending on which read path it used — and
    // serversController, channelsController and chatSocket all read
    // channels via `.lean()`.
    const hydrated = await Channel.findById(insertedId)
    expect(hydrated!.category).toBeNull()

    const lean = await Channel.findById(insertedId).lean()
    expect(lean!.category).toBeUndefined()

    // No manual cleanup: `resetDb` (beforeEach in helpers.ts) deletes every
    // document in every collection before the next test runs.
  })

  it('stores a category reference', async () => {
    const sid = server()
    const cat = await Category.create({ server: sid, name: 'POSTS' })
    const ch  = await Channel.create({ server: sid, name: 'posts', category: cat._id })
    expect(ch.category!.toString()).toBe(cat._id.toString())
  })

  it('can be cleared back to uncategorised', async () => {
    const sid = server()
    const cat = await Category.create({ server: sid, name: 'POSTS' })
    const ch  = await Channel.create({ server: sid, name: 'posts', category: cat._id })
    await Channel.updateOne({ _id: ch._id }, { category: null })
    const fresh = await Channel.findById(ch._id).lean()
    expect(fresh!.category).toBeNull()
  })
})
