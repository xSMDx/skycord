/**
 * Files leave with their message, and uploads nobody sent don't stay forever.
 *
 * Deleting a message (socket or REST) removes its files at once. Everything
 * else — a channel deleted with its history, a server removed, an upload the
 * composer abandoned — is caught by the hourly sweep, which is why the sweep
 * has to recognise both "never sent" and "sent, but the message is gone".
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, type TestUser,
} from './helpers'
import { Attachment } from '../models/Attachment'
import { Message } from '../models/Message'
import { Friendship } from '../models/Friendship'
import { sweepAttachments } from '../services/attachments'
import { BUCKET } from '../utils/attachmentStore'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []
beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const befriend = (a: TestUser, b: TestUser) => Friendship.create({ requester: a.id, receiver: b.id, status: 'accepted' })
const ack = <T = any>(s: ClientSocket, event: string, payload: any): Promise<T> =>
  new Promise(resolve => s.emit(event, payload, resolve))

const upload = async (u: TestUser, name = 'a.txt') =>
  (await app().post('/messages/attachments').set(auth(u)).set('X-Filename', name).send(Buffer.from('bytes'))).body.attachment
const sendDM = async (from: TestUser, to: TestUser, keys: string[], content = '') =>
  (await app().post(`/messages/dm/${to.id}`).set(auth(from)).send({ content, attachments: keys })).body.message
const gridFiles = () => mongoose.connection.db!.collection(`${BUCKET}.files`).countDocuments()

const HOUR = 60 * 60 * 1000

describe('deleting a message deletes its files', () => {
  it('over REST', async () => {
    const a = await register(), b = await register(); await befriend(a, b)
    const att = await upload(a)
    const msg = await sendDM(a, b, [att.key])
    expect(await gridFiles()).toBe(1)

    expect((await app().delete(`/messages/${msg._id}`).set(auth(a))).status).toBe(200)
    expect((await app().get(att.url)).status).toBe(404)
    expect(await Attachment.countDocuments()).toBe(0)
    expect(await gridFiles()).toBe(0)
  })

  it('over the socket', async () => {
    const a = await register(), b = await register(); await befriend(a, b)
    const s = await connectSocket(sockets.url, a.token); open.push(s)
    const att = await upload(a)
    const msg = await sendDM(a, b, [att.key])

    expect((await ack(s, 'message:delete', { messageId: msg._id })).ok).toBe(true)
    expect((await app().get(att.url)).status).toBe(404)
    expect(await gridFiles()).toBe(0)
  })
})

describe('the sweep', () => {
  it('removes an upload never sent after a day, and keeps a fresh one', async () => {
    const a = await register()
    const old = await upload(a, 'old.txt')
    await Attachment.collection.updateOne({ key: old.key }, { $set: { createdAt: new Date(Date.now() - 25 * HOUR) } })
    const fresh = await upload(a, 'fresh.txt')

    expect(await sweepAttachments()).toEqual({ unsent: 1, orphaned: 0 })
    expect((await app().get(old.url)).status).toBe(404)
    expect((await app().get(fresh.url)).status).toBe(200)
    expect(await gridFiles()).toBe(1)
  })

  it('removes files whose message is gone without going through delete', async () => {
    const a = await register(), b = await register(); await befriend(a, b)
    const att = await upload(a)
    await sendDM(a, b, [att.key])
    // What deleting a channel does: its messages go in one deleteMany.
    await Message.deleteMany({})

    expect(await sweepAttachments(Date.now() + 11 * 60_000)).toEqual({ unsent: 0, orphaned: 1 })
    expect((await app().get(att.url)).status).toBe(404)
    expect(await gridFiles()).toBe(0)
  })

  it('leaves sent files alone', async () => {
    const a = await register(), b = await register(); await befriend(a, b)
    const att = await upload(a)
    await sendDM(a, b, [att.key])
    await Attachment.collection.updateOne({ key: att.key }, { $set: { createdAt: new Date(Date.now() - 48 * HOUR) } })
    expect(await sweepAttachments(Date.now() + 2 * HOUR)).toEqual({ unsent: 0, orphaned: 0 })
    expect((await app().get(att.url)).status).toBe(200)
  })

  it('does not orphan a file claimed a moment ago whose message is still being saved', async () => {
    const a = await register()
    const att = await upload(a)
    await Attachment.updateOne({ key: att.key }, { $set: { messageId: new mongoose.Types.ObjectId(), conversationId: 'c', claimedAt: new Date() } })
    expect(await sweepAttachments()).toEqual({ unsent: 0, orphaned: 0 })
    expect((await app().get(att.url)).status).toBe(200)
  })
})

describe('the DM list', () => {
  it('summarises an attachments-only last message, and says null otherwise', async () => {
    const a = await register(), b = await register(), c = await register()
    await befriend(a, b); await befriend(a, c)
    const att = await upload(a, 'pic.png')
    await sendDM(a, b, [att.key])
    await sendDM(a, c, [], 'just words')

    const { dms } = (await app().get('/conversations/dms').set(auth(a))).body
    const withB = dms.find((d: any) => d.id === b.id)
    const withC = dms.find((d: any) => d.id === c.id)
    expect(withB.lastMessage).toBe('')
    expect(withB.lastAttachments).toEqual({ count: 1, kind: 'file', name: 'pic.png', mime: 'application/octet-stream' })
    expect(withC.lastAttachments).toBeNull()
  })
})
