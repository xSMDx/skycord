/**
 * Per-user conversation preferences: pin and mute, and the notification level
 * and hide-muted switch that servers, categories and channels use. One map,
 * keyed by whatever id the client names — a DM partner, a group, a server, a
 * category, a channel.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth } from './helpers'
import { User } from '../models/User'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const ID = '64b7f0c2a1b2c3d4e5f60718'
const set = (u: { token: string }, body: object, id = ID) =>
  app().patch(`/users/me/conversations/${id}`).set(auth(u as any)).send(body)
const all = async (u: { token: string }) =>
  (await app().get('/users/me/conversations').set(auth(u as any))).body.prefs

describe('notification level', () => {
  it('stores a level and returns it', async () => {
    const u = await register()
    const res = await set(u, { level: 'all' })
    expect(res.status).toBe(200)
    expect(res.body.pref).toMatchObject({ level: 'all', muted: false, pinned: false, hideMuted: false })
    expect((await all(u))[ID].level).toBe('all')
  })

  it('refuses a level that is not one of the four', async () => {
    const u = await register()
    expect((await set(u, { level: 'loud' })).status).toBe(400)
    expect((await set(u, { level: 3 })).status).toBe(400)
  })

  it('round-trips hide muted channels', async () => {
    const u = await register()
    expect((await set(u, { hideMuted: true })).body.pref.hideMuted).toBe(true)
    expect((await all(u))[ID].hideMuted).toBe(true)
    expect((await set(u, { hideMuted: false })).body.pref.hideMuted).toBe(false)
  })

  it('drops the entry once nothing is set', async () => {
    const u = await register()
    await set(u, { level: 'nothing' })
    await set(u, { level: 'default' })
    expect(await all(u)).not.toHaveProperty(ID)
    const doc = await User.findById(u.id).select('+convPrefs')
    expect((doc!.convPrefs as any).has(ID)).toBe(false)
  })

  it('keeps an entry with a level after its mute runs out', async () => {
    const u = await register()
    await set(u, { level: 'mentions', mute: new Date(Date.now() + 60_000).toISOString() })
    await User.updateOne({ _id: u.id }, { $set: { [`convPrefs.${ID}.mutedUntil`]: new Date(Date.now() - 1000) } })
    const p = (await all(u))[ID]
    expect(p).toMatchObject({ muted: false, mutedUntil: null, level: 'mentions' })
  })

  it('leaves an old entry reading as the default level', async () => {
    const u = await register()
    await User.updateOne({ _id: u.id }, { $set: { [`convPrefs.${ID}`]: { pinned: true, muted: false, mutedUntil: null } } })
    expect((await all(u))[ID]).toMatchObject({ pinned: true, level: 'default', hideMuted: false })
  })
})
