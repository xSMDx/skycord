/**
 * What did I miss: GET /users/me/missed.
 *
 * After a phone's background connection drops it asks for the messages it
 * would have notified for while it was away. The server keeps no read state,
 * so this is "since T, what would notify me" and nothing more — the phone's own
 * rules (mutes, Do Not Disturb, levels) still have the last word.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Message } from '../models/Message'
import { Server } from '../models/Server'
import { Role } from '../models/Role'
import { Channel } from '../models/Channel'
import { Category } from '../models/Category'
import { Conversation } from '../models/Conversation'
import { dmConvId } from '../controllers/messagesController'
import { PERMISSIONS } from '../permissions'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

const MIN = 60_000
const HOUR = 60 * MIN

/**
 * Raw inserts, bypassing Mongoose: the tests need exact `createdAt` values and
 * `timestamps: true` would stamp its own. The same trick historyWindow.test.ts
 * uses.
 */
const put = async (
  conversationId: string, kind: 'dm' | 'group' | 'channel' | 'system', author: TestUser,
  content: string, at: number, extra: Record<string, unknown> = {},
) => {
  const doc = {
    _id: new Types.ObjectId(), conversationId, kind,
    authorId: new Types.ObjectId(author.id), authorName: author.username, authorAvatar: null, authorAvatarCrop: null,
    content, systemType: kind === 'system' ? 'call' : null, reactions: [], pinned: false, mentionsEveryone: false,
    edited: false, replyTo: null, replyToIds: [], createdAt: new Date(at), updatedAt: new Date(at), ...extra,
  }
  await Message.collection.insertOne(doc)
  return doc
}

const missed = (u: TestUser, since: number | string) =>
  app().get(`/users/me/missed?since=${since}`).set(auth(u))
const contents = (res: any) => res.body.events.map((e: any) => e.content)

const setPref = (u: TestUser, id: string, body: object) =>
  app().patch(`/users/me/conversations/${id}`).set(auth(u)).send(body)

const textOf = (channels: any[]) => channels.find((c: any) => c.type === 'text')
const mkGroup = (owner: TestUser, members: TestUser[]) =>
  Conversation.create({
    type: 'group', owner: owner.id, members: [owner.id, ...members.map(m => m.id)], lastMessageAt: new Date(),
  })

/** B owns server S and A is a plain member, so S's overwrites bind A and not B. */
const world = async () => {
  const a = await register(), b = await register()
  const { server, channels } = (await app().post('/servers').set(auth(b)).send({ name: 'S' })).body
  await Server.updateOne({ _id: server.id }, { $push: { members: a.id } })
  return { a, b, sid: server.id as string, cid: textOf(channels).id as string }
}

const everyoneId = async (owner: TestUser, sid: string) => {
  await app().get(`/servers/${sid}/roles`).set(auth(owner))
  return (await Role.findOne({ server: sid, isEveryone: true }))!._id
}

describe('GET /users/me/missed', () => {
  it('returns DMs since the given time, not before', async () => {
    const a = await register(), b = await register()
    const t0 = Date.now() - 10 * MIN
    const conv = dmConvId(a.id, b.id)
    await put(conv, 'dm', b, 'before the gap', t0 - MIN)
    const after = await put(conv, 'dm', b, 'after the gap', t0 + 1000)

    const res = await missed(a, t0)
    expect(res.status).toBe(200)
    expect(contents(res)).toEqual(['after the gap'])
    expect(res.body.events[0]).toEqual({
      type: 'dm', _id: after._id.toString(), conversationId: conv,
      authorId: b.id, authorName: b.username, content: 'after the gap',
      createdAt: new Date(t0 + 1000).toISOString(),
    })
  })

  it('finds a DM whichever half of the conversation id the caller is', async () => {
    // A DM's id is the two user ids sorted, so one of these two is the suffix.
    const a = await register(), b = await register()
    const t0 = Date.now() - 10 * MIN
    const conv = dmConvId(a.id, b.id)
    await put(conv, 'dm', a, 'a to b', t0 + 1000)
    await put(conv, 'dm', b, 'b to a', t0 + 2000)
    expect(contents(await missed(a, t0))).toEqual(['b to a'])
    expect(contents(await missed(b, t0))).toEqual(['a to b'])
  })

  it("excludes the caller's own messages and system messages", async () => {
    const a = await register(), b = await register()
    const t0 = Date.now() - 10 * MIN
    const conv = dmConvId(a.id, b.id)
    await put(conv, 'dm', a, 'mine', t0 + 1000)
    await put(conv, 'system', b, 'Call ended', t0 + 2000)
    await put(conv, 'dm', b, 'theirs', t0 + 3000)
    const group = await mkGroup(a, [b])
    await put(group.id, 'group', a, 'mine in the group', t0 + 1000)
    await put(group.id, 'system', b, 'b renamed the group', t0 + 2000)
    await put(group.id, 'group', b, 'theirs in the group', t0 + 3000)

    const res = await missed(a, t0)
    expect(contents(res)).toEqual(['theirs in the group', 'theirs'])
    expect(res.body.events.map((e: any) => e.type)).toEqual(['group', 'dm'])
    expect(res.body.events[0].conversationId).toBe(group.id)
  })

  it("never returns a DM or a group the caller isn't in", async () => {
    const a = await register(), b = await register(), c = await register()
    const t0 = Date.now() - 10 * MIN
    await put(dmConvId(b.id, c.id), 'dm', b, 'b to c', t0 + 1000)
    const group = await mkGroup(b, [c])
    await put(group.id, 'group', b, 'in a group without a', t0 + 1000)

    expect((await missed(a, t0)).body.events).toEqual([])
  })

  describe('channels', () => {
    it('returns a message mentioning the caller, and an @everyone, but not plain chatter at the default level', async () => {
      const { a, b, cid, sid } = await world()
      const t0 = Date.now() - 10 * MIN
      await put(cid, 'channel', b, 'just chatting', t0 + 1000)
      await put(cid, 'channel', b, `hey <@${a.username}> look`, t0 + 2000)
      await put(cid, 'channel', b, 'attention all', t0 + 3000, { mentionsEveryone: true })
      await put(cid, 'channel', b, 'more chatter', t0 + 4000)
      await put(cid, 'channel', b, `<@${a.username.toUpperCase()}> shouting`, t0 + 5000)

      const res = await missed(a, t0)
      expect(res.status).toBe(200)
      expect(contents(res)).toEqual([`<@${a.username.toUpperCase()}> shouting`, 'attention all', `hey <@${a.username}> look`])
      expect(res.body.events[1]).toMatchObject({
        type: 'channel', conversationId: cid, serverId: sid, categoryId: null,
        authorId: b.id, authorName: b.username, mentionsEveryone: true,
      })
      expect(res.body.events[2].mentionsEveryone).toBe(false)
    })

    it('matches a mention by display name as well as by username', async () => {
      const { a, b, cid } = await world()
      const t0 = Date.now() - 10 * MIN
      await app().patch('/users/me').set(auth(a)).send({ displayName: 'Ann (Ops)' })
      await put(cid, 'channel', b, 'ping <@ann (ops)>', t0 + 1000)
      await put(cid, 'channel', b, 'ping <@somebody else>', t0 + 2000)
      expect(contents(await missed(a, t0))).toEqual(['ping <@ann (ops)>'])
    })

    it('returns plain chatter in a channel whose level is all', async () => {
      const { a, b, cid } = await world()
      const t0 = Date.now() - 10 * MIN
      await put(cid, 'channel', b, 'just chatting', t0 + 1000)
      await put(cid, 'channel', a, 'my own words', t0 + 2000)
      expect((await missed(a, t0)).body.events).toEqual([])

      expect((await setPref(a, cid, { level: 'all' })).status).toBe(200)
      expect(contents(await missed(a, t0))).toEqual(['just chatting'])
    })

    it('reads the level down the chain: channel, then category, then server', async () => {
      const { a, b, sid, cid } = await world()
      const t0 = Date.now() - 10 * MIN
      const cat = await Category.create({ server: sid, name: 'Ops' })
      await Channel.updateOne({ _id: cid }, { $set: { category: cat._id } })
      await put(cid, 'channel', b, 'chatter', t0 + 1000)

      await setPref(a, sid, { level: 'all' })
      const viaServer = await missed(a, t0)
      expect(contents(viaServer)).toEqual(['chatter'])
      expect(viaServer.body.events[0].categoryId).toBe(cat.id)

      await setPref(a, cat.id, { level: 'mentions' })       // the category outranks the server
      expect(contents(await missed(a, t0))).toEqual([])

      await setPref(a, cid, { level: 'all' })               // the channel outranks the category
      expect(contents(await missed(a, t0))).toEqual(['chatter'])
    })

    it('still returns a muted channel, because the phone applies mutes itself', async () => {
      const { a, b, cid } = await world()
      const t0 = Date.now() - 10 * MIN
      await put(cid, 'channel', b, `<@${a.username}> hello`, t0 + 1000)
      await setPref(a, cid, { mute: 'forever' })
      expect(contents(await missed(a, t0))).toEqual([`<@${a.username}> hello`])
    })

    it("never returns messages from a channel the caller can't read", async () => {
      const { a, b, sid } = await world()
      const t0 = Date.now() - 10 * MIN
      const secret = (await app().post(`/servers/${sid}/channels`).set(auth(b)).send({ name: 'incidents', type: 'text' })).body.channel
      await Channel.updateOne({ _id: secret.id }, {
        $set: { overwrites: [{ id: await everyoneId(b, sid), type: 'role', allow: '0', deny: PERMISSIONS.ViewChannels.toString() }] },
      })
      await put(secret.id, 'channel', b, `<@${a.username}> the secret`, t0 + 1000)
      await put(secret.id, 'channel', b, 'everyone, the secret', t0 + 2000, { mentionsEveryone: true })
      await setPref(a, secret.id, { level: 'all' })

      expect((await missed(a, t0)).body.events).toEqual([])
      // The owner is not bound by the overwrite, so the filter is the overwrite and not the channel.
      await put(secret.id, 'channel', a, `<@${b.username}> reply`, t0 + 3000)
      expect(contents(await missed(b, t0))).toEqual([`<@${b.username}> reply`])
    })

    it("never returns messages from a channel a category overwrite hides from the caller's role", async () => {
      const { a, b, sid, cid } = await world()
      const c = await register()   // a member the overwrite does not apply to
      await Server.updateOne({ _id: sid }, { $push: { members: c.id } })
      const t0 = Date.now() - 10 * MIN

      // The channel has no overwrites of its own: whatever it can't be read by comes from its category.
      const cat = await Category.create({ server: sid, name: 'Staff only' })
      await Channel.updateOne({ _id: cid }, { $set: { category: cat._id } })
      const outsiders = await Role.create({ server: sid, name: 'Outsiders', position: 3 })
      await Server.updateOne({ _id: sid }, { $push: { memberRoles: { user: a.id, roles: [outsiders._id] } } })
      await setPref(a, cid, { level: 'all' })
      await setPref(c, cid, { level: 'all' })
      await put(cid, 'channel', b, `<@${a.username}> <@${c.username}> the secret`, t0 + 1000, { mentionsEveryone: true })

      // Before the overwrite both can read it, so the empty answer below is the overwrite and not the setup.
      expect(contents(await missed(a, t0))).toHaveLength(1)
      expect(contents(await missed(c, t0))).toHaveLength(1)

      await Category.updateOne({ _id: cat._id }, {
        $set: { overwrites: [{ id: outsiders._id, type: 'role', allow: '0', deny: PERMISSIONS.ViewChannels.toString() }] },
      })
      expect((await missed(a, t0)).body.events).toEqual([])
      expect(contents(await missed(c, t0))).toEqual([`<@${a.username}> <@${c.username}> the secret`])
    })

    it("never returns messages from a server the caller isn't in", async () => {
      const { a, b, sid, cid } = await world()
      const t0 = Date.now() - 10 * MIN
      await put(cid, 'channel', b, `<@${a.username}> hi`, t0 + 1000)
      await Server.updateOne({ _id: sid }, { $pull: { members: a.id } })
      expect((await missed(a, t0)).body.events).toEqual([])
    })
  })

  describe('bounds', () => {
    it('caps at 5 per conversation and 100 total, newest first', async () => {
      const a = await register(), b = await register()
      const t0 = Date.now() - 2 * HOUR
      const conv = dmConvId(a.id, b.id)
      for (let i = 0; i < 8; i++) await put(conv, 'dm', b, `dm ${i}`, t0 + i * 1000)
      const five = await missed(a, t0)
      expect(contents(five)).toEqual(['dm 7', 'dm 6', 'dm 5', 'dm 4', 'dm 3'])

      // 30 groups of 4 is 120 messages, newest across all of them, 100 kept.
      const groups = await Promise.all(Array.from({ length: 30 }, () => mkGroup(a, [b])))
      let n = 0
      for (let i = 0; i < 4; i++) {
        for (const g of groups) await put(g.id, 'group', b, `g ${n++}`, t0 + HOUR + n * 1000)
      }
      const res = await missed(a, t0)
      expect(res.body.events).toHaveLength(100)
      const times = res.body.events.map((e: any) => new Date(e.createdAt).getTime())
      expect(times).toEqual([...times].sort((x, y) => y - x))
      // The 20 oldest of the 120 are the ones dropped, and so is every DM.
      expect(res.body.events.every((e: any) => e.type === 'group')).toBe(true)
      expect(contents(res)[0]).toBe('g 119')
      expect(contents(res)[99]).toBe('g 20')
    })

    it('keeps the newest 100 when many busy conversations compete', async () => {
      const a = await register(), b = await register()
      const t0 = Date.now() - 2 * HOUR
      const groups = await Promise.all(Array.from({ length: 60 }, () => mkGroup(a, [b])))
      // Group k is older than group k + 1, and holds five messages of its own.
      for (const [k, g] of groups.entries()) {
        for (let j = 0; j < 5; j++) await put(g.id, 'group', b, `g${k}.${j}`, t0 + k * 10_000 + j * 1000)
      }
      const res = await missed(a, t0)
      const want = []
      for (let k = 59; k >= 40; k--) for (let j = 4; j >= 0; j--) want.push(`g${k}.${j}`)
      expect(contents(res)).toEqual(want)
    })

    it("is not crowded out by conversations that hold only the caller's own words", async () => {
      const a = await register(), b = await register()
      const t0 = Date.now() - 2 * HOUR
      const groups = await Promise.all(Array.from({ length: 120 }, () => mkGroup(a, [b])))
      // 110 newer groups where only `a` has spoken, 10 older ones with something for `a`.
      for (const [k, g] of groups.entries()) {
        if (k < 10) await put(g.id, 'group', b, `for a ${k}`, t0 + k * 1000)
        else await put(g.id, 'group', a, `by a ${k}`, t0 + HOUR + k * 1000)
      }
      const res = await missed(a, t0)
      expect(res.body.events).toHaveLength(10)
      expect(contents(res)[0]).toBe('for a 9')
    })

    it('clamps since to 24 hours', async () => {
      const a = await register(), b = await register()
      const conv = dmConvId(a.id, b.id)
      await put(conv, 'dm', b, 'thirty hours ago', Date.now() - 30 * HOUR)
      await put(conv, 'dm', b, 'twenty hours ago', Date.now() - 20 * HOUR)
      expect(contents(await missed(a, 0))).toEqual(['twenty hours ago'])
    })

    it('rejects a missing or invalid since with 400', async () => {
      const a = await register()
      for (const url of ['/users/me/missed', '/users/me/missed?since=', '/users/me/missed?since=yesterday', '/users/me/missed?since=-5']) {
        const res = await app().get(url).set(auth(a))
        expect(res.status, url).toBe(400)
        expect(res.body).toEqual({ message: 'since is required' })
      }
    })

    it("now is the server's clock", async () => {
      const a = await register()
      const before = Date.now()
      const res = await missed(a, before - MIN)
      expect(typeof res.body.now).toBe('number')
      expect(Math.abs(res.body.now - Date.now())).toBeLessThan(2000)
      expect(res.body.events).toEqual([])
    })

    it('requires auth', async () => {
      expect((await app().get('/users/me/missed?since=1')).status).toBe(401)
    })
  })
})
