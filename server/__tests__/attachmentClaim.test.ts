/**
 * Claiming: how an uploaded file becomes part of exactly one message.
 *
 * Mongo here is a standalone 4.4 — no transactions — so the claim is one
 * conditional updateMany, and these tests are what stand in for the
 * guarantee a transaction would have given: a key lands on one message,
 * never two, and a refused batch leaves nothing half-claimed.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import { connectDb, disconnectDb, resetDb } from './helpers'
import { Attachment } from '../models/Attachment'
import { Message } from '../models/Message'
import { claimAttachments, summarize } from '../services/attachments'
import { resolveMessages } from '../controllers/messagesController'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

let n = 0
const makeAttachment = async (ownerId: string, kind: 'image' | 'video' | 'file' = 'image', name = `f${n}.png`) => {
  const doc = await Attachment.create({
    key: `k${String(n++).padStart(21, '0')}`, ownerId, name, size: 10,
    mime: kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'application/octet-stream',
    kind, width: kind === 'image' ? 4 : null, height: kind === 'image' ? 3 : null,
    store: { kind: 'gridfs', id: new Types.ObjectId() },
  })
  return doc.key
}

const me = new Types.ObjectId().toString()
const them = new Types.ObjectId().toString()

describe('claimAttachments', () => {
  it('claims your own unsent uploads, in the order given', async () => {
    const a = await makeAttachment(me, 'image', 'a.png')
    const b = await makeAttachment(me, 'file', 'b.pdf')
    const messageId = new Types.ObjectId()
    const r = await claimAttachments([b, a], me, messageId, 'conv-1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.attachments.map(x => x.name)).toEqual(['b.pdf', 'a.png'])
    expect(r.attachments[1]).toEqual({ key: a, name: 'a.png', size: 10, mime: 'image/png', kind: 'image', width: 4, height: 3 })
    const docs = await Attachment.find({ key: { $in: [a, b] } }).lean()
    for (const d of docs) {
      expect(d.messageId?.toString()).toBe(messageId.toString())
      expect(d.conversationId).toBe('conv-1')
    }
  })

  it('a key cannot be claimed twice', async () => {
    const k = await makeAttachment(me)
    const first = await claimAttachments([k], me, new Types.ObjectId(), 'c1')
    const second = await claimAttachments([k], me, new Types.ObjectId(), 'c1')
    expect(first.ok).toBe(true)
    expect(second).toEqual({ ok: false, status: 409, message: 'An attachment is missing or was already sent.' })
  })

  it('two sends racing for one key: exactly one wins', async () => {
    const k = await makeAttachment(me)
    const results = await Promise.all([
      claimAttachments([k], me, new Types.ObjectId(), 'c1'),
      claimAttachments([k], me, new Types.ObjectId(), 'c1'),
    ])
    expect(results.filter(r => r.ok)).toHaveLength(1)
  })

  it('refuses someone else\'s key and releases the rest of the batch', async () => {
    const mine = await makeAttachment(me)
    const theirs = await makeAttachment(them)
    const r = await claimAttachments([mine, theirs], me, new Types.ObjectId(), 'c1')
    expect(r).toEqual({ ok: false, status: 409, message: 'An attachment is missing or was already sent.' })
    expect((await Attachment.findOne({ key: mine }).lean())?.messageId).toBeNull()
    expect((await Attachment.findOne({ key: theirs }).lean())?.messageId).toBeNull()
  })

  it('refuses a key that does not exist', async () => {
    const r = await claimAttachments(['nope'], me, new Types.ObjectId(), 'c1')
    expect(r.ok).toBe(false)
  })

  it('refuses more than 10 distinct keys', async () => {
    const keys = await Promise.all(Array.from({ length: 11 }, () => makeAttachment(me)))
    const r = await claimAttachments(keys, me, new Types.ObjectId(), 'c1')
    expect(r).toEqual({ ok: false, status: 400, message: 'A message can carry at most 10 files.' })
    expect(await Attachment.countDocuments({ messageId: { $ne: null } })).toBe(0)
  })

  it('counts a repeated key once', async () => {
    const k = await makeAttachment(me)
    const r = await claimAttachments([k, k], me, new Types.ObjectId(), 'c1')
    expect(r.ok && r.attachments.length).toBe(1)
  })

  it('treats a non-array, or junk inside one, as no attachments', async () => {
    expect(await claimAttachments(undefined, me, new Types.ObjectId(), 'c1')).toEqual({ ok: true, attachments: [] })
    expect(await claimAttachments('k', me, new Types.ObjectId(), 'c1')).toEqual({ ok: true, attachments: [] })
    expect(await claimAttachments([], me, new Types.ObjectId(), 'c1')).toEqual({ ok: true, attachments: [] })
    expect((await claimAttachments([{ $ne: null }], me, new Types.ObjectId(), 'c1')).ok).toBe(false)
  })
})

describe('a message and its files', () => {
  const base = { conversationId: 'c1', kind: 'dm' as const, authorId: me, authorName: 'me' }
  const file = { key: 'k', name: 'a.pdf', size: 1, mime: 'application/octet-stream', kind: 'file' as const, width: null, height: null }

  it('rejects a message with no text and no attachments', async () => {
    await expect(Message.create({ ...base, content: '   ' })).rejects.toThrow()
    await expect(Message.create({ ...base, content: '' })).rejects.toThrow()
  })

  it('accepts a message with attachments and no text', async () => {
    const m = await Message.create({ ...base, content: '', attachments: [file] })
    expect(m.attachments).toHaveLength(1)
    expect(m.has).toEqual(['file'])
  })

  it('still caps the text at 4000', async () => {
    await expect(Message.create({ ...base, content: 'x'.repeat(4001), attachments: [file] })).rejects.toThrow()
  })
})

describe('summaries for previews', () => {
  const img = { key: 'a', name: 'a.jpg', size: 1, mime: 'image/jpeg', kind: 'image' as const, width: 1, height: 1 }
  const pdf = { key: 'b', name: 'b.pdf', size: 1, mime: 'application/octet-stream', kind: 'file' as const, width: null, height: null }

  it('names the kind when every file shares it, and calls a mix files', () => {
    expect(summarize([])).toBeNull()
    expect(summarize(undefined)).toBeNull()
    expect(summarize([img, img])).toEqual({ count: 2, kind: 'image', name: 'a.jpg', mime: 'image/jpeg' })
    expect(summarize([img, pdf])).toEqual({ count: 2, kind: 'file', name: 'a.jpg', mime: 'image/jpeg' })
  })

  it('summarises a reply parent that has only attachments', async () => {
    const parent = await Message.create({ conversationId: 'c1', kind: 'dm', authorId: me, authorName: 'me', content: '', attachments: [img, img] })
    const reply = await Message.create({ conversationId: 'c1', kind: 'dm', authorId: me, authorName: 'me', content: 'nice', replyToIds: [parent._id] })
    const [resolved] = await resolveMessages([reply.toObject()], 'c1')
    expect(resolved.replyTo[0]).toMatchObject({ id: parent._id.toString(), content: '', attachments: { count: 2, kind: 'image', name: 'a.jpg', mime: 'image/jpeg' } })
  })

  it('leaves the summary off a parent with no files', async () => {
    const parent = await Message.create({ conversationId: 'c1', kind: 'dm', authorId: me, authorName: 'me', content: 'hello' })
    const reply = await Message.create({ conversationId: 'c1', kind: 'dm', authorId: me, authorName: 'me', content: 'hi', replyToIds: [parent._id] })
    const [resolved] = await resolveMessages([reply.toObject()], 'c1')
    expect(resolved.replyTo[0]).toEqual({ id: parent._id.toString(), author: 'me', content: 'hello' })
  })
})
