/**
 * Password reset.
 *
 * The tests that matter here are not "does it work" — they are the ones that
 * fail open. A reset endpoint that distinguishes a real address from a fake
 * one is a membership oracle; a token that survives its first use is a
 * permanent key; a reset that leaves old sessions alive does not lock out
 * whoever prompted it.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth } from './helpers'
import { User } from '../models/User'
import { PasswordReset, newResetToken, RESET_TTL_MINUTES } from '../models/PasswordReset'

// The provider is never called in tests. Mocking `sendEmail` also stands in for
// a configured instance — emailEnabled() is what the controller branches on.
vi.mock('../utils/email', async (orig) => ({
  ...(await orig<typeof import('../utils/email')>()),
  emailEnabled: () => true,
  sendEmail: vi.fn(async () => true),
}))

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

/** Ask for a reset and dig the plaintext token out of the DB, standing in for
 *  the email nobody sent. */
const requestReset = async (email: string) => {
  await app().post('/auth/forgot-password').send({ email })
  return PasswordReset.findOne({ usedAt: null }).sort({ createdAt: -1 })
}

describe('POST /auth/forgot-password', () => {
  it('answers identically for a real and a made-up address', async () => {
    const u = await register()

    const real = await app().post('/auth/forgot-password').send({ email: u.email })
    const fake = await app().post('/auth/forgot-password').send({ email: 'nobody@example.com' })

    expect(real.status).toBe(fake.status)
    expect(real.body).toEqual(fake.body)
  })

  it('creates a token for a real address', async () => {
    const u = await register()
    await app().post('/auth/forgot-password').send({ email: u.email })
    expect(await PasswordReset.countDocuments({})).toBe(1)
  })

  it('creates nothing for an unknown address', async () => {
    await app().post('/auth/forgot-password').send({ email: 'nobody@example.com' })
    expect(await PasswordReset.countDocuments({})).toBe(0)
  })

  it('never stores the token in the clear', async () => {
    const u = await register()
    await app().post('/auth/forgot-password').send({ email: u.email })
    const rec = await PasswordReset.findOne({}).lean()
    // 64 hex chars = SHA-256. base64url of 32 bytes would be 43 and contain -_.
    expect(rec!.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('replaces the previous token rather than adding a second', async () => {
    const u = await register()
    await app().post('/auth/forgot-password').send({ email: u.email })
    await app().post('/auth/forgot-password').send({ email: u.email })
    // Two live tokens would mean two working keys to one account.
    expect(await PasswordReset.countDocuments({ usedAt: null })).toBe(1)
  })

  it('rejects an empty email', async () => {
    expect((await app().post('/auth/forgot-password').send({ email: '  ' })).status).toBe(400)
  })
})

describe('POST /auth/reset-password', () => {
  /** Issue a token directly — the controller only ever mails the plaintext. */
  const issue = async (userId: string, overrides: Record<string, unknown> = {}) => {
    const { token, tokenHash } = newResetToken()
    await PasswordReset.create({
      user: userId, tokenHash,
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
      ...overrides,
    })
    return token
  }

  it('sets the new password and lets the user sign in with it', async () => {
    const u = await register()
    const token = await issue(u.id)

    const res = await app().post('/auth/reset-password').send({ token, password: 'BrandNewPass1' })
    expect(res.status).toBe(200)

    const login = await app().post('/auth/login').send({ identifier: u.email, password: 'BrandNewPass1' })
    expect(login.status).toBe(200)
  })

  it('the old password stops working', async () => {
    const u = await register()
    const token = await issue(u.id)
    await app().post('/auth/reset-password').send({ token, password: 'BrandNewPass1' })

    const old = await app().post('/auth/login').send({ identifier: u.email, password: u.password })
    expect(old.status).toBe(401)
  })

  it('invalidates existing sessions', async () => {
    const u = await register()
    const before = (await User.findById(u.id).select('+tokenVersion').lean())!.tokenVersion
    const token = await issue(u.id)

    await app().post('/auth/reset-password').send({ token, password: 'BrandNewPass1' })

    const after = (await User.findById(u.id).select('+tokenVersion').lean())!.tokenVersion
    // Someone resetting may be doing it BECAUSE another session exists.
    expect(after).toBeGreaterThan(before)
  })

  it('a token works exactly once', async () => {
    const u = await register()
    const token = await issue(u.id)

    expect((await app().post('/auth/reset-password').send({ token, password: 'FirstPass123' })).status).toBe(200)
    expect((await app().post('/auth/reset-password').send({ token, password: 'SecondPass123' })).status).toBe(400)

    // And the second attempt did not take effect.
    const login = await app().post('/auth/login').send({ identifier: u.email, password: 'SecondPass123' })
    expect(login.status).toBe(401)
  })

  it('refuses an expired token', async () => {
    const u = await register()
    const token = await issue(u.id, { expiresAt: new Date(Date.now() - 1000) })
    expect((await app().post('/auth/reset-password').send({ token, password: 'BrandNewPass1' })).status).toBe(400)
  })

  it('refuses a token that was never issued', async () => {
    await register()
    const res = await app().post('/auth/reset-password').send({ token: 'not-a-real-token', password: 'BrandNewPass1' })
    expect(res.status).toBe(400)
  })

  it('enforces the password minimum', async () => {
    const u = await register()
    const token = await issue(u.id)
    expect((await app().post('/auth/reset-password').send({ token, password: 'short' })).status).toBe(400)
    // And the token survives a rejected attempt, or a typo would burn it.
    expect((await PasswordReset.countDocuments({ usedAt: null }))).toBe(1)
  })

  it('stores a hash, not the new password', async () => {
    const u = await register()
    const token = await issue(u.id)
    await app().post('/auth/reset-password').send({ token, password: 'BrandNewPass1' })

    const fresh = await User.findById(u.id).select('+password').lean()
    expect(fresh!.password).not.toBe('BrandNewPass1')
    expect(fresh!.password).toMatch(/^\$2[aby]\$/)   // bcrypt
  })
})

describe('GET /auth/reset-available', () => {
  it('reports whether this instance can send mail', async () => {
    const res = await app().get('/auth/reset-available')
    expect(res.status).toBe(200)
    expect(typeof res.body.enabled).toBe('boolean')
  })
})
