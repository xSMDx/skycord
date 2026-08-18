import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth } from './helpers'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

describe('test harness', () => {
  it('serves /health', async () => {
    const res = await app().get('/health')
    expect(res.status).toBe(200)
  })

  it('registers a user and authenticates with the token', async () => {
    const u = await register()
    const res = await app().get('/users/friends').set(auth(u))
    expect(res.status).toBe(200)
    expect(res.body.friends).toEqual([])
  })
})
