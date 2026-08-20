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
  it('is null by default, which is what every pre-existing channel already reads as', async () => {
    const c = await Channel.create({ server: server(), name: 'general' })
    expect(c.category).toBeNull()
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
