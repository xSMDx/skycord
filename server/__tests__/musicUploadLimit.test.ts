/**
 * The music upload limiter, on the real routes.
 *
 * Every limiter in rateLimit.ts skips itself while Vitest runs — `skip` reads
 * process.env.VITEST on each request — which is what keeps the rest of the
 * suite from tripping them. Here the variable is lifted for exactly the
 * requests being counted, after sign-up (whose own limiter would otherwise
 * count too), and put back after each test. So what answers is the real
 * limiter on the real route: a copy built with make() inside the test could
 * pass while music.ts still used the profile limiter.
 *
 * No music service is configured, so each upload that gets past the limiter
 * is refused with 503. That is fine: the limiter counts requests, not
 * successes.
 */
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest'
import { app, auth, connectDb, disconnectDb, register, resetDb, type TestUser } from './helpers'

const MUSIC = 'Too many uploads — wait a moment'
const PROFILE = 'Too many profile updates — wait a moment'

let me: TestUser
let someoneElse: TestUser
const flag = process.env.VITEST

beforeAll(async () => { await connectDb() })
afterAll(async () => { await disconnectDb() })
beforeEach(async () => {
  await resetDb()
  me = await register()
  someoneElse = await register()
})
afterEach(() => { process.env.VITEST = flag })

const limitsOn = (): void => { delete process.env.VITEST }

const upload = (u: TestUser) =>
  app().post('/music/tracks/upload').set(auth(u)).set('Content-Type', 'audio/mpeg').send('not really audio')
const importLink = (u: TestUser) =>
  app().post('/music/tracks/import').set(auth(u)).send({ url: 'https://example.com/a.mp3' })

describe('the music upload limiter', () => {
  it('music upload limiter says "Too many uploads — wait a moment"', async () => {
    limitsOn()
    for (let i = 0; i < 20; i++) expect((await upload(me)).status, `upload ${i + 1}`).toBe(503)

    const r = await upload(me)
    expect(r.status).toBe(429)
    expect(r.body).toEqual({ message: MUSIC, code: 'RATE_LIMITED' })
    // What the client's back-off reads. Same origin for every client, so no
    // CORS exposure is needed for it to see them.
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0)
    expect(Number(r.headers['retry-after'])).toBeLessThanOrEqual(60)
    expect(Number(r.headers['ratelimit-reset'])).toBeGreaterThan(0)
    expect(Number(r.headers['ratelimit-reset'])).toBeLessThanOrEqual(60)
  })

  it('counts a link import against the same 20 a minute', async () => {
    limitsOn()
    for (let i = 0; i < 10; i++) await upload(me)
    for (let i = 0; i < 10; i++) expect((await importLink(me)).status, `import ${i + 1}`).toBe(503)

    const r = await importLink(me)
    expect(r.status).toBe(429)
    expect(r.body.message).toBe(MUSIC)
    expect((await upload(me)).status).toBe(429)
  })

  it('is per member', async () => {
    limitsOn()
    for (let i = 0; i < 21; i++) await upload(me)
    expect((await upload(me)).status).toBe(429)
    expect((await upload(someoneElse)).status).toBe(503)
  })

  it('leaves profile updates their own budget and their own words', async () => {
    limitsOn()
    for (let i = 0; i < 21; i++) await upload(me)
    expect((await upload(me)).status).toBe(429)

    // Spending the music budget took nothing from the profile one…
    for (let i = 0; i < 20; i++) {
      expect((await app().patch('/users/me').set(auth(me)).send({ bio: `take ${i}` })).status, `profile ${i + 1}`).toBe(200)
    }
    // …which still speaks of profile updates when it runs out.
    const r = await app().patch('/users/me').set(auth(me)).send({ bio: 'one more' })
    expect(r.status).toBe(429)
    expect(r.body.message).toBe(PROFILE)
  })

  it('skips itself again once the test runner flag is back', async () => {
    limitsOn()
    for (let i = 0; i < 21; i++) await upload(me)
    process.env.VITEST = flag
    expect((await upload(me)).status).toBe(503)
  })
})
