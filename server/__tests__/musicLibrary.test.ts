/**
 * A member's own tracks and playlists, over the real routes.
 *
 * Every handler in this controller is scoped to the caller, and that is the
 * whole of its authorisation — there are no roles here and no sharing flag.
 * So most of what follows is one member trying to read or change another
 * member's things, which has to fail the same way a thing that does not
 * exist fails, or the endpoint becomes a way to find out what exists.
 *
 * It is also the file that would have caught the bug that shipped these
 * routes hanging: the controller read `req.userId`, which is not a thing,
 * so the ObjectId cast threw and Express 4 answered nothing at all. A
 * single request in a test would have said so in a second.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import { Readable } from 'stream'
import { app, auth, connectDb, disconnectDb, register, resetDb, type TestUser } from './helpers'
import { Track } from '../models/Track'
import { Playlist } from '../models/Playlist'
import { trackStore } from '../utils/trackStore'

const AUDIO = Buffer.from('pretend this is opus; the bytes only have to come back')

let me: TestUser
let someoneElse: TestUser

beforeAll(async () => { await connectDb() })
afterAll(async () => { await disconnectDb() })
beforeEach(async () => {
  await resetDb()
  me = await register()
  someoneElse = await register()
})

/** A track with real bytes behind it, owned by whoever is asked for. */
const giveTrack = async (owner: TestUser, over: Partial<{
  title: string; artist: string; album: string; bytes: number; scan: string
}> = {}): Promise<string> => {
  const ownerId = new Types.ObjectId(owner.id)
  const stored = await trackStore.put(Readable.from([AUDIO]), { ownerId, mimeType: 'audio/webm' })
  const doc = await Track.create({
    ownerId,
    title:  over.title  ?? 'Blue Monday',
    artist: over.artist ?? 'New Order',
    album:  over.album  ?? 'Power, Corruption & Lies',
    durationSec: 270,
    bytes: over.bytes ?? stored.bytes,
    store: stored.ref,
    source: 'upload',
    scan: over.scan ?? 'skipped',
  })
  return String(doc._id)
}

const makeList = async (owner: TestUser, name = 'Late Nights'): Promise<string> => {
  const r = await app().post('/music/playlists').set(auth(owner)).send({ name })
  expect(r.status).toBe(201)
  return r.body.playlist.id
}

// ── tracks ──────────────────────────────────────────────────────────────────

describe('listing a library', () => {
  it('needs a session', async () => {
    await app().get('/music/tracks').expect(401)
  })

  it('answers, rather than hanging, for a member with nothing', async () => {
    // The regression this file exists for: a throw in the handler left the
    // request open forever instead of erroring.
    const r = await app().get('/music/tracks').set(auth(me)).expect(200)
    expect(r.body.tracks).toEqual([])
    expect(r.body.usage).toEqual({ tracks: 0, bytes: 0 })
    expect(r.body.caps.tracksPerMember).toBeGreaterThan(0)
  })

  it('returns only your own tracks', async () => {
    await giveTrack(me, { title: 'Mine' })
    await giveTrack(someoneElse, { title: 'Theirs' })

    const r = await app().get('/music/tracks').set(auth(me)).expect(200)
    expect(r.body.tracks.map((t: { title: string }) => t.title)).toEqual(['Mine'])
  })

  it('reports usage from the tracks, not from a counter that can drift', async () => {
    await giveTrack(me, { bytes: 1000 })
    await giveTrack(me, { bytes: 2500 })
    const r = await app().get('/music/tracks').set(auth(me)).expect(200)
    expect(r.body.usage).toEqual({ tracks: 2, bytes: 3500 })
  })

  it('never exposes where the audio is stored', async () => {
    await giveTrack(me)
    const r = await app().get('/music/tracks').set(auth(me)).expect(200)
    expect(r.body.tracks[0]).not.toHaveProperty('store')
    expect(r.body.tracks[0]).not.toHaveProperty('ownerId')
  })

  it('searches title, artist and album', async () => {
    await giveTrack(me, { title: 'Blue Monday', artist: 'New Order', album: 'PCL' })
    await giveTrack(me, { title: 'Temporary Secretary', artist: 'Paul McCartney', album: 'McCartney II' })

    const byTitle = await app().get('/music/tracks?q=Monday').set(auth(me)).expect(200)
    expect(byTitle.body.tracks).toHaveLength(1)

    const byArtist = await app().get('/music/tracks?q=McCartney').set(auth(me)).expect(200)
    expect(byArtist.body.tracks.map((t: { title: string }) => t.title)).toEqual(['Temporary Secretary'])
  })

  it('does not let a search reach another member', async () => {
    await giveTrack(someoneElse, { title: 'Secret' })
    const r = await app().get('/music/tracks?q=Secret').set(auth(me)).expect(200)
    expect(r.body.tracks).toEqual([])
  })
})

describe('deleting a track', () => {
  it('removes the document and the stored bytes', async () => {
    const id = await giveTrack(me)
    const before = await Track.findById(id)
    await app().delete(`/music/tracks/${id}`).set(auth(me)).expect(200)

    expect(await Track.findById(id)).toBeNull()
    // The blob goes with it, or GridFS fills with orphans nobody can find.
    const read = trackStore.open(before!.store as { kind: 'gridfs'; id: Types.ObjectId })
    await expect(new Promise((res, rej) => {
      read.on('data', () => {}); read.on('end', res); read.on('error', rej)
    })).rejects.toBeTruthy()
  })

  it('will not delete someone else\'s, and says the same thing as missing', async () => {
    const theirs = await giveTrack(someoneElse)
    const a = await app().delete(`/music/tracks/${theirs}`).set(auth(me)).expect(404)
    const b = await app().delete(`/music/tracks/${new Types.ObjectId()}`).set(auth(me)).expect(404)
    expect(a.body.message).toBe(b.body.message)
    expect(await Track.findById(theirs)).not.toBeNull()
  })

  it('answers 404 for an id that is not an id', async () => {
    await app().delete('/music/tracks/not-an-id').set(auth(me)).expect(404)
  })
})

describe('streaming a track', () => {
  it('sends the bytes, and says it accepts ranges', async () => {
    const id = await giveTrack(me)
    const r = await app().get(`/music/tracks/${id}/audio`).set(auth(me)).expect(200)
    expect(r.headers['accept-ranges']).toBe('bytes')
    expect(Buffer.from(r.body).equals(AUDIO)).toBe(true)
  })

  it('honours a range, inclusive at both ends', async () => {
    // GridFS takes an exclusive end and HTTP does not; conflating them drops
    // the last byte of every ranged response, which is the kind of bug that
    // only shows up as audio that will not seek.
    const id = await giveTrack(me)
    const r = await app().get(`/music/tracks/${id}/audio`)
      .set(auth(me)).set('Range', 'bytes=0-9').expect(206)

    expect(r.headers['content-range']).toBe(`bytes 0-9/${AUDIO.length}`)
    expect(r.headers['content-length']).toBe('10')
    expect(Buffer.from(r.body).equals(AUDIO.subarray(0, 10))).toBe(true)
  })

  it('serves an open-ended range to the end of the file', async () => {
    const id = await giveTrack(me)
    const r = await app().get(`/music/tracks/${id}/audio`)
      .set(auth(me)).set('Range', 'bytes=5-').expect(206)
    expect(Buffer.from(r.body).equals(AUDIO.subarray(5))).toBe(true)
  })

  it('refuses a range that starts past the end', async () => {
    const id = await giveTrack(me)
    await app().get(`/music/tracks/${id}/audio`)
      .set(auth(me)).set('Range', `bytes=${AUDIO.length + 10}-`).expect(416)
  })

  it('will not stream someone else\'s audio', async () => {
    const theirs = await giveTrack(someoneElse)
    await app().get(`/music/tracks/${theirs}/audio`).set(auth(me)).expect(404)
  })
})

describe('adding a track when no music service is configured', () => {
  // The normal case for a self-hoster: music off, and every route that would
  // reach the service has to say so rather than fail obscurely.
  it('refuses an upload with an explanation', async () => {
    const r = await app().post('/music/tracks/upload')
      .set(auth(me)).set('Content-Type', 'audio/mpeg').send('nope').expect(503)
    expect(r.body.message).toMatch(/not available/i)
  })

  it('refuses an import the same way', async () => {
    const r = await app().post('/music/tracks/import')
      .set(auth(me)).send({ url: 'https://example.com/a.mp3' }).expect(503)
    expect(r.body.message).toMatch(/not available/i)
  })
})

// ── playlists ───────────────────────────────────────────────────────────────

describe('playlists', () => {
  it('starts empty and needs a session', async () => {
    await app().get('/music/playlists').expect(401)
    const r = await app().get('/music/playlists').set(auth(me)).expect(200)
    expect(r.body.playlists).toEqual([])
  })

  it('creates one and lists it', async () => {
    const r = await app().post('/music/playlists').set(auth(me))
      .send({ name: 'Late Nights' }).expect(201)
    expect(r.body.playlist).toMatchObject({ name: 'Late Nights', count: 0 })

    const list = await app().get('/music/playlists').set(auth(me)).expect(200)
    expect(list.body.playlists).toHaveLength(1)
  })

  it('refuses a nameless or absurd name', async () => {
    await app().post('/music/playlists').set(auth(me)).send({}).expect(400)
    await app().post('/music/playlists').set(auth(me)).send({ name: '   ' }).expect(400)
    await app().post('/music/playlists').set(auth(me))
      .send({ name: 'x'.repeat(200) }).expect(400)
  })

  it('does not list another member\'s', async () => {
    await makeList(someoneElse, 'Theirs')
    const r = await app().get('/music/playlists').set(auth(me)).expect(200)
    expect(r.body.playlists).toEqual([])
  })

  it('adds a track and resolves it in order', async () => {
    const list = await makeList(me)
    const a = await giveTrack(me, { title: 'First' })
    const b = await giveTrack(me, { title: 'Second' })

    await app().post(`/music/playlists/${list}/tracks`).set(auth(me)).send({ trackId: a }).expect(200)
    await app().post(`/music/playlists/${list}/tracks`).set(auth(me)).send({ trackId: b }).expect(200)

    const r = await app().get(`/music/playlists/${list}`).set(auth(me)).expect(200)
    expect(r.body.playlist.tracks.map((t: { title: string }) => t.title)).toEqual(['First', 'Second'])
  })

  it('allows the same track twice, because a sequence may want it', async () => {
    const list = await makeList(me)
    const a = await giveTrack(me, { title: 'Again' })
    await app().post(`/music/playlists/${list}/tracks`).set(auth(me)).send({ trackId: a }).expect(200)
    await app().post(`/music/playlists/${list}/tracks`).set(auth(me)).send({ trackId: a }).expect(200)

    const r = await app().get(`/music/playlists/${list}`).set(auth(me)).expect(200)
    expect(r.body.playlist.tracks).toHaveLength(2)
  })

  it('removes by position, so duplicates can be told apart', async () => {
    const list = await makeList(me)
    const a = await giveTrack(me, { title: 'One' })
    const b = await giveTrack(me, { title: 'Two' })
    for (const t of [a, b, a]) {
      await app().post(`/music/playlists/${list}/tracks`).set(auth(me)).send({ trackId: t }).expect(200)
    }

    // Take out the middle entry; both copies of `a` must survive.
    await app().delete(`/music/playlists/${list}/tracks/1`).set(auth(me)).expect(200)
    const r = await app().get(`/music/playlists/${list}`).set(auth(me)).expect(200)
    expect(r.body.playlist.tracks.map((t: { title: string }) => t.title)).toEqual(['One', 'One'])
  })

  it('refuses a position that is not in the list', async () => {
    const list = await makeList(me)
    await app().delete(`/music/playlists/${list}/tracks/0`).set(auth(me)).expect(404)
    await app().delete(`/music/playlists/${list}/tracks/-1`).set(auth(me)).expect(404)
    await app().delete(`/music/playlists/${list}/tracks/nope`).set(auth(me)).expect(404)
  })

  it('will not add a track you do not own', async () => {
    // Otherwise a guessed id could be added and its title read straight back
    // out of the playlist view.
    const list = await makeList(me)
    const theirs = await giveTrack(someoneElse, { title: 'Private' })
    await app().post(`/music/playlists/${list}/tracks`).set(auth(me))
      .send({ trackId: theirs }).expect(404)

    const r = await app().get(`/music/playlists/${list}`).set(auth(me)).expect(200)
    expect(r.body.playlist.tracks).toEqual([])
  })

  it('will not touch another member\'s playlist', async () => {
    const theirs = await makeList(someoneElse)
    const mine = await giveTrack(me)
    await app().get(`/music/playlists/${theirs}`).set(auth(me)).expect(404)
    await app().patch(`/music/playlists/${theirs}`).set(auth(me)).send({ name: 'Mine now' }).expect(404)
    await app().delete(`/music/playlists/${theirs}`).set(auth(me)).expect(404)
    await app().post(`/music/playlists/${theirs}/tracks`).set(auth(me)).send({ trackId: mine }).expect(404)
  })

  it('renames', async () => {
    const list = await makeList(me)
    const r = await app().patch(`/music/playlists/${list}`).set(auth(me))
      .send({ name: 'Gym', description: 'loud' }).expect(200)
    expect(r.body.playlist).toMatchObject({ name: 'Gym', description: 'loud' })
  })

  it('deleting a playlist keeps the tracks', async () => {
    const list = await makeList(me)
    const a = await giveTrack(me)
    await app().post(`/music/playlists/${list}/tracks`).set(auth(me)).send({ trackId: a }).expect(200)

    await app().delete(`/music/playlists/${list}`).set(auth(me)).expect(200)
    expect(await Playlist.findById(list)).toBeNull()
    // Only the arrangement was deleted.
    expect(await Track.findById(a)).not.toBeNull()
  })

  it('drops entries whose track is gone, rather than returning holes', async () => {
    const list = await makeList(me)
    const a = await giveTrack(me, { title: 'Kept' })
    const b = await giveTrack(me, { title: 'Deleted later' })
    await app().post(`/music/playlists/${list}/tracks`).set(auth(me)).send({ trackId: a }).expect(200)
    await app().post(`/music/playlists/${list}/tracks`).set(auth(me)).send({ trackId: b }).expect(200)

    // Deleting a track deliberately does not rewrite every playlist that
    // mentions it, so the reader has to cope.
    await app().delete(`/music/tracks/${b}`).set(auth(me)).expect(200)

    const r = await app().get(`/music/playlists/${list}`).set(auth(me)).expect(200)
    expect(r.body.playlist.tracks.map((t: { title: string }) => t.title)).toEqual(['Kept'])
    expect(r.body.playlist.count).toBe(1)
  })

  it('answers 404 for an id that is not an id', async () => {
    await app().get('/music/playlists/not-an-id').set(auth(me)).expect(404)
  })
})
