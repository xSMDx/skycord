/**
 * Your own status, as the server tells YOU.
 *
 * `GET /auth/me` used to hand back the raw stored choice with no end time and
 * no clock check. The Android background service reads it on every reconnect
 * to decide Do Not Disturb, and nothing on the server ever flips a timed status
 * back by itself -- only an open web client does. So once a timed Do Not
 * Disturb had run out with no web client open, every reconnect read `dnd` and
 * the phone stayed silent indefinitely.
 *
 * Two halves are pinned here:
 *
 * 1. Your own JSON is expiry-aware (the same chosenNow() rule everyone else's
 *    view already follows) and says when the status ends.
 * 2. The REST status change tells your other tabs `until`, exactly as the
 *    socket path does -- otherwise a tab that had a timed deadline keeps it
 *    after you pick a plain status over HTTP.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, auth, connectDb, disconnectDb, resetDb, register,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { User } from '../models/User'
import { Friendship } from '../models/Friendship'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }

const inFuture = (ms: number) => new Date(Date.now() + ms)
const inPast   = (ms: number) => new Date(Date.now() - ms)

const setRow = (u: TestUser, status: string, statusUntil: Date | null) =>
  User.updateOne({ _id: u.id }, { status, statusUntil })

const me = async (u: TestUser) => {
  const res = await app().get('/auth/me').set(auth(u))
  expect(res.status).toBe(200)
  return res.body.user
}

describe('GET /auth/me -- your own status', () => {
  it('reports the chosen status and when it ends while a timed status is live', async () => {
    const a = await register()
    const until = inFuture(60 * 60_000)
    await setRow(a, 'dnd', until)

    const u = await me(a)
    expect(u.status).toBe('dnd')
    expect(u.statusUntil).toBe(until.toISOString())
  })

  it('reports online, with no end time, once a timed Do Not Disturb has run out', async () => {
    // The Android regression. Nothing flipped the row back (no web client was
    // open), so the stored status is still 'dnd' -- the response must not be.
    const a = await register()
    await setRow(a, 'dnd', inPast(1000))

    const u = await me(a)
    expect(u.status).toBe('online')
    expect(u.statusUntil).toBeNull()
  })

  it('hands an expired Invisible back as online too, not as the dead choice', async () => {
    const a = await register()
    await setRow(a, 'invisible', inPast(1000))

    const u = await me(a)
    expect(u.status).toBe('online')
    expect(u.statusUntil).toBeNull()
  })

  it('leaves a status with no end alone, and says it has none', async () => {
    const a = await register()
    await setRow(a, 'dnd', null)

    const u = await me(a)
    expect(u.status).toBe('dnd')
    expect(u.statusUntil).toBeNull()
  })

  it('still shows YOUR Invisible as Invisible while it is live (the picker needs it)', async () => {
    const a = await register()
    const until = inFuture(15 * 60_000)
    await setRow(a, 'invisible', until)

    const u = await me(a)
    expect(u.status).toBe('invisible')
    expect(u.statusUntil).toBe(until.toISOString())
  })

  it('copes with a row that predates statusUntil (the field is simply missing)', async () => {
    const a = await register()
    await User.collection.updateOne(
      { _id: (await User.findById(a.id))!._id },
      { $set: { status: 'dnd' }, $unset: { statusUntil: '' } },
    )

    const u = await me(a)
    expect(u.status).toBe('dnd')
    expect(u.statusUntil).toBeNull()
  })

  it('keeps every field the existing clients read', async () => {
    const a = await register()
    const u = await me(a)
    for (const k of ['id', 'username', 'email', 'displayName', 'avatar', 'role', 'isVerified', 'customStatus', 'createdAt'])
      expect(u, k).toHaveProperty(k)
  })

  it('does not leak the end time into what OTHER people are shown', async () => {
    const a = await register()
    await setRow(a, 'dnd', inFuture(60 * 60_000))

    const row = await User.findById(a.id)
    expect(row!.toPublicJSON()).not.toHaveProperty('statusUntil')
  })
})

describe('login and register carry the same self view', () => {
  it('says there is no end time for a fresh account', async () => {
    const username = `fresh${Date.now()}`
    const res = await app().post('/auth/register').send({
      username, email: `${username}@test.local`, password: 'TestPass123!', displayName: username,
    })
    expect(res.status).toBe(201)
    expect(res.body.user.status).toBe('online')
    expect(res.body.user.statusUntil).toBeNull()
  })
})

describe('presence:self from the REST status change', () => {
  it('carries `until`, cleared to null, so a tab drops the deadline an earlier status left', async () => {
    const a = await register()
    const s = track(await connectSocket(sockets.url, a.token))

    // A timed status first, so there IS a deadline for the next pick to clear.
    const ack: any = await new Promise(r => s.emit('presence:set', { status: 'dnd', minutes: 60 }, r))
    expect(ack.until).toBeTruthy()

    const heard = nextEvent<any>(s, 'presence:self')
    const res = await app().patch('/users/me').set(auth(a)).send({ status: 'online' })
    expect(res.status).toBe(200)

    const p = await heard
    expect(p.status).toBe('online')
    // Present-but-null is the contract: the web client only disarms its
    // expiry timer when the key exists. Absent means "older payload shape".
    expect(p).toHaveProperty('until')
    expect(p.until).toBeNull()
  })

  it('has the same shape as the socket path (status, effective, until)', async () => {
    const a = await register()
    const s = track(await connectSocket(sockets.url, a.token))

    const heardSocket = nextEvent<any>(s, 'presence:self')
    await new Promise(r => s.emit('presence:set', { status: 'dnd', minutes: 30 }, r))
    const viaSocket = await heardSocket

    const heardRest = nextEvent<any>(s, 'presence:self')
    await app().patch('/users/me').set(auth(a)).send({ status: 'dnd' })
    const viaRest = await heardRest

    expect(Object.keys(viaRest).sort()).toEqual(Object.keys(viaSocket).sort())
    expect(viaRest.status).toBe('dnd')
    expect(viaRest.effective).toBe('dnd')
  })
})

describe('presence:self is read from the user, not from the socket that happens to send it', () => {
  // Each socket loaded the status once, at its own connect, and only ITS OWN
  // presence:set updated it. So when tab B reported idle, the broadcast carried
  // tab B's stale copy -- and every other tab, the phone included, adopted it.
  // These open B BEFORE the change, which is exactly what makes B's copy stale.

  it("another tab's idle report does not roll your status back", async () => {
    const a = await register()
    const tabB = track(await connectSocket(sockets.url, a.token))   // loads 'online'
    const tabA = track(await connectSocket(sockets.url, a.token))

    const ack: any = await new Promise(r => tabA.emit('presence:set', { status: 'dnd', minutes: 60 }, r))
    expect(ack.ok).toBe(true)

    const heard = nextEvent<any>(tabA, 'presence:self')
    tabB.emit('presence:away', true)
    const p = await heard

    expect(p.status).toBe('dnd')
    expect(p.effective).toBe('dnd')
    expect(new Date(p.until).getTime()).toBeGreaterThan(Date.now() + 59 * 60_000)
  })

  it('and your friends are told dnd, not the idle that a stale online would produce', async () => {
    const a = await register(), f = await register()
    await Friendship.create({ requester: a.id, receiver: f.id, status: 'accepted' })
    const friend = track(await connectSocket(sockets.url, f.token))
    const tabB = track(await connectSocket(sockets.url, a.token))
    const tabA = track(await connectSocket(sockets.url, a.token))

    await new Promise(r => tabA.emit('presence:set', { status: 'dnd' }, r))

    const heard = nextEvent<any>(friend, 'presence')
    tabB.emit('presence:away', true)
    const p = await heard

    expect(p.userId).toBe(a.id)
    expect(p.status).toBe('dnd')
  })

  it('a status changed over HTTP is not rolled back by an idle report either', async () => {
    const a = await register()
    const tab = track(await connectSocket(sockets.url, a.token))   // loads 'online'

    const res = await app().patch('/users/me').set(auth(a)).send({ status: 'dnd' })
    expect(res.status).toBe(200)

    const heard = nextEvent<any>(tab, 'presence:self')
    tab.emit('presence:away', true)
    const p = await heard

    expect(p.status).toBe('dnd')
    expect(p.effective).toBe('dnd')
  })

  it('a timed status that ran out meanwhile reads as online, with no end time', async () => {
    const a = await register()
    const tab = track(await connectSocket(sockets.url, a.token))
    await User.updateOne({ _id: a.id }, { status: 'dnd', statusUntil: inPast(1000) })

    const heard = nextEvent<any>(tab, 'presence:self')
    tab.emit('presence:away', true)
    const p = await heard

    expect(p.status).toBe('online')
    expect(p.effective).toBe('idle')    // online + away
    expect(p.until).toBeNull()
  })
})
