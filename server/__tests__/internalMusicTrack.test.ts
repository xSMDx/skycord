/**
 * The route the music container reads library audio from.
 *
 * This one hands out the actual bytes of a member's file to anyone holding
 * the shared secret, which makes it the most sensitive thing in the music
 * feature. The audio is in GridFS precisely so the container that fetches
 * attacker-supplied URLs has no database credentials; the value of that
 * split evaporates if this route is reachable without the secret.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import express from 'express'
import { Types } from 'mongoose'
import { Readable } from 'stream'
import { internalMusicRouter } from '../routes/internalMusic'
import { Track } from '../models/Track'
import { trackStore } from '../utils/trackStore'
import { connectDb, disconnectDb, resetDb } from './helpers'

const SECRET = 'music-secret-for-tests'
const AUDIO = Buffer.from('not really opus, but it is bytes and that is the point')

beforeAll(async () => { await connectDb() })
afterAll(async () => { await disconnectDb() })
beforeEach(async () => { await resetDb() })

const serve = () => {
  const app = express()
  app.use(express.json())
  app.use('/internal', internalMusicRouter({ secret: SECRET }))
  return request(app)
}

/** A real track, with real bytes in GridFS behind it. */
const aTrack = async (): Promise<string> => {
  const ownerId = new Types.ObjectId()
  const stored = await trackStore.put(Readable.from([AUDIO]), { ownerId, mimeType: 'audio/webm' })
  const doc = await Track.create({
    ownerId,
    title: 'Blue Monday', artist: 'New Order', album: 'Power, Corruption & Lies',
    durationSec: 12, bytes: stored.bytes,
    store: stored.ref, source: 'upload', scan: 'skipped',
  })
  return String(doc._id)
}

const get = (id: string, secret?: string) => {
  const req = serve().get(`/internal/music/track/${id}/audio`)
  return secret === undefined ? req : req.set('x-music-secret', secret)
}

describe('authorisation', () => {
  it('refuses a request with no secret', async () => {
    await get(await aTrack()).expect(401)
  })

  it('refuses a wrong secret', async () => {
    await get(await aTrack(), 'nope').expect(401)
  })

  it('refuses a secret of the wrong length without comparing contents', async () => {
    // timingSafeEqual throws on a length mismatch, so the length check has
    // to come first or an attacker gets a 500 instead of a 401 and learns
    // the length from the difference.
    await get(await aTrack(), 'x').expect(401)
  })

  it('refuses everything when no secret is configured', async () => {
    // An instance that never turned music on has an empty expected secret.
    // Comparing '' to '' would make this route public on every one of them.
    const app = express()
    app.use('/internal', internalMusicRouter({ secret: '' }))
    const id = await aTrack()
    await request(app).get(`/internal/music/track/${id}/audio`).expect(401)
    await request(app).get(`/internal/music/track/${id}/audio`).set('x-music-secret', '').expect(401)
  })
})

describe('reading a track', () => {
  it('streams the stored bytes with the right length', async () => {
    const res = await get(await aTrack(), SECRET).expect(200)
    expect(res.headers['content-type']).toContain('audio/webm')
    expect(Number(res.headers['content-length'])).toBe(AUDIO.length)
    expect(Buffer.from(res.body).equals(AUDIO)).toBe(true)
  })

  it('answers 404 for a track that does not exist', async () => {
    await get(new Types.ObjectId().toHexString(), SECRET).expect(404)
  })

  it('answers 404 rather than 500 for an id that is not an id', async () => {
    // Casting a bad id throws inside Mongoose, which without the guard
    // would surface as a 500 and, in an async handler, as a hang.
    await get('not-an-object-id', SECRET).expect(404)
  })

  it('checks the secret before it looks anything up', async () => {
    // A 401 for a nonexistent track proves the order: an unauthorised
    // caller must not be able to probe which ids exist.
    await get(new Types.ObjectId().toHexString(), 'nope').expect(401)
  })
})
