import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import { app, connectDb, disconnectDb, resetDb, register, auth, type TestUser } from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'
import { searchWords } from '../utils/searchWords'
import { Role } from '../models/Role'
import { Conversation } from '../models/Conversation'
import { Friendship } from '../models/Friendship'
import { PERMISSIONS } from '../permissions'

// $text needs the index built before the first query.
beforeAll(async () => { await connectDb(); await Message.init() })
afterAll(disconnectDb)
beforeEach(resetDb)

const mkServer = async (u: TestUser) => (await app().post('/servers').set(auth(u)).send({ name: 'SR' })).body
const textOf = (channels: any[]) => channels.find((c: any) => c.type === 'text')
const say = (u: TestUser, sid: string, cid: string, content: string) =>
  app().post(`/servers/${sid}/channels/${cid}/messages`).set(auth(u)).send({ content })
const mkText = async (u: TestUser, sid: string, name: string) =>
  (await app().post(`/servers/${sid}/channels`).set(auth(u)).send({ name, type: 'text' })).body.channel
const search = (u: TestUser, sid: string, qs: string) => app().get(`/servers/${sid}/search?${qs}`).set(auth(u))
const texts = (res: any) => res.body.results.map((m: any) => m.content)
const everyoneId = async (u: TestUser, sid: string) => {
  await app().get(`/servers/${sid}/roles`).set(auth(u))
  return (await Role.findOne({ server: sid, isEveryone: true }))!._id.toString()
}
const deny = async (owner: TestUser, sid: string, cid: string, bits: bigint) =>
  app().patch(`/servers/${sid}/channels/${cid}`).set(auth(owner)).send({
    overwrites: [{ id: await everyoneId(owner, sid), type: 'role', allow: '0', deny: bits.toString() }],
  })

/** A server where `a` owns it and `b` is a plain member, with one text channel. */
const world = async () => {
  const a = await register(), b = await register()
  const { server, channels } = await mkServer(a)
  await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
  return { a, b, sid: server.id as string, cid: textOf(channels).id as string }
}

describe('server search: words', () => {
  it('finds a message by a word, newest first, with its channel', async () => {
    const { a, sid, cid } = await world()
    await say(a, sid, cid, 'the release plan')
    await say(a, sid, cid, 'nothing to see')
    await say(a, sid, cid, 'new plan agreed')
    const res = await search(a, sid, 'q=plan')
    expect(res.status).toBe(200)
    expect(texts(res)).toEqual(['new plan agreed', 'the release plan'])
    expect(res.body.results[0].channelId).toBe(cid)
    expect(res.body.total).toBe(2)
  })

  it('requires every word', async () => {
    const { a, sid, cid } = await world()
    await say(a, sid, cid, 'release plan')
    await say(a, sid, cid, 'release party')
    expect(texts(await search(a, sid, 'q=release%20plan'))).toEqual(['release plan'])
  })

  it('keeps a quoted phrase together and leaves out an excluded word', async () => {
    const { a, sid, cid } = await world()
    await say(a, sid, cid, 'plan the release')
    await say(a, sid, cid, 'release the plan')
    await say(a, sid, cid, 'release the plan tomorrow')
    expect(texts(await search(a, sid, `q=${encodeURIComponent('"the plan" -tomorrow')}`))).toEqual(['release the plan'])
  })

  it('ignores case and accents', async () => {
    const { a, sid, cid } = await world()
    await say(a, sid, cid, 'Café meeting')
    expect(texts(await search(a, sid, 'q=cafe'))).toEqual(['Café meeting'])
  })

  it('refuses an empty search, and one that only excludes', async () => {
    const { a, sid } = await world()
    expect((await search(a, sid, 'q=')).status).toBe(400)
    expect((await search(a, sid, 'q=-noise')).status).toBe(400)
  })

  it('matches a word only where it stands whole', async () => {
    const { a, sid, cid } = await world()
    await say(a, sid, cid, 'history seed #10')
    await say(a, sid, cid, 'history seed #110')
    await say(a, sid, cid, 'history seed 100')
    expect(texts(await search(a, sid, 'q=seed%2010'))).toEqual(['history seed #10'])
  })

  it('matches a phrase only where its words stand whole', async () => {
    // A phrase on its own was already safe: the text index only offers
    // messages that contain its words. With another word beside it, that word
    // alone makes "release breathe planet" a candidate, and the phrase check
    // then finds "the plan" inside "breathe planet".
    const { a, sid, cid } = await world()
    await say(a, sid, cid, 'release breathe planet')
    await say(a, sid, cid, 'release the plan')
    expect(texts(await search(a, sid, `q=${encodeURIComponent('release "the plan"')}`))).toEqual(['release the plan'])
  })

  it('leaves out only the whole excluded word', async () => {
    const { a, sid, cid } = await world()
    await say(a, sid, cid, 'plan for tomorrow')
    await say(a, sid, cid, 'plan for tomorrows')
    expect(texts(await search(a, sid, `q=${encodeURIComponent('plan -tomorrow')}`))).toEqual(['plan for tomorrows'])
  })

  it('reads a word as the text index does: accents either way, an underscore inside it', async () => {
    const { a, sid, cid } = await world()
    await say(a, sid, cid, 'Cafe meeting')
    await say(a, sid, cid, 'ping arta_')
    expect(texts(await search(a, sid, `q=${encodeURIComponent('café')}`))).toEqual(['Cafe meeting'])
    expect(texts(await search(a, sid, 'q=arta_'))).toEqual(['ping arta_'])
    expect(texts(await search(a, sid, 'q=arta'))).toEqual([])
  })
})

describe('server search: who may find what', () => {
  it('never returns a private channel to a member who cannot see it', async () => {
    const { a, b, sid } = await world()
    const secret = await mkText(a, sid, 'secret')
    await say(a, sid, secret.id, 'hidden plan')
    await deny(a, sid, secret.id, PERMISSIONS.ViewChannels)
    expect(texts(await search(b, sid, 'q=plan'))).toEqual([])
    expect(texts(await search(a, sid, 'q=plan'))).toEqual(['hidden plan'])
  })

  it('never returns a channel whose history the member may not read', async () => {
    const { a, b, sid, cid } = await world()
    await say(a, sid, cid, 'old plan')
    await deny(a, sid, cid, PERMISSIONS.ReadMessageHistory)
    expect(texts(await search(b, sid, 'q=plan'))).toEqual([])
  })

  it('narrows with in:, and answers nothing — not an error — for a channel you cannot read', async () => {
    const { a, b, sid, cid } = await world()
    const other = await mkText(a, sid, 'other')
    await say(a, sid, cid, 'plan here')
    await say(a, sid, other.id, 'plan there')
    expect(texts(await search(a, sid, `q=plan&in=${other.id}`))).toEqual(['plan there'])
    await deny(a, sid, other.id, PERMISSIONS.ViewChannels)
    const res = await search(b, sid, `q=plan&in=${other.id}`)
    expect(res.status).toBe(200)
    expect(texts(res)).toEqual([])
  })

  it('refuses someone who is not a member of the server', async () => {
    const { sid } = await world()
    const stranger = await register()
    expect((await search(stranger, sid, 'q=plan')).status).toBe(403)
  })

  it('never returns a system message', async () => {
    const { a, sid, cid } = await world()
    await Message.create({ conversationId: cid, kind: 'system', authorId: a.id, authorName: 'sys', content: 'plan system', systemType: 'call' })
    expect(texts(await search(a, sid, 'q=plan'))).toEqual([])
  })
})

describe('server search: filters', () => {
  it('filters by author, any of several', async () => {
    const { a, b, sid, cid } = await world()
    const c = await register()
    await Server.updateOne({ _id: sid }, { $push: { members: c.id } })
    await say(a, sid, cid, 'plan from a')
    await say(b, sid, cid, 'plan from b')
    await say(c, sid, cid, 'plan from c')
    expect(texts(await search(a, sid, `q=plan&from=${a.id},${b.id}`))).toEqual(['plan from b', 'plan from a'])
  })

  it('filters by mention and by content type, and ANDs different filters', async () => {
    const { a, b, sid, cid } = await world()
    await say(a, sid, cid, `look <@${b.username}> https://x.io/a.png`)
    await say(a, sid, cid, `look <@${b.username}>`)
    await say(a, sid, cid, 'look https://x.io/b.png')
    expect(texts(await search(a, sid, `mentions=${b.id}`))).toHaveLength(2)
    expect(texts(await search(a, sid, 'has=image'))).toHaveLength(2)
    expect(texts(await search(a, sid, `mentions=${b.id}&has=image`))).toEqual([`look <@${b.username}> https://x.io/a.png`])
  })

  it('filters by pinned', async () => {
    const { a, sid, cid } = await world()
    const pinned = await say(a, sid, cid, 'keep this plan')
    await say(a, sid, cid, 'loose plan')
    await Message.updateOne({ _id: pinned.body.message._id }, { $set: { pinned: true } })
    expect(texts(await search(a, sid, 'q=plan&pinned=true'))).toEqual(['keep this plan'])
    expect(texts(await search(a, sid, 'q=plan&pinned=false'))).toEqual(['loose plan'])
  })

  it('filters by date: after inclusive, before exclusive', async () => {
    const { a, sid, cid } = await world()
    const old = await say(a, sid, cid, 'plan old')
    await say(a, sid, cid, 'plan new')
    // Through the raw collection: Mongoose treats `createdAt` as immutable and
    // silently drops it from an update, so the model's updateOne moves nothing.
    await Message.collection.updateOne(
      { _id: new Types.ObjectId(old.body.message._id) },
      { $set: { createdAt: new Date('2026-01-01T12:00:00Z') } },
    )
    expect(texts(await search(a, sid, 'q=plan&before=2026-06-01T00:00:00.000Z'))).toEqual(['plan old'])
    expect(texts(await search(a, sid, 'q=plan&after=2026-06-01T00:00:00.000Z'))).toEqual(['plan new'])
    expect(texts(await search(a, sid, 'q=plan&after=2026-01-01T12:00:00.000Z&before=2026-01-01T12:00:00.001Z'))).toEqual(['plan old'])
  })

  it('searches with filters and no words at all', async () => {
    const { a, b, sid, cid } = await world()
    await say(b, sid, cid, 'anything')
    expect(texts(await search(a, sid, `from=${b.id}`))).toEqual(['anything'])
  })
})

describe('server search: order and paging', () => {
  it('ranks by relevance when asked, and newest first otherwise', async () => {
    // Same length, so only how often the word appears separates them; the
    // weaker match is the NEWER one, so newest-first puts it on top and only
    // a real relevance sort can reverse that.
    const { a, sid, cid } = await world()
    await say(a, sid, cid, 'plan plan plan plan')
    await say(a, sid, cid, 'plan roadmap release schedule')
    expect(texts(await search(a, sid, 'q=plan'))[0]).toBe('plan roadmap release schedule')
    expect(texts(await search(a, sid, 'q=plan&sort=relevant'))[0]).toBe('plan plan plan plan')
  })

  it('pages 25 at a time and says whether there is more', async () => {
    const { a, sid, cid } = await world()
    const docs = Array.from({ length: 30 }, (_, i) => ({
      conversationId: cid, kind: 'channel', authorId: new Types.ObjectId(a.id), authorName: 'x',
      // Inserted raw, past the hook, so the derived fields are written here.
      content: `needle ${i}`, has: [], mentions: [], words: searchWords(`needle ${i}`), reactions: [], replyToIds: [],
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)), updatedAt: new Date(),
    }))
    await Message.collection.insertMany(docs)
    const first = await search(a, sid, 'q=needle')
    expect(first.body.results).toHaveLength(25)
    expect(first.body.hasMore).toBe(true)
    const second = await search(a, sid, 'q=needle&page=2')
    expect(second.body.results).toHaveLength(5)
    expect(second.body.hasMore).toBe(false)
    expect(first.body.total).toBe(30)
  })

  it('caps the total at 1,000', async () => {
    const { a, sid, cid } = await world()
    const docs = Array.from({ length: 1005 }, (_, i) => ({
      conversationId: cid, kind: 'channel', authorId: new Types.ObjectId(a.id), authorName: 'x',
      content: `haystack ${i}`, has: [], mentions: [], words: searchWords(`haystack ${i}`), reactions: [], replyToIds: [],
      createdAt: new Date(), updatedAt: new Date(),
    }))
    await Message.collection.insertMany(docs)
    expect((await search(a, sid, 'q=haystack')).body.total).toBe(1000)
  })
})

describe('group and DM search', () => {
  it('searches a group for its members only', async () => {
    const a = await register(), b = await register(), c = await register()
    const g = await Conversation.create({ type: 'group', owner: a.id, members: [a.id, b.id], lastMessageAt: new Date() })
    await app().post(`/conversations/groups/${g._id}/messages`).set(auth(a)).send({ content: 'group plan' })
    const res = await app().get(`/conversations/groups/${g._id}/search?q=plan`).set(auth(b))
    expect(texts(res)).toEqual(['group plan'])
    expect(res.body.results[0].channelId).toBeUndefined()
    expect((await app().get(`/conversations/groups/${g._id}/search?q=plan`).set(auth(c))).status).toBe(403)
  })

  it('searches a DM between exactly its two people', async () => {
    const a = await register(), b = await register(), c = await register()
    await Friendship.create({ requester: a.id, receiver: b.id, status: 'accepted' })
    await Friendship.create({ requester: a.id, receiver: c.id, status: 'accepted' })
    await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'dm plan with b' })
    await app().post(`/messages/dm/${c.id}`).set(auth(a)).send({ content: 'dm plan with c' })
    expect(texts(await app().get(`/messages/dm/${a.id}/search?q=plan`).set(auth(b)))).toEqual(['dm plan with b'])
  })
})
