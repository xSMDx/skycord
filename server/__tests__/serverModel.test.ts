import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import { connectDb, disconnectDb, resetDb } from './helpers'
import { Server, MAX_SERVER_MEMBERS } from '../models/Server'
import { generateInviteCode, inviteExpiry } from '../utils/inviteCode'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

describe('Server model', () => {
  it('caps members at 100', () => {
    expect(MAX_SERVER_MEMBERS).toBe(100)
  })

  it('stores a server with its optional decoration fields', async () => {
    const owner = new mongoose.Types.ObjectId()
    const s = await Server.create({
      name: 'EA', owner, members: [owner],
      bannerColor: '#e74c3c', description: 'a test server',
    })
    expect(s.name).toBe('EA')
    expect(s.icon).toBeNull()
    expect(s.iconCrop).toBeNull()
    expect(s.members).toHaveLength(1)
  })

  it('accepts an emoji name', async () => {
    const owner = new mongoose.Types.ObjectId()
    const s = await Server.create({ name: '🎮 gaming', owner, members: [owner] })
    expect(s.name).toBe('🎮 gaming')
  })
})

describe('inviteCode util', () => {
  it('generates url-safe codes that differ', () => {
    const a = generateInviteCode(), b = generateInviteCode()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('expires 24 hours out', () => {
    const ms = inviteExpiry().getTime() - Date.now()
    expect(ms).toBeGreaterThan(23 * 3600_000)
    expect(ms).toBeLessThanOrEqual(24 * 3600_000)
  })
})
