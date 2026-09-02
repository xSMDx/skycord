import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { Channel } from '../models/Channel'
import { Category } from '../models/Category'
import { Role } from '../models/Role'
import { PERMISSIONS, ALL_PERMISSIONS } from '../permissions'

/**
 * Writing overwrites.
 *
 * The read side is covered by channelAccess.test.ts; this is the door someone
 * walks through to lock a channel, and therefore the door someone would walk
 * through to unlock one they should not be able to. Most of these are refusals.
 */

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'S' })).body.server

const joinAsMember = (sid: string, uid: string) =>
  Server.updateOne({ _id: sid }, { $push: { members: uid } })

const detail = (u: TestUser, sid: string) => app().get(`/servers/${sid}`).set(auth(u))

const everyoneId = async (u: TestUser, sid: string) => {
  await app().get(`/servers/${sid}/roles`).set(auth(u))
  return (await Role.findOne({ server: sid, isEveryone: true }))!._id.toString()
}

const patchChannel = (u: TestUser, sid: string, cid: string, body: unknown) =>
  app().patch(`/servers/${sid}/channels/${cid}`).set(auth(u)).send(body)

/** Give `uid` a role with `bits` at `position`, and return its id. */
const grant = async (sid: string, uid: string, bits: bigint, position = 5) => {
  const role = await Role.create({
    server: sid, name: 'granted', position, permissions: bits.toString(),
  })
  await Server.updateOne({ _id: sid }, {
    $push: { memberRoles: { user: uid, roles: [role._id] } },
  })
  return role
}

const LOCK = PERMISSIONS.ViewChannels | PERMISSIONS.Connect

describe('the owner locking a channel', () => {
  it('stores the overwrite and reads it back on the wire', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    const text = (await detail(owner, server.id)).body.channels.find((c: any) => c.type === 'text')
    const everyone = await everyoneId(owner, server.id)

    const res = await patchChannel(owner, server.id, text.id, {
      overwrites: [{ id: everyone, type: 'role', allow: '0', deny: LOCK.toString() }],
    })
    expect(res.status).toBe(200)

    const back = (await detail(owner, server.id)).body.channels.find((c: any) => c.id === text.id)
    expect(back.overwrites).toHaveLength(1)
    expect(back.overwrites[0]).toMatchObject({ id: everyone, type: 'role', deny: LOCK.toString() })
  })

  it('accepts a permissions-only edit, with no name in the body', async () => {
    // The Permissions tab sends only what it owns; requiring a name would make
    // saving permissions also a rename.
    const owner = await register()
    const server = await mkServer(owner)
    const text = (await detail(owner, server.id)).body.channels.find((c: any) => c.type === 'text')
    expect((await patchChannel(owner, server.id, text.id, { overwrites: [] })).status).toBe(200)
  })

  it('stores hideWhenDenied', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    const text = (await detail(owner, server.id)).body.channels.find((c: any) => c.type === 'text')
    await patchChannel(owner, server.id, text.id, { hideWhenDenied: false })
    expect((await Channel.findById(text.id))!.hideWhenDenied).toBe(false)
  })
})

describe('refusals', () => {
  it('needs Manage Roles, not merely Manage Channels', async () => {
    // Tidying the channel list is not the same power as deciding who can see
    // #incidents, and the reference separates them too.
    const owner = await register()
    const mod = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, mod.id)
    await grant(server.id, mod.id, PERMISSIONS.ViewChannels | PERMISSIONS.ManageChannels)

    const text = (await detail(owner, server.id)).body.channels.find((c: any) => c.type === 'text')
    const everyone = await everyoneId(owner, server.id)

    // Manage Channels alone gets a rename through...
    expect((await patchChannel(mod, server.id, text.id, { name: 'renamed' })).status).toBe(200)
    // ...but not a permission edit.
    const res = await patchChannel(mod, server.id, text.id, {
      overwrites: [{ id: everyone, type: 'role', allow: '0', deny: LOCK.toString() }],
    })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/manage roles/i)
  })

  it('refuses to grant a permission the actor does not hold', async () => {
    const owner = await register()
    const mod = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, mod.id)
    await grant(server.id, mod.id, PERMISSIONS.ViewChannels | PERMISSIONS.ManageRoles)
    const text = (await detail(owner, server.id)).body.channels.find((c: any) => c.type === 'text')
    const everyone = await everyoneId(owner, server.id)

    const res = await patchChannel(mod, server.id, text.id, {
      overwrites: [{ id: everyone, type: 'role', allow: PERMISSIONS.BanMembers.toString(), deny: '0' }],
    })
    expect(res.status).toBe(403)
  })

  it('refuses to DENY a permission the actor does not hold', async () => {
    // Both directions. Being able to strip a permission you lack from a role
    // above you is escalation wearing a different hat.
    const owner = await register()
    const mod = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, mod.id)
    await grant(server.id, mod.id, PERMISSIONS.ViewChannels | PERMISSIONS.ManageRoles)
    const text = (await detail(owner, server.id)).body.channels.find((c: any) => c.type === 'text')
    const everyone = await everyoneId(owner, server.id)

    const res = await patchChannel(mod, server.id, text.id, {
      overwrites: [{ id: everyone, type: 'role', allow: '0', deny: PERMISSIONS.BanMembers.toString() }],
    })
    expect(res.status).toBe(403)
  })

  it('refuses an overwrite aimed at a role above the actor', async () => {
    // Otherwise the hierarchy holds when editing a role directly and vanishes
    // the moment you edit it through a channel.
    const owner = await register()
    const mod = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, mod.id)
    await grant(server.id, mod.id, PERMISSIONS.ViewChannels | PERMISSIONS.ManageRoles, 5)
    const boss = await Role.create({ server: server.id, name: 'Boss', position: 9 })
    const text = (await detail(owner, server.id)).body.channels.find((c: any) => c.type === 'text')

    const res = await patchChannel(mod, server.id, text.id, {
      overwrites: [{ id: boss._id.toString(), type: 'role', allow: '0', deny: PERMISSIONS.ViewChannels.toString() }],
    })
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/above your highest role/i)
  })

  it('refuses a permission both allowed and denied', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    const text = (await detail(owner, server.id)).body.channels.find((c: any) => c.type === 'text')
    const everyone = await everyoneId(owner, server.id)
    const res = await patchChannel(owner, server.id, text.id, {
      overwrites: [{
        id: everyone, type: 'role',
        allow: PERMISSIONS.ViewChannels.toString(),
        deny:  PERMISSIONS.ViewChannels.toString(),
      }],
    })
    expect(res.status).toBe(400)
  })

  it('refuses two entries for the same target', async () => {
    // They would resolve by accumulation, making "the row for @everyone" a lie.
    const owner = await register()
    const server = await mkServer(owner)
    const text = (await detail(owner, server.id)).body.channels.find((c: any) => c.type === 'text')
    const everyone = await everyoneId(owner, server.id)
    const res = await patchChannel(owner, server.id, text.id, {
      overwrites: [
        { id: everyone, type: 'role', allow: '0', deny: '0' },
        { id: everyone, type: 'role', allow: '0', deny: '0' },
      ],
    })
    expect(res.status).toBe(400)
  })

  it('refuses a role from another server', async () => {
    const owner = await register()
    const a = await mkServer(owner)
    const b = await mkServer(owner)
    const foreign = await Role.create({ server: b.id, name: 'Elsewhere', position: 1 })
    const text = (await detail(owner, a.id)).body.channels.find((c: any) => c.type === 'text')

    const res = await patchChannel(owner, a.id, text.id, {
      overwrites: [{ id: foreign._id.toString(), type: 'role', allow: '0', deny: '0' }],
    })
    expect(res.status).toBe(400)
  })

  it('refuses a member overwrite for somebody not in the server', async () => {
    const owner = await register()
    const stranger = await register()
    const server = await mkServer(owner)
    const text = (await detail(owner, server.id)).body.channels.find((c: any) => c.type === 'text')
    const res = await patchChannel(owner, server.id, text.id, {
      overwrites: [{ id: stranger.id, type: 'member', allow: '0', deny: '0' }],
    })
    expect(res.status).toBe(400)
  })

  it('masks off bits this server cannot resolve', async () => {
    // A client one release ahead must not persist a flag nothing here honours.
    const owner = await register()
    const server = await mkServer(owner)
    const text = (await detail(owner, server.id)).body.channels.find((c: any) => c.type === 'text')
    const everyone = await everyoneId(owner, server.id)
    const future = (ALL_PERMISSIONS | (1n << 62n)).toString()

    await patchChannel(owner, server.id, text.id, {
      overwrites: [{ id: everyone, type: 'role', allow: future, deny: '0' }],
    })
    const stored = (await Channel.findById(text.id))!.overwrites[0]
    expect(BigInt(stored.allow)).toBe(ALL_PERMISSIONS)
  })
})

describe('categories', () => {
  it('stores overwrites and applies them to the channels inside', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const everyone = await everyoneId(owner, server.id)

    const cat = await Category.create({ server: server.id, name: 'Staff' })
    const text = (await detail(owner, server.id)).body.channels.find((c: any) => c.type === 'text')
    await Channel.updateOne({ _id: text.id }, { $set: { category: cat._id } })

    const res = await app().patch(`/servers/${server.id}/categories/${cat._id}`)
      .set(auth(owner)).send({
        overwrites: [{ id: everyone, type: 'role', allow: '0', deny: LOCK.toString() }],
      })
    expect(res.status).toBe(200)

    // Live inheritance: the channel said nothing and is now hidden.
    const seen = (await detail(member, server.id)).body.channels
    expect(seen.map((c: any) => c.id)).not.toContain(text.id)
  })

  it('accepts a permissions-only category edit', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    const cat = await Category.create({ server: server.id, name: 'Staff' })
    const res = await app().patch(`/servers/${server.id}/categories/${cat._id}`)
      .set(auth(owner)).send({ overwrites: [] })
    expect(res.status).toBe(200)
  })

  it('still 400s an edit that changes nothing at all', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    const cat = await Category.create({ server: server.id, name: 'Staff' })
    const res = await app().patch(`/servers/${server.id}/categories/${cat._id}`)
      .set(auth(owner)).send({})
    expect(res.status).toBe(400)
  })
})
