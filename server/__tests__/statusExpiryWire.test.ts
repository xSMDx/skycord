/**
 * Timed statuses, end to end.
 *
 * The unit tests in `statusExpiry.test.ts` pin the rule. These pin the two
 * things a unit test cannot see, and both were real hazards rather than
 * hypothetical ones:
 *
 * 1. **The duration actually reaches the database.** `presence:set` used to
 *    take a bare status string, and every existing client still sends one —
 *    so the object form has to be additive, not a replacement.
 *
 * 2. **Choosing a new status clears the old expiry.** Writing only `status`
 *    would leave a stale `statusUntil` behind, so picking "Online" after a
 *    one-hour Do Not Disturb would inherit that hour and silently flip you
 *    back to online later. This is the check that would have caught it.
 *
 * There is a third hazard these cannot cover and it is worth naming: every
 * projection in this server names its fields explicitly, and a `.select()`
 * that asks for `status` without `statusUntil` reports "never expires" for
 * everyone it touches, silently. They were widened together with this change.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  connectDb, disconnectDb, resetDb, register,
  withSocketServer, connectSocket, type TestUser,
} from './helpers'
import { User } from '../models/User'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }

/** presence:set, resolved with the server's ack rather than a fixed sleep. */
const setStatus = (s: ClientSocket, payload: unknown): Promise<any> =>
  new Promise(resolve => s.emit('presence:set', payload, resolve))

const stored = async (u: TestUser) =>
  User.findById(u.id).select('status statusUntil').lean()

describe('presence:set with a duration', () => {
  it('persists both the choice and its end', async () => {
    const a = await register()
    const s = track(await connectSocket(sockets.url, a.token))

    const ack = await setStatus(s, { status: 'dnd', minutes: 60 })
    expect(ack.ok).toBe(true)

    const row = await stored(a)
    expect(row!.status).toBe('dnd')
    expect(row!.statusUntil).toBeInstanceOf(Date)
    const mins = (new Date(row!.statusUntil!).getTime() - Date.now()) / 60_000
    expect(mins).toBeGreaterThan(58)
    expect(mins).toBeLessThan(62)
  })

  it('still accepts a bare string, which is what "Forever" and every old client send', async () => {
    const a = await register()
    const s = track(await connectSocket(sockets.url, a.token))

    const ack = await setStatus(s, 'dnd')
    expect(ack.ok).toBe(true)

    const row = await stored(a)
    expect(row!.status).toBe('dnd')
    expect(row!.statusUntil ?? null).toBeNull()
  })

  it('clears a previous expiry instead of inheriting it', async () => {
    // The regression this test exists for: write only `status` on the second
    // call and the first call's hour survives, so "Online" quietly expires an
    // hour later and flips you to... online. Invisible would be worse: it
    // would un-hide you on a timer you never set.
    const a = await register()
    const s = track(await connectSocket(sockets.url, a.token))

    await setStatus(s, { status: 'dnd', minutes: 60 })
    expect((await stored(a))!.statusUntil).toBeInstanceOf(Date)

    await setStatus(s, { status: 'online' })
    const row = await stored(a)
    expect(row!.status).toBe('online')
    expect(row!.statusUntil ?? null).toBeNull()
  })

  it('ignores a nonsense duration rather than storing a bad date', async () => {
    const a = await register()
    const s = track(await connectSocket(sockets.url, a.token))

    await setStatus(s, { status: 'dnd', minutes: 'soon' })
    const row = await stored(a)
    expect(row!.status).toBe('dnd')
    expect(row!.statusUntil ?? null).toBeNull()   // treated as no duration, not as NaN
  })

  it('still refuses a status that is not one of the four', async () => {
    const a = await register()
    const s = track(await connectSocket(sockets.url, a.token))

    const ack = await setStatus(s, { status: 'banana', minutes: 60 })
    expect(ack.ok).toBe(false)
    expect((await stored(a))!.status).toBe('online')
  })
})

describe('what other people are told', () => {
  it('an expired status reads as online to a third party, never as the expired value', async () => {
    const a = await register()
    const s = track(await connectSocket(sockets.url, a.token))

    // Set it live, then move its end into the past directly — the alternative
    // is waiting out a real duration, and the smallest one the UI offers is
    // fifteen minutes.
    await setStatus(s, { status: 'invisible', minutes: 60 })
    await User.updateOne({ _id: a.id }, { statusUntil: new Date(Date.now() - 1000) })

    const row = await User.findById(a.id)
    const seen = row!.toPublicJSON()

    expect(seen.status).toBe('online')
    expect(seen.status).not.toBe('invisible')
  })
})
