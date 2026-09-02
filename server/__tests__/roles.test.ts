import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  app, connectDb, disconnectDb, resetDb, register, auth, type TestUser,
} from './helpers'
import { Server } from '../models/Server'
import { Role } from '../models/Role'
import { PERMISSIONS, serializeBits, parseBits, ALL_PERMISSIONS } from '../permissions'

/**
 * Roles, and the first authorisation in this codebase that is not "are you the
 * owner". The happy paths matter least here — what matters is that none of the
 * escalation routes work, because every one of them ends with someone owning a
 * server they were only supposed to moderate.
 */

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'RS' })).body.server

const joinAsMember = async (sid: string, uid: string) =>
  Server.updateOne({ _id: sid }, { $push: { members: uid } })

const listRoles = (u: TestUser, sid: string) =>
  app().get(`/servers/${sid}/roles`).set(auth(u))

const mkRole = (u: TestUser, sid: string, body: Record<string, unknown> = {}) =>
  app().post(`/servers/${sid}/roles`).set(auth(u)).send(body)

const setRoles = (u: TestUser, sid: string, uid: string, roles: string[]) =>
  app().put(`/servers/${sid}/members/${uid}/roles`).set(auth(u)).send({ roles })

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

describe('GET /servers/:sid/roles', () => {
  it('creates @everyone on demand, so servers older than roles still work', async () => {
    const u = await register()
    const server = await mkServer(u)
    const res = await listRoles(u, server.id)
    expect(res.status).toBe(200)
    expect(res.body.roles).toHaveLength(1)
    expect(res.body.roles[0]).toMatchObject({ name: '@everyone', isEveryone: true, position: 0 })
  })

  it('gives @everyone the documented default set, not nothing', async () => {
    // A default of zero looks like a broken server to everyone but the owner.
    const u = await register()
    const server = await mkServer(u)
    const { body } = await listRoles(u, server.id)
    const bits = parseBits(body.roles[0].permissions)
    expect((bits & PERMISSIONS.SendMessages) > 0n).toBe(true)
    expect((bits & PERMISSIONS.ViewChannels) > 0n).toBe(true)
    expect((bits & PERMISSIONS.Administrator) > 0n).toBe(false)
  })

  it('refuses a stranger', async () => {
    const owner = await register()
    const other = await register()
    const server = await mkServer(owner)
    expect((await listRoles(other, server.id)).status).toBe(403)
  })
})

describe('creating roles', () => {
  it('lets the owner create one', async () => {
    const u = await register()
    const server = await mkServer(u)
    const res = await mkRole(u, server.id, { name: 'Mod' })
    expect(res.status).toBe(201)
    expect(res.body.role).toMatchObject({ name: 'Mod', isEveryone: false })
    expect(res.body.role.position).toBeGreaterThan(0)
  })

  it('refuses a member without Manage Roles', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    expect((await mkRole(member, server.id, { name: 'Nope' })).status).toBe(403)
  })

  it('refuses to grant a permission the creator does not hold', async () => {
    // The whole game: ManageRoles must not be one hop from Administrator.
    const owner = await register()
    const mod = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, mod.id)
    await grant(server.id, mod.id, PERMISSIONS.ManageRoles)

    const res = await mkRole(mod, server.id, {
      name: 'Sneaky',
      permissions: serializeBits(PERMISSIONS.Administrator),
    })
    expect(res.status).toBe(403)
  })

  it('will not create a role above the creator', async () => {
    // Creating a role you could not then edit is a trap, and creating one
    // ABOVE you is escalation with extra steps.
    const owner = await register()
    const mod = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, mod.id)
    await grant(server.id, mod.id, PERMISSIONS.ManageRoles, 5)

    const res = await mkRole(mod, server.id, { name: 'Below' })
    expect(res.status).toBe(201)
    expect(res.body.role.position).toBeLessThan(5)
  })
})

describe('editing roles', () => {
  it('refuses to edit a role above the actor', async () => {
    const owner = await register()
    const mod = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, mod.id)
    await grant(server.id, mod.id, PERMISSIONS.ManageRoles, 5)
    const high = await Role.create({ server: server.id, name: 'Admins', position: 9 })

    const res = await app().patch(`/servers/${server.id}/roles/${high._id}`)
      .set(auth(mod)).send({ name: 'mine now' })
    expect(res.status).toBe(403)
  })

  it('refuses a role at the SAME position', async () => {
    // Equal must not pass, or two peers unmake each other and the tie goes to
    // whoever clicked first.
    const owner = await register()
    const mod = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, mod.id)
    await grant(server.id, mod.id, PERMISSIONS.ManageRoles, 5)
    const peer = await Role.create({ server: server.id, name: 'Peer', position: 5 })

    const res = await app().patch(`/servers/${server.id}/roles/${peer._id}`)
      .set(auth(mod)).send({ name: 'peer down' })
    expect(res.status).toBe(403)
  })

  it('refuses to add a permission the actor lacks', async () => {
    const owner = await register()
    const mod = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, mod.id)
    await grant(server.id, mod.id, PERMISSIONS.ManageRoles, 9)
    const low = await Role.create({ server: server.id, name: 'Low', position: 1 })

    const res = await app().patch(`/servers/${server.id}/roles/${low._id}`)
      .set(auth(mod)).send({ permissions: serializeBits(PERMISSIONS.BanMembers) })
    expect(res.status).toBe(403)
  })

  it('will not rename or recolour @everyone', async () => {
    const u = await register()
    const server = await mkServer(u)
    const { body } = await listRoles(u, server.id)
    const everyone = body.roles[0].id
    expect((await app().patch(`/servers/${server.id}/roles/${everyone}`)
      .set(auth(u)).send({ name: 'nope' })).status).toBe(400)
    expect((await app().patch(`/servers/${server.id}/roles/${everyone}`)
      .set(auth(u)).send({ color: '#fff' })).status).toBe(400)
  })

  it('lets the owner grant anything, including Administrator', async () => {
    const u = await register()
    const server = await mkServer(u)
    const { body } = await mkRole(u, server.id, { name: 'Admin' })
    const res = await app().patch(`/servers/${server.id}/roles/${body.role.id}`)
      .set(auth(u)).send({ permissions: serializeBits(ALL_PERMISSIONS) })
    expect(res.status).toBe(200)
    expect(parseBits(res.body.role.permissions)).toBe(ALL_PERMISSIONS)
  })
})

describe('deleting roles', () => {
  it('will not delete @everyone', async () => {
    const u = await register()
    const server = await mkServer(u)
    const { body } = await listRoles(u, server.id)
    const res = await app().delete(`/servers/${server.id}/roles/${body.roles[0].id}`).set(auth(u))
    expect(res.status).toBe(400)
  })

  it('takes the role off every member who held it', async () => {
    // A dangling id resolves to nothing today and to whatever reuses it later.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const { body } = await mkRole(owner, server.id, { name: 'Temp' })
    await setRoles(owner, server.id, member.id, [body.role.id])

    let doc = await Server.findById(server.id)
    expect(doc!.memberRoles[0].roles.map(String)).toEqual([body.role.id])

    await app().delete(`/servers/${server.id}/roles/${body.role.id}`).set(auth(owner))
    doc = await Server.findById(server.id)
    expect(doc!.memberRoles[0].roles).toHaveLength(0)
  })
})

describe('assigning roles to members', () => {
  it('sets and replaces a member’s roles', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const a = (await mkRole(owner, server.id, { name: 'A' })).body.role
    const b = (await mkRole(owner, server.id, { name: 'B' })).body.role

    expect((await setRoles(owner, server.id, member.id, [a.id])).status).toBe(200)
    let doc = await Server.findById(server.id)
    expect(doc!.memberRoles[0].roles.map(String)).toEqual([a.id])

    // PUT is the whole set — sending only B must drop A, not add to it.
    await setRoles(owner, server.id, member.id, [b.id])
    doc = await Server.findById(server.id)
    expect(doc!.memberRoles[0].roles.map(String)).toEqual([b.id])
  })

  it('refuses to assign @everyone', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const { body } = await listRoles(owner, server.id)
    expect((await setRoles(owner, server.id, member.id, [body.roles[0].id])).status).toBe(400)
  })

  it('refuses to hand out a role above the actor', async () => {
    const owner = await register()
    const mod = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, mod.id)
    await joinAsMember(server.id, member.id)
    await grant(server.id, mod.id, PERMISSIONS.ManageRoles, 5)
    const high = await Role.create({ server: server.id, name: 'High', position: 9 })

    expect((await setRoles(mod, server.id, member.id, [String(high._id)])).status).toBe(403)
  })

  it('refuses to touch a member who outranks the actor', async () => {
    const owner = await register()
    const mod = await register()
    const boss = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, mod.id)
    await joinAsMember(server.id, boss.id)
    await grant(server.id, mod.id, PERMISSIONS.ManageRoles, 5)
    await grant(server.id, boss.id, PERMISSIONS.KickMembers, 9)

    expect((await setRoles(mod, server.id, boss.id, [])).status).toBe(403)
  })

  it('will not let an administrator change the owner’s roles', async () => {
    // The explicit rule. An admin holds every bit, so only an ownership check
    // stops this — exactly what canActOnMember guards elsewhere.
    const owner = await register()
    const admin = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, admin.id)
    await grant(server.id, admin.id, PERMISSIONS.Administrator, 9)

    expect((await setRoles(admin, server.id, owner.id, [])).status).toBe(403)
  })

  it('refuses a member who is not in the server', async () => {
    const owner = await register()
    const stranger = await register()
    const server = await mkServer(owner)
    expect((await setRoles(owner, server.id, stranger.id, [])).status).toBe(404)
  })
})

describe('the side-car stays in step with membership', () => {
  it('drops a leaver’s role assignments in the same write', async () => {
    // The one real weakness of storing roles beside members rather than in
    // them: orphaned rows that silently hand the roles back on rejoin.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const { body } = await mkRole(owner, server.id, { name: 'Mod' })
    await setRoles(owner, server.id, member.id, [body.role.id])

    let doc = await Server.findById(server.id)
    expect(doc!.memberRoles).toHaveLength(1)

    const res = await app().delete(`/servers/${server.id}/members/${member.id}`).set(auth(owner))
    expect(res.status).toBe(200)

    doc = await Server.findById(server.id)
    expect(doc!.members.map(String)).not.toContain(member.id)
    expect(doc!.memberRoles).toHaveLength(0)
  })
})
