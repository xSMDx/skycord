/**
 * Logged-in devices — the session store behind Settings → Devices.
 *
 * Before this existed, a session was a stateless refresh JWT and the server
 * held no record of who was signed in from where. Two consequences shaped these
 * tests:
 *
 *  - the screen had nothing to list, so it showed a hardcoded "1 device";
 *  - `logout` could only revoke by bumping `tokenVersion`, which signs out
 *    EVERY device — so closing a session on a shared computer also signed you
 *    out on your phone.
 *
 * The properties worth pinning are the isolation ones. A devices list is a
 * location history, and revocation is the button that pushes someone out of
 * their own account.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Session } from '../models/Session'
import { User } from '../models/User'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1'

const cookiesOf = (res: any) => {
  const raw = res.headers['set-cookie']
  return (Array.isArray(raw) ? raw : [raw].filter(Boolean)).join('; ')
}

/** A second device: log in with its own User-Agent, keep its cookie. */
const signInAs = async (u: TestUser, ua: string, ip?: string) => {
  let r = app().post('/auth/login').set('User-Agent', ua)
  if (ip) r = r.set('X-Forwarded-For', ip)
  const res = await r.send({ identifier: u.username, password: u.password })
  expect(res.status).toBe(200)
  return { cookie: cookiesOf(res), token: res.body.accessToken as string }
}

const list = (u: TestUser | { token: string }) =>
  app().get('/auth/sessions').set('Authorization', `Bearer ${(u as any).token}`)

describe('a session is recorded on the way in', () => {
  it('registering creates one', async () => {
    const u = await register()
    expect(await Session.countDocuments({ user: u.id })).toBe(1)
  })

  it('logging in again creates a second, rather than replacing the first', async () => {
    // Two devices is the normal case and the whole reason the screen exists.
    const u = await register()
    await signInAs(u, UA_IOS)
    expect(await Session.countDocuments({ user: u.id })).toBe(2)
  })

  it('stores the User-Agent so the row can be named', async () => {
    const u = await register()
    await signInAs(u, UA_IOS)
    const rows = await Session.find({ user: u.id }).lean()
    expect(rows.some(r => r.userAgent === UA_IOS)).toBe(true)
  })
})

describe('the list', () => {
  it('names each device from its User-Agent', async () => {
    const u = await register()
    const phone = await signInAs(u, UA_IOS)
    const res = await list(phone)

    expect(res.status).toBe(200)
    const labels = res.body.sessions.map((s: any) => s.label)
    expect(labels).toContain('Safari on iOS')
  })

  it('marks exactly one row as the caller’s own device', async () => {
    const u = await register()
    const phone = await signInAs(u, UA_IOS)
    const res = await app().get('/auth/sessions')
      .set('Authorization', `Bearer ${phone.token}`).set('Cookie', phone.cookie)

    const current = res.body.sessions.filter((s: any) => s.current)
    expect(current).toHaveLength(1)
    expect(current[0].label).toBe('Safari on iOS')
  })

  it('never returns the sid', async () => {
    // It names a revocation target. The client addresses rows by _id instead,
    // so there is no reason for the sid to leave the server — and every reason
    // for it not to, since it also sits inside a signed cookie.
    const u = await register()
    const res = await list(u)
    expect(JSON.stringify(res.body)).not.toContain('sid')
    for (const s of res.body.sessions) expect(s.sid).toBeUndefined()
  })

  it('shows only your own devices', async () => {
    // A devices list is a location history — the isolation here is the point.
    const a = await register(), b = await register()
    await signInAs(b, UA_IOS)
    const res = await list(a)
    expect(res.body.sessions).toHaveLength(1)
  })

  it('requires authentication', async () => {
    expect((await app().get('/auth/sessions')).status).toBe(401)
  })
})

describe('the address and its country', () => {
  it('records the forwarded address, not the socket’s', async () => {
    const u = await register()
    await signInAs(u, UA_IOS, '8.8.8.8')
    const rows = await Session.find({ user: u.id }).lean()
    expect(rows.some(r => r.ip === '8.8.8.8')).toBe(true)
  })

  it('resolves that address to a country code for the flag', async () => {
    const u = await register()
    await signInAs(u, UA_IOS, '8.8.8.8')
    const row = await Session.findOne({ user: u.id, ip: '8.8.8.8' }).lean()
    expect(row!.country).toBe('US')
  })

  it('leaves the country null for a private address rather than guessing', async () => {
    // Local development and any proxy that forwards nothing land here. A wrong
    // flag is worse than no flag.
    const u = await register()
    await signInAs(u, UA_IOS, '192.168.1.50')
    const row = await Session.findOne({ user: u.id, ip: '192.168.1.50' }).lean()
    expect(row!.country).toBeNull()
  })
})

describe('revoking one device', () => {
  it('kills that device’s refresh cookie and no other', async () => {
    const u = await register()
    const phone = await signInAs(u, UA_IOS)
    const desktop = await signInAs(u, UA_WIN)

    const rows = await list(desktop).then(r => r.body.sessions)
    const phoneRow = rows.find((s: any) => s.label === 'Safari on iOS')

    const del = await app().delete(`/auth/sessions/${phoneRow.id}`)
      .set('Authorization', `Bearer ${desktop.token}`).set('Cookie', desktop.cookie)
    expect(del.status).toBe(200)

    expect((await app().post('/auth/refresh').set('Cookie', phone.cookie)).status).toBe(401)
    expect((await app().post('/auth/refresh').set('Cookie', desktop.cookie)).status).toBe(200)
  })

  it('refuses to revoke someone else’s device', async () => {
    const a = await register(), b = await register()
    const bPhone = await signInAs(b, UA_IOS)
    const bRow = await Session.findOne({ user: b.id, userAgent: UA_IOS }).lean()

    const res = await app().delete(`/auth/sessions/${bRow!._id}`).set(auth(a))
    expect(res.status).toBe(404)
    expect(await Session.countDocuments({ _id: bRow!._id })).toBe(1)
    expect((await app().post('/auth/refresh').set('Cookie', bPhone.cookie)).status).toBe(200)
  })

  it('tells the client when it revoked the caller’s own row', async () => {
    // The client is then holding an access token for a dead session and has to
    // return to login rather than sit there.
    const u = await register()
    const me = await signInAs(u, UA_WIN)
    const rows = await app().get('/auth/sessions')
      .set('Authorization', `Bearer ${me.token}`).set('Cookie', me.cookie)
      .then(r => r.body.sessions)
    const mine = rows.find((s: any) => s.current)

    const res = await app().delete(`/auth/sessions/${mine.id}`)
      .set('Authorization', `Bearer ${me.token}`).set('Cookie', me.cookie)
    expect(res.body.current).toBe(true)
  })

  it('400s on an id that is not an ObjectId', async () => {
    const u = await register()
    expect((await app().delete('/auth/sessions/nonsense').set(auth(u))).status).toBe(400)
  })
})

describe('signing out every other device', () => {
  it('leaves the caller signed in and drops the rest', async () => {
    const u = await register()
    await signInAs(u, UA_IOS)
    const me = await signInAs(u, UA_WIN)
    expect(await Session.countDocuments({ user: u.id })).toBe(3)

    const res = await app().delete('/auth/sessions')
      .set('Authorization', `Bearer ${me.token}`).set('Cookie', me.cookie)
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(2)

    expect(await Session.countDocuments({ user: u.id })).toBe(1)
    expect((await app().post('/auth/refresh').set('Cookie', me.cookie)).status).toBe(200)
  })

  it('refuses without a readable cookie, rather than signing the caller out', async () => {
    // The button says "other devices". With no cookie there is no way to tell
    // which row is the caller's, and deleting all of them would sign them out
    // of the tab they are standing in.
    const u = await register()
    const res = await app().delete('/auth/sessions').set(auth(u))
    expect(res.status).toBe(400)
    expect(await Session.countDocuments({ user: u.id })).toBe(1)
  })
})

describe('logout signs out one device, not all of them', () => {
  it('leaves the other devices alone', async () => {
    // This is the bug the session store fixes: logout used to bump
    // tokenVersion, which revokes every refresh token the user holds.
    const u = await register()
    const phone = await signInAs(u, UA_IOS)
    const desktop = await signInAs(u, UA_WIN)

    expect((await app().post('/auth/logout').set('Cookie', desktop.cookie)).status).toBe(200)

    expect((await app().post('/auth/refresh').set('Cookie', phone.cookie)).status).toBe(200)
    expect((await app().post('/auth/refresh').set('Cookie', desktop.cookie)).status).toBe(401)
  })

  it('removes the row, so the device leaves the list', async () => {
    const u = await register()
    const phone = await signInAs(u, UA_IOS)
    await app().post('/auth/logout').set('Cookie', phone.cookie)
    expect(await Session.countDocuments({ user: u.id, userAgent: UA_IOS })).toBe(0)
  })
})

describe('cookies issued before sessions existed', () => {
  /** A pre-feature cookie: valid signature, right tokenVersion, no sid. */
  const legacyCookie = async (u: TestUser) => {
    const { signRefreshToken } = await import('../utils/jwt')
    const { REFRESH_COOKIE } = await import('../utils/cookie')
    const row = await User.findById(u.id).select('+tokenVersion').lean()
    return `${REFRESH_COOKIE}=${signRefreshToken(row!._id, row!.tokenVersion)}`
  }

  it('still refresh, rather than signing everyone out on deploy', async () => {
    const u = await register()
    const res = await app().post('/auth/refresh').set('Cookie', await legacyCookie(u))
    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
  })

  it('are adopted into a real session, so the device becomes visible', async () => {
    // Otherwise they would keep working while staying invisible on the one
    // screen meant to show every device.
    const u = await register()
    await Session.deleteMany({ user: u.id })

    await app().post('/auth/refresh').set('Cookie', await legacyCookie(u)).set('User-Agent', UA_IOS)
    const rows = await Session.find({ user: u.id }).lean()
    expect(rows).toHaveLength(1)
    expect(rows[0].userAgent).toBe(UA_IOS)
  })

  it('are handed a replacement cookie carrying the new sid', async () => {
    const u = await register()
    const res = await app().post('/auth/refresh').set('Cookie', await legacyCookie(u))
    expect(res.headers['set-cookie']).toBeTruthy()
  })
})

describe('changing a password clears the other devices', () => {
  it('removes their rows as well as revoking them', async () => {
    // tokenVersion alone already stops them refreshing; leaving the rows would
    // list them as still signed in on the screen you just used to lock them out.
    const u = await register()
    await signInAs(u, UA_IOS)
    const me = await signInAs(u, UA_WIN)

    const res = await app().patch('/users/me/password')
      .set('Authorization', `Bearer ${me.token}`).set('Cookie', me.cookie)
      .send({ currentPassword: u.password, newPassword: 'NewPass456!' })
    expect(res.status).toBe(200)

    expect(await Session.countDocuments({ user: u.id })).toBe(1)
    const left = await Session.findOne({ user: u.id }).lean()
    expect(left!.userAgent).toBe(UA_WIN)
  })
})
