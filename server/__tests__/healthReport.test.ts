import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb } from './helpers'
import { healthBody, healthStatus } from '../utils/health'

beforeAll(connectDb)
afterAll(disconnectDb)

/**
 * What `/health` says, rather than merely that it answers — the harness smoke
 * test in health.test.ts covers that. An update reads this to decide whether
 * the version it just started is really running and really has its database.
 */
describe('the health report', () => {
  it('reports the version and a reachable database', () => {
    expect(healthBody(1, 'v0.19.1')).toEqual({ status: 'ok', version: 'v0.19.1', db: 'up' })
    expect(healthStatus(1)).toBe(200)
  })

  it('answers 503 while the database is not connected', () => {
    expect(healthBody(0, 'dev')).toEqual({ status: 'degraded', version: 'dev', db: 'down' })
    expect(healthStatus(0)).toBe(503)
    // Connecting is not connected: an update must not call a half-started
    // server healthy and walk away.
    expect(healthStatus(2)).toBe(503)
  })

  it('serves the running version over HTTP', async () => {
    const res = await app().get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' })
    expect(typeof res.body.version).toBe('string')
  })
})
