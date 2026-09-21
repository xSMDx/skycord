/**
 * Logins that last while they are used.
 *
 * Before this, the refresh cookie was minted once at sign-in and never again,
 * so every login ended seven days later however often it was used — on the web
 * and in the desktop app alike. Now a refresh a day or more after the cookie was
 * issued mints a new one and moves the session's end with it: a login lasts
 * JWT_REFRESH_EXPIRES_IN (90 days by default) since the device was last used.
 *
 * The properties pinned here: renewal happens, it happens at most daily, it
 * keeps the same device rather than creating a new one, and revocation still
 * wins over it.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import { app, connectDb, disconnectDb, resetDb, register, type TestUser } from './helpers'
import { Session } from '../models/Session'
import { config } from '../config/env'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const DAY = 24 * 60 * 60 * 1000
const RT = 'syk_rt'

const setCookies = (res: { headers: Record<string, unknown> }): string[] => {
  const raw = res.headers['set-cookie']
  return Array.isArray(raw) ? raw : raw ? [String(raw)] : []
}
const refreshCookie = (res: { headers: Record<string, unknown> }) => setCookies(res).find(c => c.startsWith(`${RT}=`) && !c.startsWith(`${RT}=;`))
const tokenOf = (cookie: string) => cookie.split(';')[0].slice(RT.length + 1)
const maxAgeOf = (cookie: string) => Number(/Max-Age=(\d+)/i.exec(cookie)?.[1])

const signIn = async (u: TestUser) => {
  const res = await app().post('/auth/login').send({ identifier: u.username, password: u.password })
  expect(res.status).toBe(200)
  const cookie = refreshCookie(res)!
  return { cookie, token: tokenOf(cookie), claims: jwt.decode(tokenOf(cookie)) as { sub: string; tokenVersion: number; sid: string } }
}

/** The same credential as `claims`, but issued `daysAgo` days ago. */
const issuedAgo = (claims: { sub: string; tokenVersion: number; sid: string }, daysAgo: number) =>
  jwt.sign(
    { sub: claims.sub, tokenVersion: claims.tokenVersion, sid: claims.sid, iat: Math.floor((Date.now() - daysAgo * DAY) / 1000) },
    config.jwt.refreshSecret,
    { expiresIn: Math.floor(config.jwt.refreshTtlMs / 1000), algorithm: 'HS256' },
  )

const refresh = (token: string) => app().post('/auth/refresh').set('Cookie', `${RT}=${token}`)

describe('a login lasts 90 days by default', () => {
  it('the cookie says so', async () => {
    const { cookie } = await signIn(await register())
    expect(maxAgeOf(cookie)).toBe(90 * 24 * 60 * 60)
  })

  it('and so does the device row, so the two end together', async () => {
    const { claims } = await signIn(await register())
    const row = await Session.findOne({ sid: claims.sid })
    expect(Math.abs(row!.expiresAt.getTime() - (Date.now() + 90 * DAY))).toBeLessThan(60_000)
  })
})

describe('using it keeps it alive', () => {
  it('a refresh a day after the cookie was issued hands over a new one', async () => {
    const { claims } = await signIn(await register())
    const res = await refresh(issuedAgo(claims, 2))
    expect(res.status).toBe(200)
    const renewed = refreshCookie(res)
    expect(renewed, 'a new refresh cookie').toBeTruthy()
    const iat = (jwt.decode(tokenOf(renewed!)) as { iat: number }).iat * 1000
    expect(Date.now() - iat).toBeLessThan(60_000)
  })

  it('and moves the device’s end forward with it', async () => {
    const { claims } = await signIn(await register())
    await Session.updateOne({ sid: claims.sid }, { expiresAt: new Date(Date.now() + 3 * DAY) })
    await refresh(issuedAgo(claims, 87))
    const row = await Session.findOne({ sid: claims.sid })
    expect(Math.abs(row!.expiresAt.getTime() - (Date.now() + 90 * DAY))).toBeLessThan(60_000)
  })

  it('keeps it the same device: same sid, no new row', async () => {
    const u = await register()
    const { claims } = await signIn(u)
    const before = await Session.countDocuments({ user: claims.sub })
    const res = await refresh(issuedAgo(claims, 2))
    expect((jwt.decode(tokenOf(refreshCookie(res)!)) as { sid: string }).sid).toBe(claims.sid)
    expect(await Session.countDocuments({ user: claims.sub })).toBe(before)
  })

  it('renews at most daily: a fresh cookie is left alone', async () => {
    const { token } = await signIn(await register())
    const res = await refresh(token)
    expect(res.status).toBe(200)
    expect(refreshCookie(res)).toBeUndefined()
  })
})

describe('revocation still wins', () => {
  it('a device signed out elsewhere cannot renew itself back in', async () => {
    const { claims } = await signIn(await register())
    await Session.deleteOne({ sid: claims.sid })
    const res = await refresh(issuedAgo(claims, 2))
    expect(res.status).toBe(401)
    expect(refreshCookie(res)).toBeUndefined()
  })
})
