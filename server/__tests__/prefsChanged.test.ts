/**
 * `prefs:changed` -- the nudge that tells your other devices to re-read your
 * conversation preferences.
 *
 * Pin, mute and notification level live on the user's own document and are
 * written over REST. Nothing told a second device, so the Android background
 * service kept deciding "is this muted?" from the copy it fetched at connect --
 * a conversation muted on the web still rang the phone until the next
 * reconnect. The event carries no payload: the listener re-reads, so there is
 * nothing for it to apply out of order.
 *
 * Additive on the wire: an older client has no listener for it and ignores it.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, auth, connectDb, disconnectDb, resetDb, register,
  withSocketServer, connectSocket, nextEvent,
} from './helpers'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }

const ID = '64b7f0c2a1b2c3d4e5f60718'
const patch = (u: { token: string }, body: object) =>
  app().patch(`/users/me/conversations/${ID}`).set(auth(u as any)).send(body)

/** Counts `prefs:changed` events on a socket from now on. */
const countChanged = (s: ClientSocket) => {
  const seen = { n: 0 }
  s.on('prefs:changed', () => { seen.n++ })
  return seen
}

const settle = (ms = 300) => new Promise(r => setTimeout(r, ms))

describe('prefs:changed', () => {
  it('reaches every device of the user when a preference is saved', async () => {
    const a = await register()
    const phone = track(await connectSocket(sockets.url, a.token))
    const web   = track(await connectSocket(sockets.url, a.token))

    const gotPhone = nextEvent(phone, 'prefs:changed')
    const gotWeb   = nextEvent(web, 'prefs:changed')
    expect((await patch(a, { mute: 'forever' })).status).toBe(200)

    await expect(gotPhone).resolves.toBeUndefined()
    await expect(gotWeb).resolves.toBeUndefined()
  })

  it('reaches a background connection, which is the one that needs it', async () => {
    const a = await register()
    const bg = track(await connectSocket(sockets.url, a.token, { background: true }))

    const got = nextEvent(bg, 'prefs:changed')
    await patch(a, { level: 'mentions' })
    await expect(got).resolves.toBeUndefined()
  })

  it("is not told to anyone else", async () => {
    const a = await register(), b = await register()
    const other = track(await connectSocket(sockets.url, b.token))
    const seen = countChanged(other)

    await patch(a, { pinned: true })
    await settle()

    expect(seen.n).toBe(0)
  })

  it('is not sent when the change is refused', async () => {
    const a = await register()
    const tab = track(await connectSocket(sockets.url, a.token))
    const seen = countChanged(tab)

    expect((await patch(a, { level: 'loud' })).status).toBe(400)
    expect((await patch(a, { mute: 'tomorrow-ish' })).status).toBe(400)
    await settle()

    expect(seen.n).toBe(0)
  })
})
