import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  app, connectDb, disconnectDb, resetDb, register, auth, type TestUser,
} from './helpers'
import { Server } from '../models/Server'
import { Role } from '../models/Role'
import { PERMISSIONS, serializeBits } from '../permissions'

/**
 * Server mute, server deafen and disconnect.
 *
 * The escalation routes matter more than the happy paths, exactly as they do
 * for roles: a moderation power that can be turned sideways onto a peer or
 * upwards onto the owner is worse than not having it. So most of what is
 * checked here is what must NOT work.
 *
 * The live LiveKit half is deliberately not exercised — it needs a media server
 * and it is best-effort by design. What IS tested is the half that has to be
 * right without one: who may impose a restriction, what gets persisted, and
 * that the flags survive into the place enforcement actually reads them.
 */

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'VM' })).body.server

const joinAsMember = async (sid: string, uid: string) =>
  Server.updateOne({ _id: sid }, { $push: { members: uid } })

const setVoice = (u: TestUser, sid: string, uid: string, body: Record<string, unknown>) =>
  app().patch(`/servers/${sid}/members/${uid}/voice`).set(auth(u)).send(body)

const disconnect = (u: TestUser, sid: string, uid: string) =>
  app().post(`/servers/${sid}/members/${uid}/voice/disconnect`).set(auth(u))

/** Give `uid` a role carrying exactly `bits`, at `position`. */
const grant = async (sid: string, uid: string, bits: bigint, position = 5) => {
  const role = await Role.create({
    server: sid, name: 'granted', position, permissions: serializeBits(bits),
  })
  await Server.updateOne(
    { _id: sid },
    { $push: { memberRoles: { user: uid, roles: [role._id] } } },
  )
  return role
}

const voiceRow = async (sid: string, uid: string) => {
  const s = await Server.findById(sid).lean()
  return (s?.memberVoice ?? []).find(v => v.user.toString() === uid)
}

describe('PATCH /servers/:sid/members/:uid/voice', () => {
  it('lets the owner mute a member, and persists it', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)

    const res = await setVoice(owner, server.id, member.id, { mute: true })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ userId: member.id, mute: true, deafen: false })
    expect(await voiceRow(server.id, member.id)).toMatchObject({ mute: true, deafen: false })
  })

  it('removes the row entirely when the last flag is lifted', async () => {
    // A row exists only while something is imposed, so the array stays the size
    // of the moderation in force rather than of the membership.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)

    await setVoice(owner, server.id, member.id, { mute: true })
    expect(await voiceRow(server.id, member.id)).toBeTruthy()
    await setVoice(owner, server.id, member.id, { mute: false })
    expect(await voiceRow(server.id, member.id)).toBeUndefined()
  })

  it('never writes two rows for one member', async () => {
    // restrictionOf finds the FIRST row, so a duplicate would make the second
    // one invisible and un-liftable.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)

    await setVoice(owner, server.id, member.id, { mute: true })
    await setVoice(owner, server.id, member.id, { deafen: true })
    await setVoice(owner, server.id, member.id, { mute: false })

    const s = await Server.findById(server.id).lean()
    const rows = (s?.memberVoice ?? []).filter(v => v.user.toString() === member.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ mute: false, deafen: true })
  })

  it('keeps mute and deafen independent', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)

    await setVoice(owner, server.id, member.id, { mute: true, deafen: true })
    // Lifting the deafen must not lift a mute imposed in its own right.
    await setVoice(owner, server.id, member.id, { deafen: false })
    expect(await voiceRow(server.id, member.id)).toMatchObject({ mute: true, deafen: false })
  })

  it('refuses a member with no moderation permission', async () => {
    const owner = await register()
    const nobody = await register()
    const victim = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, nobody.id)
    await joinAsMember(server.id, victim.id)

    const res = await setVoice(nobody, server.id, victim.id, { mute: true })
    expect(res.status).toBe(403)
    expect(await voiceRow(server.id, victim.id)).toBeUndefined()
  })

  it('refuses MuteMembers alone when the request also deafens', async () => {
    // Each flag needs its own bit. Otherwise MuteMembers quietly includes a
    // power the person was never granted.
    const owner = await register()
    const mod = await register()
    const victim = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, mod.id)
    await joinAsMember(server.id, victim.id)
    await grant(server.id, mod.id, PERMISSIONS.MuteMembers)

    expect((await setVoice(mod, server.id, victim.id, { mute: true })).status).toBe(200)
    expect((await setVoice(mod, server.id, victim.id, { deafen: true })).status).toBe(403)
    expect(await voiceRow(server.id, victim.id)).toMatchObject({ mute: true, deafen: false })
  })

  it('refuses a peer at the same role position', async () => {
    // A tie settled by whoever clicks first is not an authorisation model.
    const owner = await register()
    const a = await register()
    const b = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, a.id)
    await joinAsMember(server.id, b.id)
    await grant(server.id, a.id, PERMISSIONS.MuteMembers, 5)
    await grant(server.id, b.id, PERMISSIONS.MuteMembers, 5)

    expect((await setVoice(a, server.id, b.id, { mute: true })).status).toBe(403)
  })

  it('refuses to mute the owner, even for an administrator', async () => {
    const owner = await register()
    const admin = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, admin.id)
    await grant(server.id, admin.id, PERMISSIONS.Administrator, 9)

    const res = await setVoice(admin, server.id, owner.id, { mute: true })
    expect(res.status).toBe(403)
    expect(await voiceRow(server.id, owner.id)).toBeUndefined()
  })

  it('refuses to mute yourself', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    const res = await setVoice(owner, server.id, owner.id, { mute: true })
    expect(res.status).toBe(400)
  })

  it('allows a no-op re-send without the permission for it', async () => {
    // Re-sending a value something already has is not an exercise of power, and
    // a client refreshing its view must not get a 403 for agreeing.
    const owner = await register()
    const mod = await register()
    const victim = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, mod.id)
    await joinAsMember(server.id, victim.id)
    await grant(server.id, mod.id, PERMISSIONS.MuteMembers)

    // mod cannot deafen, but deafen:false is already the state.
    const res = await setVoice(mod, server.id, victim.id, { mute: true, deafen: false })
    expect(res.status).toBe(200)
  })

  it('rejects a non-member and a malformed id the same way', async () => {
    const owner = await register()
    const stranger = await register()
    const server = await mkServer(owner)

    expect((await setVoice(owner, server.id, stranger.id, { mute: true })).status).toBe(404)
    expect((await setVoice(owner, server.id, 'not-an-id', { mute: true })).status).toBe(404)
  })

  it('rejects a body that changes nothing, and non-boolean flags', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)

    expect((await setVoice(owner, server.id, member.id, {})).status).toBe(400)
    expect((await setVoice(owner, server.id, member.id, { mute: 'yes' })).status).toBe(400)
  })

  it('refuses a stranger to the server outright', async () => {
    const owner = await register()
    const outsider = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)

    expect((await setVoice(outsider, server.id, member.id, { mute: true })).status).toBe(403)
  })
})

describe('POST /servers/:sid/members/:uid/voice/disconnect', () => {
  it('is idempotent for somebody who is not in a call', async () => {
    // Two moderators clicking at once must not produce an error for the slower.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)

    const res = await disconnect(owner, server.id, member.id)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ userId: member.id, live: 'absent' })
  })

  it('needs MoveMembers, not merely membership', async () => {
    const owner = await register()
    const nobody = await register()
    const victim = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, nobody.id)
    await joinAsMember(server.id, victim.id)

    expect((await disconnect(nobody, server.id, victim.id)).status).toBe(403)
  })

  it('accepts a moderator holding MoveMembers', async () => {
    const owner = await register()
    const mod = await register()
    const victim = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, mod.id)
    await joinAsMember(server.id, victim.id)
    await grant(server.id, mod.id, PERMISSIONS.MoveMembers)

    expect((await disconnect(mod, server.id, victim.id)).status).toBe(200)
  })

  it('refuses the owner and refuses yourself', async () => {
    const owner = await register()
    const admin = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, admin.id)
    await grant(server.id, admin.id, PERMISSIONS.Administrator, 9)

    expect((await disconnect(admin, server.id, owner.id)).status).toBe(403)
    expect((await disconnect(owner, server.id, owner.id)).status).toBe(400)
  })

  it('does not lift a restriction — disconnecting is not unmuting', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)

    await setVoice(owner, server.id, member.id, { mute: true })
    await disconnect(owner, server.id, member.id)
    expect(await voiceRow(server.id, member.id)).toMatchObject({ mute: true })
  })
})

describe('a restriction does not outlive the membership', () => {
  it('is pulled when the member is removed', async () => {
    // Otherwise a rejoin silently re-imposes a mute nobody remembers setting.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    await setVoice(owner, server.id, member.id, { mute: true, deafen: true })

    await app().delete(`/servers/${server.id}/members/${member.id}`).set(auth(owner))

    const s = await Server.findById(server.id).lean()
    expect((s?.memberVoice ?? []).some(v => v.user.toString() === member.id)).toBe(false)
    expect((s?.members ?? []).some(m => m.toString() === member.id)).toBe(false)
  })
})
