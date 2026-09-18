/**
 * Text a person chooses — a name, a topic, a message, a reaction — is made
 * well-formed where it comes in, so every copy sent out matches the stored one.
 *
 * JSON.parse accepts an unpaired UTF-16 surrogate (the escape "\uD83D" with no
 * partner), so a raw API call can send one. The database cannot keep one: BSON
 * strings are UTF-8, which has no encoding for half a pair, so the driver writes
 * U+FFFD in its place. Responses and socket broadcasts were built from the value
 * still in memory, though, so everyone watching was sent text that differed from
 * what was stored until they reloaded — and a client that handed it to
 * encodeURIComponent threw.
 *
 * Each test sends half an emoji and checks every copy that goes out against the
 * one the database kept.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import { Types } from 'mongoose'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { wellFormed } from '../utils/wellFormed'
import { Server } from '../models/Server'
import { Channel } from '../models/Channel'
import { Category } from '../models/Category'
import { Role } from '../models/Role'
import { VoiceServer } from '../models/VoiceServer'
import { Conversation } from '../models/Conversation'
import { Message } from '../models/Message'
import { Friendship } from '../models/Friendship'
import { Sticker } from '../models/Sticker'
import { User } from '../models/User'
import { dmConvId } from '../controllers/messagesController'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

/** The first half of 😀, with nothing after it. */
const HALF = '\uD83D'
const SENT = `party ${HALF}`
/** What the database keeps of SENT. */
const KEPT = 'party \uFFFD'
/** A second value, for renames and edits that have to change something. */
const SENT2 = `again ${HALF}`
const KEPT2 = 'again \uFFFD'

const track = (s: ClientSocket) => { open.push(s); return s }
const connect = async (u: TestUser) => track(await connectSocket(sockets.url, u.token))

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

/** A second member, connected, so a broadcast has somebody to reach. */
const memberSocket = async (sid: string) => {
  const b = await register()
  await Server.updateOne({ _id: sid }, { $push: { members: b.id } })
  return { b, sock: await connect(b) }
}

const mkGroup = (owner: TestUser, members: TestUser[]) =>
  Conversation.create({
    type: 'group', owner: owner.id,
    members: [owner.id, ...members.map(m => m.id)],
    lastMessageAt: new Date(),
  })

const befriend = (a: TestUser, b: TestUser) =>
  Friendship.create({ requester: a.id, receiver: b.id, status: 'accepted' })

/** Emits and resolves with the handler's ack. */
const ask = (s: ClientSocket, event: string, data: unknown) =>
  new Promise<any>(resolve => s.emit(event, data, resolve))

describe('wellFormed', () => {
  it('replaces an unpaired surrogate, high or low, with U+FFFD', () => {
    expect(wellFormed(`a${HALF}b`)).toBe('a\uFFFDb')
    expect(wellFormed('a\uDE00b')).toBe('a\uFFFDb')
  })

  it('reads a pair written backwards as two unpaired halves', () => {
    expect(wellFormed('\uDE00\uD83D')).toBe('\uFFFD\uFFFD')
  })

  it('leaves well-formed text alone, emoji and joined emoji included', () => {
    for (const s of ['', 'general', '😀 party', 'مرحبا', '👩‍👩‍👧']) expect(wellFormed(s)).toBe(s)
  })

  it('keeps the length, so no length limit reads the result differently', () => {
    expect(wellFormed(HALF.repeat(100))).toHaveLength(100)
  })

  // The premise the rest stands on: U+FFFD is what storing the string does
  // anyway, so normalising first changes nothing stored — only the copies that
  // go out before the database is read again.
  it('matches what the database keeps of the same string', async () => {
    const raw = `a${HALF}b\uDE00c😀`
    const { _id } = await Server.create({ name: raw, owner: new Types.ObjectId() })
    expect((await Server.findById(_id).lean())!.name).toBe(wellFormed(raw))
  })
})

describe('server names', () => {
  it('create answers with the name as stored, not as sent', async () => {
    const a = await register()
    const res = await app().post('/servers').set(auth(a)).send({ name: SENT })

    expect(res.status).toBe(201)
    expect(res.body.server.name).toBe(KEPT)
    expect((await Server.findById(res.body.server.id).lean())!.name).toBe(KEPT)
  })

  it('rename answers and broadcasts the name as stored', async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const { sock } = await memberSocket(server.id)
    const got = nextEvent(sock, 'server:updated')

    const res = await app().patch(`/servers/${server.id}`).set(auth(a)).send({ name: SENT })

    expect(res.body.server.name).toBe(KEPT)
    expect((await got).server.name).toBe(KEPT)
    expect((await Server.findById(server.id).lean())!.name).toBe(KEPT)
  })

  it('leaves an emoji name exactly as typed', async () => {
    const a = await register()
    const created = await app().post('/servers').set(auth(a)).send({ name: '😀 party' })
    expect(created.body.server.name).toBe('😀 party')

    const sid = created.body.server.id
    const { sock } = await memberSocket(sid)
    const got = nextEvent(sock, 'server:updated')
    const renamed = await app().patch(`/servers/${sid}`).set(auth(a)).send({ name: '🎉 after' })

    expect(renamed.body.server.name).toBe('🎉 after')
    expect((await got).server.name).toBe('🎉 after')
    expect((await Server.findById(sid).lean())!.name).toBe('🎉 after')
  })
})

describe('every other place chosen text comes in', () => {
  it('a server description', async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const { sock } = await memberSocket(server.id)
    const got = nextEvent(sock, 'server:updated')

    const res = await app().patch(`/servers/${server.id}`).set(auth(a)).send({ description: SENT })

    expect(res.body.server.description).toBe(KEPT)
    expect((await got).server.description).toBe(KEPT)
    expect((await Server.findById(server.id).lean())!.description).toBe(KEPT)
  })

  it('a channel name and topic', async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const { sock } = await memberSocket(server.id)

    const announced = nextEvent(sock, 'channel:created')
    const created = await app().post(`/servers/${server.id}/channels`).set(auth(a))
      .send({ name: SENT, type: 'text' })
    expect(created.body.channel.name).toBe(KEPT)
    expect((await announced).channel.name).toBe(KEPT)

    const cid = created.body.channel.id
    const updated = nextEvent(sock, 'channel:updated')
    const res = await app().patch(`/servers/${server.id}/channels/${cid}`).set(auth(a))
      .send({ name: SENT2, topic: SENT2 })
    expect(res.body.channel).toMatchObject({ name: KEPT2, topic: KEPT2 })
    expect((await updated).channel).toMatchObject({ name: KEPT2, topic: KEPT2 })
    expect(await Channel.findById(cid).lean()).toMatchObject({ name: KEPT2, topic: KEPT2 })
  })

  it('a category name', async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const { sock } = await memberSocket(server.id)

    const announced = nextEvent(sock, 'category:created')
    const created = await app().post(`/servers/${server.id}/categories`).set(auth(a)).send({ name: SENT })
    expect(created.body.category.name).toBe(KEPT)
    expect((await announced).category.name).toBe(KEPT)

    const cid = created.body.category.id
    const updated = nextEvent(sock, 'category:updated')
    const res = await app().patch(`/servers/${server.id}/categories/${cid}`).set(auth(a)).send({ name: SENT2 })
    expect(res.body.category.name).toBe(KEPT2)
    expect((await updated).category.name).toBe(KEPT2)
    expect((await Category.findById(cid).lean())!.name).toBe(KEPT2)
  })

  it('a role name', async () => {
    const a = await register()
    const { server } = await mkServer(a)
    const { sock } = await memberSocket(server.id)

    const announced = nextEvent(sock, 'role:created')
    const created = await app().post(`/servers/${server.id}/roles`).set(auth(a)).send({ name: SENT })
    expect(created.body.role.name).toBe(KEPT)
    expect((await announced).role.name).toBe(KEPT)

    const rid = created.body.role.id
    const updated = nextEvent(sock, 'role:updated')
    const res = await app().patch(`/servers/${server.id}/roles/${rid}`).set(auth(a)).send({ name: SENT2 })
    expect(res.body.role.name).toBe(KEPT2)
    expect((await updated).role.name).toBe(KEPT2)
    expect((await Role.findById(rid).lean())!.name).toBe(KEPT2)
  })

  it('a voice server name', async () => {
    const a = await register()
    const { server } = await mkServer(a)

    const created = await app().post(`/servers/${server.id}/voice-servers`).set(auth(a)).send({
      name: SENT, url: 'wss://livekit.example.com', apiKey: 'APIkey123', apiSecret: 'supersecretvalue',
    })
    expect(created.body.voiceServer.name).toBe(KEPT)

    const vid = created.body.voiceServer.id
    const res = await app().patch(`/servers/${server.id}/voice-servers/${vid}`).set(auth(a)).send({ name: SENT2 })
    expect(res.body.voiceServer.name).toBe(KEPT2)
    expect((await VoiceServer.findById(vid).lean())!.name).toBe(KEPT2)
  })

  it('a channel message', async () => {
    const a = await register()
    const { server, channels } = await mkServer(a)
    const c = channels.find((x: any) => x.type === 'text')
    const { sock } = await memberSocket(server.id)
    const got = nextEvent(sock, 'channel:receive')

    const res = await app().post(`/servers/${server.id}/channels/${c.id}/messages`).set(auth(a))
      .send({ content: SENT })

    expect(res.body.message.content).toBe(KEPT)
    expect((await got).content).toBe(KEPT)
    expect((await Message.findById(res.body.message._id).lean())!.content).toBe(KEPT)
  })

  it('a group name, and the notice a rename posts', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)
    const bSock = await connect(b)

    const announced = nextEvent(bSock, 'group:created')
    const created = await app().post('/conversations/groups').set(auth(a))
      .send({ memberIds: [b.id], name: SENT })
    expect(created.body.group.name).toBe(KEPT)
    expect((await announced).name).toBe(KEPT)

    const gid = created.body.group.id
    const updated = nextEvent(bSock, 'group:updated')
    const res = await app().patch(`/conversations/groups/${gid}`).set(auth(a)).send({ name: SENT2 })
    expect(res.body.group.name).toBe(KEPT2)
    expect((await updated).name).toBe(KEPT2)

    // Sent again it is the same name, so nothing is announced. Compared raw,
    // the half never equalled the stored U+FFFD, and every repeat posted
    // another "changed the group name" showing a name that had not changed.
    await app().patch(`/conversations/groups/${gid}`).set(auth(a)).send({ name: SENT2 })
    const notices = await Message.find({ conversationId: gid, systemType: 'rename' }).lean()
    expect(notices).toHaveLength(1)
    expect(notices[0].content.endsWith(KEPT2)).toBe(true)
  })

  it('a group message sent over HTTP', async () => {
    const a = await register(), b = await register()
    const group = await mkGroup(a, [b])
    const bSock = await connect(b)
    const got = nextEvent(bSock, 'group:receive')

    const res = await app().post(`/conversations/groups/${group._id}/messages`).set(auth(a))
      .send({ content: SENT })

    expect(res.body.message.content).toBe(KEPT)
    expect((await got).content).toBe(KEPT)
    expect((await Message.findById(res.body.message._id).lean())!.content).toBe(KEPT)
  })

  it('a DM sent and edited over HTTP', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)

    const sent = await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: SENT })
    expect(sent.body.message.content).toBe(KEPT)

    const id = sent.body.message._id
    const edited = await app().patch(`/messages/${id}`).set(auth(a)).send({ content: SENT2 })
    expect(edited.body.message.content).toBe(KEPT2)
    expect((await Message.findById(id).lean())!.content).toBe(KEPT2)
  })

  it('a DM, a reply and a group message sent over the socket', async () => {
    const a = await register(), b = await register()
    await befriend(a, b)
    const group = await mkGroup(a, [b])
    const aSock = await connect(a), bSock = await connect(b)

    const dm = nextEvent(bSock, 'dm:receive')
    const sent = await ask(aSock, 'dm:send', { partnerId: b.id, content: SENT })
    expect(sent.message.content).toBe(KEPT)
    expect((await dm).content).toBe(KEPT)

    const reply = nextEvent(bSock, 'dm:receive')
    const replied = await ask(aSock, 'dm:reply', {
      partnerId: b.id, content: SENT2, replyToIds: [sent.message._id],
    })
    expect(replied.message.content).toBe(KEPT2)
    expect((await reply).content).toBe(KEPT2)

    const posted = nextEvent(bSock, 'group:receive')
    const grouped = await ask(aSock, 'group:send', { groupId: group._id.toString(), content: SENT })
    expect(grouped.message.content).toBe(KEPT)
    expect((await posted).content).toBe(KEPT)

    const stored = await Message.find({
      _id: { $in: [sent.message._id, replied.message._id, grouped.message._id] },
    }).lean()
    expect(stored.map(m => m.content).sort()).toEqual([KEPT, KEPT, KEPT2].sort())
  })

  it('an edit made over the socket', async () => {
    const a = await register(), b = await register()
    const msg = await Message.create({
      conversationId: dmConvId(a.id, b.id), kind: 'dm',
      authorId: a.id, authorName: a.username, content: 'before',
    })
    const aSock = await connect(a), bSock = await connect(b)
    const got = nextEvent(bSock, 'message:edited')

    const ack = await ask(aSock, 'message:edit', { messageId: msg._id.toString(), content: SENT })

    expect(ack.ok).toBe(true)
    expect((await got).content).toBe(KEPT)
    expect((await Message.findById(msg._id).lean())!.content).toBe(KEPT)
  })

  it('a reaction, which then comes off again like any other', async () => {
    const a = await register(), b = await register()
    const group = await mkGroup(a, [b])
    const msg = await Message.create({
      conversationId: group._id.toString(), kind: 'group',
      authorId: a.id, authorName: a.username, content: 'react to me',
    })
    const bSock = await connect(b)

    const first = await ask(bSock, 'message:react', { messageId: msg._id.toString(), emoji: HALF })
    expect(first.reactions.map((r: any) => r.emoji)).toEqual(['\uFFFD'])

    // Reacting with the same thing again is a toggle. Compared raw, the half
    // never matched the stored U+FFFD, so it was added a second time instead.
    await ask(bSock, 'message:react', { messageId: msg._id.toString(), emoji: HALF })
    expect((await Message.findById(msg._id).lean())!.reactions).toHaveLength(0)
  })

  it('a sticker name and text', async () => {
    const a = await register()

    const res = await app().post('/stickers').set(auth(a))
      .send({ name: SENT, type: 'text', text: { content: HALF } })

    expect(res.body.sticker.name).toBe(KEPT)
    expect(res.body.sticker.text.content).toBe('\uFFFD')
    expect(await Sticker.findById(res.body.sticker._id).lean())
      .toMatchObject({ name: KEPT, text: { content: '\uFFFD' } })
  })

  it('a display name given at registration', async () => {
    const username = `wf${Date.now()}`
    const res = await app().post('/auth/register').send({
      username, email: `${username}@test.local`, password: 'TestPass123!', displayName: SENT,
    })

    expect(res.status).toBe(201)
    expect(res.body.user.displayName).toBe(KEPT)
    expect((await User.findById(res.body.user.id).lean())!.displayName).toBe(KEPT)
  })

  // A guard rather than a fix: this endpoint answers with the document the
  // database hands back, so it already matched. It fails the day the response
  // is built from the request instead.
  it('a profile edit answers with what it stored', async () => {
    const a = await register()

    const res = await app().patch('/users/me').set(auth(a))
      .send({ displayName: SENT, bio: SENT, customStatus: { text: SENT } })

    expect(res.body.user).toMatchObject({ displayName: KEPT, bio: KEPT, customStatus: { text: KEPT } })
    expect(await User.findById(a.id).lean())
      .toMatchObject({ displayName: KEPT, bio: KEPT, customStatus: { text: KEPT } })
  })
})
