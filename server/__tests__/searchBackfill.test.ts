import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import { app, connectDb, disconnectDb, resetDb, register, auth } from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'
import { backfillSearchFields } from '../utils/searchBackfill'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

/** A message as one written before search existed: no `has`, no `mentions`. */
const legacy = (conversationId: string, kind: string, authorId: string, content: string) => ({
  _id: new Types.ObjectId(), conversationId, kind, authorId: new Types.ObjectId(authorId),
  authorName: 'old', content, reactions: [], pinned: false, edited: false, replyToIds: [],
  createdAt: new Date(), updatedAt: new Date(),
})

describe('backfillSearchFields', () => {
  it('fills both fields on messages that predate them, and only once', async () => {
    const a = await register(), b = await register()
    const { server, channels } = (await app().post('/servers').set(auth(a)).send({ name: 'BF' })).body
    await Server.updateOne({ _id: server.id }, { $push: { members: b.id } })
    const cid = channels.find((c: any) => c.type === 'text').id
    const docs = [
      legacy(cid, 'channel', a.id, 'see https://x.io/a.gif'),
      legacy(cid, 'channel', a.id, `ping <@${b.username}>`),
      legacy(cid, 'system', a.id, 'https://x.io/b.png'),
    ]
    await Message.collection.insertMany(docs)

    expect(await backfillSearchFields(2)).toBe(3)
    const [gif, ping, sys] = await Promise.all(docs.map(d => Message.findById(d._id).lean()))
    expect(gif!.has).toEqual(['link', 'image'])
    expect(ping!.mentions.map(String)).toEqual([b.id])
    expect(sys!.has).toEqual([])

    expect(await backfillSearchFields()).toBe(0)
  })

  it('adds words to messages that already have the other fields', async () => {
    const a = await register()
    const doc = { ...legacy('x_y', 'dm', a.id, 'Seed #10 here'), has: [], mentions: [] }
    await Message.collection.insertOne(doc)
    expect(await backfillSearchFields()).toBe(1)
    const m = await Message.findById(doc._id).select('+words').lean()
    expect(m!.words).toEqual(['seed', '10', 'here'])
    expect(await backfillSearchFields()).toBe(0)
  })
})
