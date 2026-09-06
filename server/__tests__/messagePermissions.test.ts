import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, type TestUser,
} from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'
import { Role } from '../models/Role'
import { PERMISSIONS, serializeBits } from '../permissions'

/**
 * The four text permissions that used to be decoration.
 *
 * AddReactions, ReadMessageHistory, MentionEveryone and ManageMessages all
 * existed as toggles, were described in the settings UI, and were read by
 * nothing. Denying one changed no behaviour whatsoever. These tests are the
 * difference between a permission and a label — each one denies the bit and
 * asserts the OUTCOME changes, because that is the only claim worth making.
 */

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }
const ack = <T = any>(socket: ClientSocket, event: string, payload: any): Promise<T> =>
  new Promise(resolve => socket.emit(event, payload, resolve))

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'MP' })).body
const textOf = (channels: any[]) => channels.find((c: any) => c.type === 'text')
const post = async (u: TestUser, sid: string, cid: string, content: string) =>
  (await app().post(`/servers/${sid}/channels/${cid}/messages`).set(auth(u)).send({ content })).body.message
const history = (u: TestUser, sid: string, cid: string) =>
  app().get(`/servers/${sid}/channels/${cid}/messages`).set(auth(u))

/**
 * A plain member. The OWNER is useless for every test here: resolve() hands
 * them ALL_PERMISSIONS before any overwrite is consulted, so a denial would
 * appear not to work and the test would be measuring the short-circuit.
 */
const plainMember = async (sid: string) => {
  const m = await register()
  await Server.updateOne({ _id: sid }, { $push: { members: m.id } })
  return m
}

/** Deny `bits` to @everyone on one channel. */
const denyOnChannel = async (u: TestUser, sid: string, cid: string, bits: bigint) => {
  const everyone = (await app().get(`/servers/${sid}/roles`).set(auth(u))).body.roles
    .find((r: any) => r.isEveryone)
  return app().patch(`/servers/${sid}/channels/${cid}`).set(auth(u)).send({
    overwrites: [{ id: everyone.id, type: 'role', allow: '0', deny: serializeBits(bits) }],
  })
}

/** Give `uid` a role carrying exactly `bits`. */
const grant = async (sid: string, uid: string, bits: bigint) => {
  const role = await Role.create({
    server: sid, name: 'granted', position: 5, permissions: serializeBits(bits),
  })
  await Server.updateOne({ _id: sid }, { $push: { memberRoles: { user: uid, roles: [role._id] } } })
  return role
}

describe('ReadMessageHistory', () => {
  it('hides everything posted before, without refusing the request', async () => {
    // An empty list rather than a 403: the copy promises "a channel looks empty
    // until somebody posts again", which is only true if the channel opens.
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    await post(owner, server.id, c.id, 'ancient history')
    const member = await plainMember(server.id)

    expect((await history(member, server.id, c.id)).body.messages).toHaveLength(1)
    await denyOnChannel(owner, server.id, c.id, PERMISSIONS.ReadMessageHistory)

    const res = await history(member, server.id, c.id)
    expect(res.status).toBe(200)
    expect(res.body.messages).toEqual([])
  })

  it('does not take away the composer', async () => {
    // Reading history and posting are different permissions. Someone who can
    // send but not read back is a real configuration, and it must work.
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    const member = await plainMember(server.id)
    await denyOnChannel(owner, server.id, c.id, PERMISSIONS.ReadMessageHistory)

    const res = await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(member)).send({ content: 'still allowed' })
    expect(res.status).toBe(201)
    // And the message really is stored — it is the READ that is denied.
    expect(await Message.countDocuments({ conversationId: c.id })).toBe(1)
  })

  it('leaves the owner unaffected', async () => {
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    await post(owner, server.id, c.id, 'hello')
    await denyOnChannel(owner, server.id, c.id, PERMISSIONS.ReadMessageHistory)
    expect((await history(owner, server.id, c.id)).body.messages).toHaveLength(1)
  })
})

describe('MentionEveryone', () => {
  it('records the mention when the author holds it', async () => {
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    const msg = await post(owner, server.id, c.id, 'hey @everyone look')
    expect(msg.mentionsEveryone).toBe(true)
  })

  it('leaves the words alone but refuses the mention when denied', async () => {
    // The text is never edited. Stripping it would rewrite what somebody typed
    // to enforce a permission; what the permission controls is the highlight.
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    const member = await plainMember(server.id)
    await denyOnChannel(owner, server.id, c.id, PERMISSIONS.MentionEveryone)

    const res = await app().post(`/servers/${server.id}/channels/${c.id}/messages`)
      .set(auth(member)).send({ content: 'hey @everyone look' })
    expect(res.status).toBe(201)
    expect(res.body.message.content).toBe('hey @everyone look')
    expect(res.body.message.mentionsEveryone).toBe(false)

    const stored = await Message.findOne({ conversationId: c.id }).lean()
    expect(stored!.mentionsEveryone).toBe(false)
  })

  it('is false on a message that never mentioned anyone', async () => {
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    expect((await post(owner, server.id, c.id, 'just talking')).mentionsEveryone).toBe(false)
  })

  it('covers @here as well as @everyone', async () => {
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    expect((await post(owner, server.id, c.id, '@here quick one')).mentionsEveryone).toBe(true)
  })

  it('survives into the history payload', async () => {
    // Decided once at send and STORED. Re-deriving it on read would make an old
    // message change meaning whenever somebody edited a role.
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    await post(owner, server.id, c.id, '@everyone stored')
    const [m] = (await history(owner, server.id, c.id)).body.messages
    expect(m.mentionsEveryone).toBe(true)
  })
})

describe('AddReactions', () => {
  it('refuses a new reaction when denied', async () => {
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    const msg = await post(owner, server.id, c.id, 'react target')
    const member = await plainMember(server.id)
    await denyOnChannel(owner, server.id, c.id, PERMISSIONS.AddReactions)

    const sock = track(await connectSocket(sockets.url, member.token))
    const res = await ack(sock, 'message:react', { messageId: msg._id, emoji: '\u{1F44D}' })
    expect(res.ok).toBe(false)
  })

  it('still lets them JOIN a reaction somebody else started', async () => {
    // The asymmetry the settings copy promises: clicking a reaction that is
    // already there needs no permission at all.
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    const msg = await post(owner, server.id, c.id, 'react target')
    const member = await plainMember(server.id)

    const ownerSock = track(await connectSocket(sockets.url, owner.token))
    expect((await ack(ownerSock, 'message:react', { messageId: msg._id, emoji: '\u{1F44D}' })).ok).toBe(true)

    await denyOnChannel(owner, server.id, c.id, PERMISSIONS.AddReactions)
    const sock = track(await connectSocket(sockets.url, member.token))
    const res = await ack(sock, 'message:react', { messageId: msg._id, emoji: '\u{1F44D}' })
    expect(res.ok).toBe(true)

    const stored = await Message.findById(msg._id).lean()
    expect(stored!.reactions[0].userIds).toHaveLength(2)
  })

  it('still lets them REMOVE their own reaction after being denied', async () => {
    // A permission that could trap somebody's reaction on a message would be a
    // strange thing to hand anyone.
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    const msg = await post(owner, server.id, c.id, 'react target')
    const member = await plainMember(server.id)

    const sock = track(await connectSocket(sockets.url, member.token))
    expect((await ack(sock, 'message:react', { messageId: msg._id, emoji: '\u{1F44D}' })).ok).toBe(true)
    await denyOnChannel(owner, server.id, c.id, PERMISSIONS.AddReactions)
    expect((await ack(sock, 'message:react', { messageId: msg._id, emoji: '\u{1F44D}' })).ok).toBe(true)

    const stored = await Message.findById(msg._id).lean()
    expect(stored!.reactions).toHaveLength(0)
  })

  it('does not reach into a DM', async () => {
    // Every one of these is a guild concept. Nobody administers a DM.
    const a = await register(), b = await register()
    await app().post(`/users/friends/request`).set(auth(a)).send({ username: b.username })
    const msg = await Message.create({
      conversationId: [a.id, b.id].sort().join('_'), kind: 'dm',
      authorId: a.id, authorName: a.username, content: 'hi',
    })
    const sock = track(await connectSocket(sockets.url, a.token))
    const res = await ack(sock, 'message:react', { messageId: msg._id.toString(), emoji: '\u{1F44D}' })
    expect(res.ok).toBe(true)
  })
})

describe('ManageMessages', () => {
  it('refuses a plain member pinning in a channel', async () => {
    // Pinning used to be open to everyone who could see the channel — any
    // member could unpin what a moderator had pinned.
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    const msg = await post(owner, server.id, c.id, 'pin target')
    const member = await plainMember(server.id)

    const sock = track(await connectSocket(sockets.url, member.token))
    const res = await ack(sock, 'message:pin', { messageId: msg._id, pinned: true })
    expect(res.ok).toBe(false)
    expect((await Message.findById(msg._id).lean())!.pinned).toBe(false)
  })

  it('allows a member holding it', async () => {
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    const msg = await post(owner, server.id, c.id, 'pin target')
    const member = await plainMember(server.id)
    await grant(server.id, member.id, PERMISSIONS.ManageMessages | PERMISSIONS.ViewChannels)

    const sock = track(await connectSocket(sockets.url, member.token))
    expect((await ack(sock, 'message:pin', { messageId: msg._id, pinned: true })).ok).toBe(true)
  })

  it('lets a holder delete somebody else’s message', async () => {
    // The half of this permission that did not exist: deleting another
    // person's message was impossible for everyone, owner included, so a
    // channel could not actually be moderated.
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    const member = await plainMember(server.id)
    const theirs = await post(member, server.id, c.id, 'delete me')

    const sock = track(await connectSocket(sockets.url, owner.token))
    expect((await ack(sock, 'message:delete', { messageId: theirs._id })).ok).toBe(true)
    expect(await Message.findById(theirs._id)).toBeNull()
  })

  it('refuses a plain member deleting somebody else’s', async () => {
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    const theirs = await post(owner, server.id, c.id, 'not yours')
    const member = await plainMember(server.id)

    const sock = track(await connectSocket(sockets.url, member.token))
    expect((await ack(sock, 'message:delete', { messageId: theirs._id })).ok).toBe(false)
    expect(await Message.findById(theirs._id)).not.toBeNull()
  })

  it('always lets an author delete their own', async () => {
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    const member = await plainMember(server.id)
    const mine = await post(member, server.id, c.id, 'my own')

    const sock = track(await connectSocket(sockets.url, member.token))
    expect((await ack(sock, 'message:delete', { messageId: mine._id })).ok).toBe(true)
  })

  it('never allows EDITING somebody else’s message', async () => {
    // Deliberately not covered by ManageMessages, at any level. Putting words
    // in a person's mouth is not moderation, and no permission buys it.
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    const member = await plainMember(server.id)
    const theirs = await post(member, server.id, c.id, 'my words')

    const sock = track(await connectSocket(sockets.url, owner.token))
    const res = await ack(sock, 'message:edit', { messageId: theirs._id, content: 'not my words' })
    expect(res.ok).toBe(false)
    expect((await Message.findById(theirs._id).lean())!.content).toBe('my words')
  })
})
