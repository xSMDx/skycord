import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { connectDb, disconnectDb, resetDb } from './helpers'
import { Channel } from '../models/Channel'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

describe('Channel model', () => {
  const server = () => new mongoose.Types.ObjectId()

  it('defaults to a text channel at position 0', async () => {
    const c = await Channel.create({ server: server(), name: 'general' })
    expect(c.type).toBe('text')
    expect(c.position).toBe(0)
  })

  it('stores voice channels', async () => {
    const c = await Channel.create({ server: server(), name: 'General', type: 'voice' })
    expect(c.type).toBe('voice')
  })

  it('rejects an unknown type', async () => {
    await expect(
      Channel.create({ server: server(), name: 'x', type: 'forum' as never })
    ).rejects.toThrow()
  })

  it('keeps emoji in names', async () => {
    const c = await Channel.create({ server: server(), name: '💬general-chat' })
    expect(c.name).toBe('💬general-chat')
  })
})
