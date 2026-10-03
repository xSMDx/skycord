/**
 * The endpoint the music container calls back on.
 *
 * It is the one route in the API authenticated by a shared secret rather
 * than a session, which makes "who may call it" the whole of what matters
 * here — including the case nobody thinks about, where music is not
 * configured at all and the expected secret is the empty string.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import express from 'express'
import { internalMusicRouter } from '../routes/internalMusic'
import { connectDb, disconnectDb, resetDb } from './helpers'

const SECRET = 'music-secret-for-tests'

beforeAll(async () => {
  await connectDb()
})
afterAll(async () => { await disconnectDb() })
beforeEach(async () => { await resetDb() })

const post = (body: unknown, secret?: string) => {
  // The router under test, mounted on its own: the secret is injected, so
  // this needs no environment and no ordering against module load.
  const app = express()
  app.use(express.json())
  app.use('/internal', internalMusicRouter({ secret: SECRET }))
  const req = request(app).post('/internal/music/ended').send(body as object)
  return secret === undefined ? req : req.set('x-music-secret', secret)
}

describe('authorisation', () => {
  it('refuses a call with no secret', async () => {
    await post({ room: 'voice:1', channelId: 'c' }).expect(401)
  })

  it('refuses a wrong secret', async () => {
    await post({ room: 'voice:1', channelId: 'c' }, 'nope').expect(401)
  })

  it('refuses a prefix of the real secret', async () => {
    await post({ room: 'voice:1', channelId: 'c' }, SECRET.slice(0, -1)).expect(401)
  })

  it('accepts the right secret', async () => {
    await post({ room: 'voice:1', channelId: 'nothing-here' }, SECRET).expect(200)
  })
})

describe('input', () => {
  it('requires room and channelId', async () => {
    for (const body of [{}, { room: 'voice:1' }, { channelId: 'c' }, { room: 1, channelId: 'c' }]) {
      await post(body, SECRET).expect(400)
    }
  })

  it('answers 200 for a channel that is already gone, rather than resurrecting it', async () => {
    // The service can report an end for a channel the API tore down a moment
    // earlier. That is ordinary, not an error.
    await post({ room: 'voice:gone', channelId: 'also-gone' }, SECRET).expect(200)
  })
})
