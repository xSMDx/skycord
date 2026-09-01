/**
 * Changing a password must sign the OTHER sessions out.
 *
 * `resetPassword` has always bumped `tokenVersion`; `changePassword` never did.
 * That is exactly backwards from where it matters. Someone who resets has lost
 * access to their account, but someone who opens Settings and changes their
 * password is very often doing it because they think a session somewhere is not
 * theirs — and that was the one path that left the other session a refresh
 * cookie good for the full 7 days.
 *
 * The failure is invisible from the UI: the password really did change, so
 * nothing looks wrong.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth } from './helpers'
import { User } from '../models/User'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const NEW = 'NewPass456!'

/** Logs in and returns the refresh cookie, which is what a session really is. */
const loginCookie = async (u: { username: string; password: string }) => {
  const res = await app().post('/auth/login').send({ identifier: u.username, password: u.password })
  expect(res.status).toBe(200)
  const raw = res.headers['set-cookie']
  return (Array.isArray(raw) ? raw : [raw]).join('; ')
}

const change = (u: any, currentPassword: string, newPassword = NEW) =>
  app().patch('/users/me/password').set(auth(u)).send({ currentPassword, newPassword })

describe('changing a password', () => {
  it('kills a refresh cookie held by another session', async () => {
    const u = await register()
    const other = await loginCookie(u)

    // That session works before the change.
    expect((await app().post('/auth/refresh').set('Cookie', other)).status).toBe(200)

    expect((await change(u, u.password)).status).toBe(200)

    const after = await app().post('/auth/refresh').set('Cookie', other)
    expect(after.status).toBe(401)
  })

  it('bumps tokenVersion, which is the mechanism', async () => {
    const u = await register()
    const before = await User.findById(u.id).select('+tokenVersion').lean()
    await change(u, u.password)
    const after = await User.findById(u.id).select('+tokenVersion').lean()
    expect(after!.tokenVersion).toBe(before!.tokenVersion + 1)
  })

  it('leaves the caller signed in', async () => {
    // Bumping the version invalidates the caller's own cookie too, so the
    // response has to re-issue one — or changing your password logs you out of
    // the tab you did it in, which reads as a bug.
    const u = await register()
    const res = await change(u, u.password)

    const raw = res.headers['set-cookie']
    expect(raw).toBeTruthy()
    const cookie = (Array.isArray(raw) ? raw : [raw]).join('; ')
    expect((await app().post('/auth/refresh').set('Cookie', cookie)).status).toBe(200)
  })

  it('does not touch sessions when the current password is wrong', async () => {
    // Otherwise the endpoint is an unauthenticated-ish denial of service: anyone
    // holding a stolen access token could log the real owner out repeatedly.
    const u = await register()
    const other = await loginCookie(u)

    expect((await change(u, 'WrongPass123!')).status).toBe(401)
    expect((await app().post('/auth/refresh').set('Cookie', other)).status).toBe(200)
  })

  it('the new password is the one that works afterwards', async () => {
    const u = await register()
    await change(u, u.password)

    expect((await app().post('/auth/login').send({ identifier: u.username, password: u.password })).status).toBe(401)
    expect((await app().post('/auth/login').send({ identifier: u.username, password: NEW })).status).toBe(200)
  })
})
