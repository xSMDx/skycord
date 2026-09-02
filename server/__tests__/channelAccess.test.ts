import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { Channel } from '../models/Channel'
import { Category } from '../models/Category'
import { Role } from '../models/Role'
import { PERMISSIONS } from '../permissions'

/**
 * Enforcement, from the outside.
 *
 * channelPermissions.test.ts proves the algorithm and overwriteModel.test.ts
 * proves the storage; this proves the HTTP surface actually refuses. All three
 * are needed — a correct resolver wired to nothing is exactly as private as no
 * resolver at all.
 */

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'S' })).body.server

const joinAsMember = (sid: string, uid: string) =>
  Server.updateOne({ _id: sid }, { $push: { members: uid } })

const detail = (u: TestUser, sid: string) => app().get(`/servers/${sid}`).set(auth(u))

/** @everyone is created on demand by the first permission-aware read. */
const everyoneId = async (u: TestUser, sid: string) => {
  await app().get(`/servers/${sid}/roles`).set(auth(u))
  const r = await Role.findOne({ server: sid, isEveryone: true })
  return r!._id
}

const LOCK = PERMISSIONS.ViewChannels | PERMISSIONS.Connect

describe('nothing changes for a server that has set no overwrites', () => {
  it('still shows every channel to an ordinary member', async () => {
    // The regression that would matter most: @everyone's defaults include
    // ViewChannels, so switching enforcement on must be invisible.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)

    const res = await detail(member, server.id)
    expect(res.status).toBe(200)
    expect(res.body.channels).toHaveLength(2)          // seeded general + General
    expect(res.body.channels.every((c: any) => c.locked === false)).toBe(true)
  })

  it('still lets them post', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const { channels } = (await detail(member, server.id)).body
    const text = channels.find((c: any) => c.type === 'text')

    const res = await app().post(`/servers/${server.id}/channels/${text.id}/messages`)
      .set(auth(member)).send({ content: 'hello' })
    expect(res.status).toBe(201)
  })
})

describe('a private channel', () => {
  const lockChannel = async (u: TestUser, sid: string, cid: string) => {
    const everyone = await everyoneId(u, sid)
    await Channel.updateOne({ _id: cid }, {
      $set: { overwrites: [{ id: everyone, type: 'role', allow: '0', deny: LOCK.toString() }] },
    })
  }

  it('disappears from the sidebar', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const { channels } = (await detail(owner, server.id)).body
    const text = channels.find((c: any) => c.type === 'text')
    await lockChannel(owner, server.id, text.id)

    const seen = (await detail(member, server.id)).body.channels
    expect(seen.map((c: any) => c.id)).not.toContain(text.id)
  })

  it('is still visible to the owner', async () => {
    const owner = await register()
    const server = await mkServer(owner)
    const { channels } = (await detail(owner, server.id)).body
    await lockChannel(owner, server.id, channels[0].id)
    expect((await detail(owner, server.id)).body.channels).toHaveLength(2)
  })

  it('answers 404 on its messages, not 403', async () => {
    // 403 would confirm the channel exists, which is the fact being hidden.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const { channels } = (await detail(owner, server.id)).body
    const text = channels.find((c: any) => c.type === 'text')
    await lockChannel(owner, server.id, text.id)

    const res = await app().get(`/servers/${server.id}/channels/${text.id}/messages`).set(auth(member))
    expect(res.status).toBe(404)
  })

  it('refuses a message sent to it', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const { channels } = (await detail(owner, server.id)).body
    const text = channels.find((c: any) => c.type === 'text')
    await lockChannel(owner, server.id, text.id)

    const res = await app().post(`/servers/${server.id}/channels/${text.id}/messages`)
      .set(auth(member)).send({ content: 'sneaking in' })
    expect(res.status).toBe(404)
  })

  it('lets an allowed role back in', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const { channels } = (await detail(owner, server.id)).body
    const text = channels.find((c: any) => c.type === 'text')

    const everyone = await everyoneId(owner, server.id)
    const staff = await Role.create({ server: server.id, name: 'Staff', position: 3 })
    await Channel.updateOne({ _id: text.id }, {
      $set: { overwrites: [
        { id: everyone, type: 'role', allow: '0', deny: LOCK.toString() },
        { id: staff._id, type: 'role', allow: LOCK.toString(), deny: '0' },
      ] },
    })
    await Server.updateOne({ _id: server.id }, {
      $push: { memberRoles: { user: member.id, roles: [staff._id] } },
    })

    const seen = (await detail(member, server.id)).body.channels
    expect(seen.map((c: any) => c.id)).toContain(text.id)
  })
})

describe('a read-only channel', () => {
  it('is visible but refuses messages with 403', async () => {
    // Seen, so its existence is not secret — 403 rather than 404, and the
    // message says why instead of pretending the channel vanished.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const { channels } = (await detail(owner, server.id)).body
    const text = channels.find((c: any) => c.type === 'text')

    const everyone = await everyoneId(owner, server.id)
    await Channel.updateOne({ _id: text.id }, {
      $set: { overwrites: [{
        id: everyone, type: 'role', allow: '0', deny: PERMISSIONS.SendMessages.toString(),
      }] },
    })

    const seen = (await detail(member, server.id)).body.channels
    expect(seen.map((c: any) => c.id)).toContain(text.id)

    const res = await app().post(`/servers/${server.id}/channels/${text.id}/messages`)
      .set(auth(member)).send({ content: 'nope' })
    expect(res.status).toBe(403)
  })
})

describe('hideWhenDenied', () => {
  it('shows the channel locked when hiding is switched off', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const { channels } = (await detail(owner, server.id)).body
    const text = channels.find((c: any) => c.type === 'text')

    const everyone = await everyoneId(owner, server.id)
    await Channel.updateOne({ _id: text.id }, {
      $set: {
        hideWhenDenied: false,
        overwrites: [{ id: everyone, type: 'role', allow: '0', deny: LOCK.toString() }],
      },
    })

    const seen = (await detail(member, server.id)).body.channels
    const row = seen.find((c: any) => c.id === text.id)
    expect(row).toBeDefined()
    expect(row.locked).toBe(true)
  })

  it('still refuses its messages — a visible lock is not a talkable one', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const { channels } = (await detail(owner, server.id)).body
    const text = channels.find((c: any) => c.type === 'text')

    const everyone = await everyoneId(owner, server.id)
    await Channel.updateOne({ _id: text.id }, {
      $set: {
        hideWhenDenied: false,
        overwrites: [{ id: everyone, type: 'role', allow: '0', deny: LOCK.toString() }],
      },
    })

    expect((await app().get(`/servers/${server.id}/channels/${text.id}/messages`)
      .set(auth(member))).status).toBe(404)
  })
})

describe('categories reach their channels', () => {
  it('hides a channel because its category is locked', async () => {
    // Live inheritance: the channel says nothing and follows the category.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const everyone = await everyoneId(owner, server.id)

    const cat = await Category.create({
      server: server.id, name: 'Staff',
      overwrites: [{ id: everyone, type: 'role', allow: '0', deny: LOCK.toString() }],
    })
    const { channels } = (await detail(owner, server.id)).body
    const text = channels.find((c: any) => c.type === 'text')
    await Channel.updateOne({ _id: text.id }, { $set: { category: cat._id } })

    const seen = (await detail(member, server.id)).body.channels
    expect(seen.map((c: any) => c.id)).not.toContain(text.id)
  })

  it('lets a channel re-open itself inside a locked category', async () => {
    // The case live inheritance exists to express, and why later layers win.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const everyone = await everyoneId(owner, server.id)

    const cat = await Category.create({
      server: server.id, name: 'Staff',
      overwrites: [{ id: everyone, type: 'role', allow: '0', deny: LOCK.toString() }],
    })
    const { channels } = (await detail(owner, server.id)).body
    const text = channels.find((c: any) => c.type === 'text')
    await Channel.updateOne({ _id: text.id }, {
      $set: {
        category: cat._id,
        overwrites: [{ id: everyone, type: 'role', allow: LOCK.toString(), deny: '0' }],
      },
    })

    const seen = (await detail(member, server.id)).body.channels
    expect(seen.map((c: any) => c.id)).toContain(text.id)
  })
})

describe('voice', () => {
  it('refuses a token for a channel the caller cannot Connect to', async () => {
    // The only door: LiveKit admits anyone holding a token, so this check
    // cannot live in the UI.
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const { channels } = (await detail(owner, server.id)).body
    const voice = channels.find((c: any) => c.type === 'voice')

    const everyone = await everyoneId(owner, server.id)
    await Channel.updateOne({ _id: voice.id }, {
      $set: { overwrites: [{ id: everyone, type: 'role', allow: '0', deny: LOCK.toString() }] },
    })

    const res = await app().post('/voice/token').set(auth(member))
      .send({ conversationId: voice.id, kind: 'channel' })
    expect(res.status).toBe(404)
  })

  it('refuses when Connect alone is denied, though the channel is visible', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const { channels } = (await detail(owner, server.id)).body
    const voice = channels.find((c: any) => c.type === 'voice')

    const everyone = await everyoneId(owner, server.id)
    await Channel.updateOne({ _id: voice.id }, {
      $set: { overwrites: [{
        id: everyone, type: 'role', allow: '0', deny: PERMISSIONS.Connect.toString(),
      }] },
    })

    const res = await app().post('/voice/token').set(auth(member))
      .send({ conversationId: voice.id, kind: 'channel' })
    expect(res.status).toBe(403)
  })

  it('still issues a token when nothing is locked', async () => {
    const owner = await register()
    const member = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, member.id)
    const { channels } = (await detail(member, server.id)).body
    const voice = channels.find((c: any) => c.type === 'voice')

    const res = await app().post('/voice/token').set(auth(member))
      .send({ conversationId: voice.id, kind: 'channel' })
    expect(res.status).toBe(200)
  })
})

describe('administrators and owners are not lockable out', () => {
  it('shows an admin a channel that denies @everyone', async () => {
    // Administrator bypasses overwrites entirely — the base check runs first.
    const owner = await register()
    const admin = await register()
    const server = await mkServer(owner)
    await joinAsMember(server.id, admin.id)
    const everyone = await everyoneId(owner, server.id)
    const role = await Role.create({
      server: server.id, name: 'Admin', position: 9,
      permissions: PERMISSIONS.Administrator.toString(),
    })
    await Server.updateOne({ _id: server.id }, {
      $push: { memberRoles: { user: admin.id, roles: [role._id] } },
    })

    const { channels } = (await detail(owner, server.id)).body
    const text = channels.find((c: any) => c.type === 'text')
    await Channel.updateOne({ _id: text.id }, {
      $set: { overwrites: [{ id: everyone, type: 'role', allow: '0', deny: LOCK.toString() }] },
    })

    const seen = (await detail(admin, server.id)).body.channels
    expect(seen.map((c: any) => c.id)).toContain(text.id)
  })
})
