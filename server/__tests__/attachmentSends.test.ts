/**
 * Every way a message is sent can carry files: socket dm:send, dm:reply and
 * group:send; REST DM, group and channel. Each test sends an attachments-only
 * message down one path and checks the stored message and what the other
 * person receives. Then the rules: Attach files in channels, a failed send
 * gives its claims back, and a caption may be emptied only when files remain.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { Message } from '../models/Message'
import { Attachment } from '../models/Attachment'
import { Friendship } from '../models/Friendship'
import { Conversation } from '../models/Conversation'
import { Server } from '../models/Server'
import { PERMISSIONS, serializeBits } from '../permissions'
import { dmConvId } from '../controllers/messagesController'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }
const sock = async (u: TestUser) => track(await connectSocket(sockets.url, u.token))
const ack = <T = any>(s: ClientSocket, event: string, payload: any): Promise<T> =>
  new Promise(resolve => s.emit(event, payload, resolve))

const befriend = (a: TestUser, b: TestUser) => Friendship.create({ requester: a.id, receiver: b.id, status: 'accepted' })

const be32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), be32(13), Buffer.from('IHDR'), be32(2), be32(2), Buffer.alloc(5)])
const upload = async (u: TestUser, name = 'a.png'): Promise<string> => {
  const r = await app().post('/messages/attachments').set(auth(u))
    .set('Content-Type', 'image/png').set('X-Filename', name).send(png)
  if (r.status !== 201) throw new Error(`upload failed ${r.status}`)
  return r.body.attachment.key
}
const claimed = async (key: string) => (await Attachment.findOne({ key }).lean())?.messageId ?? null

const expectSent = (m: any, key: string) => {
  expect(m.content).toBe('')
  expect(m.attachments).toHaveLength(1)
  expect(m.attachments[0]).toMatchObject({ key, name: 'a.png', kind: 'image', mime: 'image/png', width: 2, height: 2 })
  expect(m.attachments[0].url).toBe(`/messages/attachments/${key}/a.png`)
}

const mkServer = async (u: TestUser) => (await app().post('/servers').set(auth(u)).send({ name: 'S' })).body
const textOf = (channels: any[]) => channels.find((c: any) => c.type === 'text')
const member = async (sid: string) => {
  const m = await register()
  await Server.updateOne({ _id: sid }, { $push: { members: m.id } })
  return m
}
const denyEveryone = async (owner: TestUser, sid: string, cid: string, bits: bigint) => {
  const everyone = (await app().get(`/servers/${sid}/roles`).set(auth(owner))).body.roles.find((r: any) => r.isEveryone)
  await app().patch(`/servers/${sid}/channels/${cid}`).set(auth(owner)).send({
    overwrites: [{ id: everyone.id, type: 'role', allow: '0', deny: serializeBits(bits) }],
  })
}

describe('each send path carries files', () => {
  it('socket dm:send', async () => {
    const a = await register(), b = await register(); await befriend(a, b)
    const [sa, sb] = [await sock(a), await sock(b)]
    const key = await upload(a)
    const got = nextEvent(sb, 'dm:receive')
    const r = await ack(sa, 'dm:send', { partnerId: b.id, content: '', attachments: [key] })
    expect(r.ok).toBe(true)
    expectSent(r.message, key)
    expectSent(await got, key)
    expect((await Message.findById(r.message._id).lean())?.attachments).toHaveLength(1)
  })

  it('socket dm:reply', async () => {
    const a = await register(), b = await register(); await befriend(a, b)
    const [sa, sb] = [await sock(a), await sock(b)]
    const parent = await Message.create({ conversationId: dmConvId(a.id, b.id), kind: 'dm', authorId: b.id, authorName: 'b', content: 'hi' })
    const key = await upload(a)
    const got = nextEvent(sb, 'dm:receive')
    const r = await ack(sa, 'dm:reply', { partnerId: b.id, content: '', replyToIds: [parent._id.toString()], attachments: [key] })
    expect(r.ok).toBe(true)
    expectSent(await got, key)
  })

  it('socket group:send', async () => {
    const a = await register(), b = await register()
    const g = await Conversation.create({ kind: 'group', members: [a.id, b.id], owner: a.id })
    const [sa, sb] = [await sock(a), await sock(b)]
    sb.emit('group:subscribe', { groupId: g._id.toString() })
    await new Promise(r => setTimeout(r, 150))
    const key = await upload(a)
    const got = nextEvent(sb, 'group:receive')
    const r = await ack(sa, 'group:send', { groupId: g._id.toString(), content: '', attachments: [key] })
    expect(r.ok).toBe(true)
    expectSent(r.message, key)
    expectSent(await got, key)
  })

  it('REST DM', async () => {
    const a = await register(), b = await register(); await befriend(a, b)
    const key = await upload(a)
    const r = await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: '', attachments: [key] })
    expect(r.status).toBe(201)
    expectSent(r.body.message, key)
    const hist = await app().get(`/messages/dm/${a.id}`).set(auth(b))
    expectSent(hist.body.messages.at(-1), key)
  })

  it('REST group', async () => {
    const a = await register(), b = await register()
    const g = await Conversation.create({ kind: 'group', members: [a.id, b.id], owner: a.id })
    const key = await upload(a)
    const r = await app().post(`/conversations/groups/${g._id}/messages`).set(auth(a)).send({ content: '', attachments: [key] })
    expect(r.status).toBe(201)
    expectSent(r.body.message, key)
    const hist = await app().get(`/conversations/groups/${g._id}/messages`).set(auth(b))
    expectSent(hist.body.messages.at(-1), key)
  })

  it('REST channel', async () => {
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const c = textOf(channels)
    const m = await member(server._id ?? server.id)
    const key = await upload(m)
    const r = await app().post(`/servers/${server._id ?? server.id}/channels/${c._id ?? c.id}/messages`).set(auth(m)).send({ content: '', attachments: [key] })
    expect(r.status).toBe(201)
    expectSent(r.body.message, key)
    const hist = await app().get(`/servers/${server._id ?? server.id}/channels/${c._id ?? c.id}/messages`).set(auth(owner))
    expectSent(hist.body.messages.at(-1), key)
  })
})

describe('the rules', () => {
  it('refuses an empty send with no attachments, on every path', async () => {
    const a = await register(), b = await register(); await befriend(a, b)
    const g = await Conversation.create({ kind: 'group', members: [a.id, b.id], owner: a.id })
    const sa = await sock(a)
    expect((await ack(sa, 'dm:send', { partnerId: b.id, content: '  ' })).ok).toBe(false)
    expect((await ack(sa, 'dm:reply', { partnerId: b.id, content: '', replyToIds: [] })).ok).toBe(false)
    expect((await ack(sa, 'group:send', { groupId: g._id.toString(), content: '' })).ok).toBe(false)
    expect((await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: '' })).status).toBe(400)
    expect((await app().post(`/conversations/groups/${g._id}/messages`).set(auth(a)).send({ content: '' })).status).toBe(400)
    expect(await Message.countDocuments()).toBe(0)
  })

  it('refuses attachments in a channel without Attach files, before claiming', async () => {
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const sid = server._id ?? server.id, cid = textOf(channels)._id ?? textOf(channels).id
    const m = await member(sid)
    await denyEveryone(owner, sid, cid, PERMISSIONS.AttachFiles)
    const key = await upload(m)
    const r = await app().post(`/servers/${sid}/channels/${cid}/messages`).set(auth(m)).send({ content: 'look', attachments: [key] })
    expect(r.status).toBe(403)
    expect(r.body.message).toBe('You can’t attach files in this channel.')
    expect(await claimed(key)).toBeNull()
    // Text alone still goes through.
    expect((await app().post(`/servers/${sid}/channels/${cid}/messages`).set(auth(m)).send({ content: 'look' })).status).toBe(201)
  })

  it('lets the owner attach whatever the role says', async () => {
    const owner = await register()
    const { server, channels } = await mkServer(owner)
    const sid = server._id ?? server.id, cid = textOf(channels)._id ?? textOf(channels).id
    await denyEveryone(owner, sid, cid, PERMISSIONS.AttachFiles)
    const key = await upload(owner)
    expect((await app().post(`/servers/${sid}/channels/${cid}/messages`).set(auth(owner)).send({ content: '', attachments: [key] })).status).toBe(201)
  })

  it('refuses another person\'s key, and a key already sent', async () => {
    const a = await register(), b = await register(); await befriend(a, b)
    const theirs = await upload(b)
    expect((await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'x', attachments: [theirs] })).status).toBe(409)
    const mine = await upload(a)
    expect((await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'x', attachments: [mine] })).status).toBe(201)
    expect((await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'again', attachments: [mine] })).status).toBe(409)
  })

  it('releases the claim when the send fails after claiming', async () => {
    const a = await register(), b = await register(); await befriend(a, b)
    const key = await upload(a)
    const spy = vi.spyOn(Message, 'create').mockRejectedValueOnce(new Error('disk full') as never)
    const r = await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: '', attachments: [key] })
    spy.mockRestore()
    expect(r.status).toBe(500)
    expect(await claimed(key)).toBeNull()
  })

  it('lets a caption be edited to nothing when the message has files, and not otherwise', async () => {
    const a = await register(), b = await register(); await befriend(a, b)
    const key = await upload(a)
    const withFile = (await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'caption', attachments: [key] })).body.message
    const plain = (await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'words' })).body.message

    expect((await app().patch(`/messages/${withFile._id}`).set(auth(a)).send({ content: '' })).status).toBe(200)
    expect((await Message.findById(withFile._id).lean())?.content).toBe('')
    expect((await app().patch(`/messages/${plain._id}`).set(auth(a)).send({ content: '' })).status).toBe(400)

    const sa = await sock(a)
    const key2 = await upload(a)
    const second = (await app().post(`/messages/dm/${b.id}`).set(auth(a)).send({ content: 'cap', attachments: [key2] })).body.message
    expect((await ack(sa, 'message:edit', { messageId: second._id, content: '' })).ok).toBe(true)
    expect((await ack(sa, 'message:edit', { messageId: plain._id, content: '' })).ok).toBe(false)
  })
})
