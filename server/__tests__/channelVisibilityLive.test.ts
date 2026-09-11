import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, nextEvent, type TestUser,
} from './helpers'
import { Server } from '../models/Server'
import { Role } from '../models/Role'
import { PERMISSIONS } from '../permissions'

/**
 * Private channels on the live wire.
 *
 * GET /servers/:sid has filtered the sidebar since overwrites landed, but the
 * socket layer never learned the rule: every member's sockets joined every
 * channel room at connect, so a message posted in a private channel was pushed
 * to everyone in the server, and every channel event carried the full channel
 * to people the REST read would never have shown it to. These pin the wire to
 * the same answer that read gives.
 */

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const connect = async (u: TestUser) => {
  const s = await connectSocket(sockets.url, u.token)
  open.push(s)
  return s
}

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'PV' })).body
const joinAsMember = (sid: string, uid: string) =>
  Server.updateOne({ _id: sid }, { $push: { members: uid } })
const everyoneId = async (u: TestUser, sid: string) => {
  await app().get(`/servers/${sid}/roles`).set(auth(u))
  return (await Role.findOne({ server: sid, isEveryone: true }))!._id.toString()
}
const mkText = async (u: TestUser, sid: string, name: string, category: string | null = null) =>
  (await app().post(`/servers/${sid}/channels`).set(auth(u))
    .send({ name, type: 'text', category })).body.channel
const mkCategory = async (u: TestUser, sid: string, name: string) =>
  (await app().post(`/servers/${sid}/categories`).set(auth(u)).send({ name })).body.category

const VIEW = PERMISSIONS.ViewChannels.toString()

/** Deny View to @everyone, and let `allow` back in. */
const lockOverwrites = async (u: TestUser, sid: string, allow: { id: string; type: 'role' | 'member' }[] = []) => [
  { id: await everyoneId(u, sid), type: 'role', allow: '0', deny: VIEW },
  ...allow.map(a => ({ ...a, allow: VIEW, deny: '0' })),
]
const lockChannel = async (u: TestUser, sid: string, cid: string, allow: { id: string; type: 'role' | 'member' }[] = []) => {
  const res = await app().patch(`/servers/${sid}/channels/${cid}`).set(auth(u))
    .send({ overwrites: await lockOverwrites(u, sid, allow) })
  expect(res.status).toBe(200)
}
const lockCategory = async (u: TestUser, sid: string, cid: string) => {
  const res = await app().patch(`/servers/${sid}/categories/${cid}`).set(auth(u))
    .send({ overwrites: await lockOverwrites(u, sid) })
  expect(res.status).toBe(200)
}

const post = (u: TestUser, sid: string, cid: string, content: string) =>
  app().post(`/servers/${sid}/channels/${cid}/messages`).set(auth(u)).send({ content })

/**
 * Whether a matching `name` arrives within the window. For asserting ABSENCE,
 * which `nextEvent` cannot do — it only knows how to wait for something.
 */
const arrives = (s: ClientSocket, name: string, match: (p: any) => boolean = () => true, ms = 400) =>
  new Promise<boolean>(resolve => {
    const on = (p: any) => {
      if (!match(p)) return
      s.off(name, on); clearTimeout(t); resolve(true)
    }
    const t = setTimeout(() => { s.off(name, on); resolve(false) }, ms)
    s.on(name, on)
  })

const textOf = (channels: any[]) => channels.find((c: any) => c.type === 'text')

describe('messages in a private channel', () => {
  it('are not pushed to a member who cannot see the channel', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const secret = await mkText(a, server.id, 'secret')
    await lockChannel(a, server.id, secret.id)

    const bSock = await connect(b)
    const saw = arrives(bSock, 'channel:receive', p => p.conversationId === secret.id)
    await post(a, server.id, secret.id, 'hush')
    expect(await saw).toBe(false)

    // The control: the same member still hears the channels they can see, so
    // the absence above is the rule and not a dead socket.
    const heard = nextEvent(bSock, 'channel:receive')
    await post(a, server.id, textOf(channels).id, 'hello')
    expect((await heard).content).toBe('hello')
  })

  it('are pushed to a member the channel lets in', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const secret = await mkText(a, server.id, 'secret')
    await lockChannel(a, server.id, secret.id, [{ id: b.id, type: 'member' }])

    const bSock = await connect(b)
    const heard = nextEvent(bSock, 'channel:receive')
    await post(a, server.id, secret.id, 'for you')
    expect((await heard).content).toBe('for you')
  })

  it('stop reaching a connected member the moment the channel is made private', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const secret = await mkText(a, server.id, 'secret')

    const bSock = await connect(b)
    await lockChannel(a, server.id, secret.id)

    const saw = arrives(bSock, 'channel:receive', p => p.conversationId === secret.id)
    await post(a, server.id, secret.id, 'too late')
    expect(await saw).toBe(false)
  })

  it('start reaching a connected member once they are given a role that lets them in', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const role = await Role.create({ server: server.id, name: 'insiders', position: 1, permissions: '0' })
    const secret = await mkText(a, server.id, 'secret')
    await lockChannel(a, server.id, secret.id, [{ id: role._id.toString(), type: 'role' }])

    const bSock = await connect(b)
    const assigned = await app().put(`/servers/${server.id}/members/${b.id}/roles`).set(auth(a))
      .send({ roles: [role._id.toString()] })
    expect(assigned.status).toBe(200)

    const heard = nextEvent(bSock, 'channel:receive')
    await post(a, server.id, secret.id, 'welcome in')
    expect((await heard).content).toBe('welcome in')
  })

  it('are not pushed to someone who joined by invite while connected', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    const secret = await mkText(a, server.id, 'secret')
    await lockChannel(a, server.id, secret.id)
    const inv = (await app().post(`/servers/${server.id}/invites`).set(auth(a)).send({ expiry: '24h' })).body.invite

    // Connected BEFORE joining: the join itself has to put the sockets in the
    // right rooms, because connect-time setup ran before the membership existed.
    const bSock = await connect(b)
    expect((await app().post(`/invites/${inv.code}`).set(auth(b))).status).toBe(200)

    const saw = arrives(bSock, 'channel:receive', p => p.conversationId === secret.id)
    await post(a, server.id, secret.id, 'hush')
    expect(await saw).toBe(false)

    const heard = nextEvent(bSock, 'channel:receive')
    await post(a, server.id, textOf(channels).id, 'hello')
    expect((await heard).content).toBe('hello')
  })
})

describe('channel events', () => {
  it('tell a member whose access just changed to refetch the server', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const secret = await mkText(a, server.id, 'secret')

    const bSock = await connect(b)
    const told = nextEvent(bSock, 'server:accessChanged')
    await lockChannel(a, server.id, secret.id)
    expect((await told).serverId).toBe(server.id)
  })

  it('do not announce a private channel’s rename to a member who cannot see it', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const secret = await mkText(a, server.id, 'secret')
    await lockChannel(a, server.id, secret.id)

    const bSock = await connect(b)
    const saw = arrives(bSock, 'channel:updated', p => p.channel?.id === secret.id)
    await app().patch(`/servers/${server.id}/channels/${secret.id}`).set(auth(a)).send({ name: 'renamed' })
    expect(await saw).toBe(false)
  })

  it('still announce it to the owner', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const secret = await mkText(a, server.id, 'secret')
    await lockChannel(a, server.id, secret.id)

    const aSock = await connect(a)
    const heard = nextEvent(aSock, 'channel:updated')
    await app().patch(`/servers/${server.id}/channels/${secret.id}`).set(auth(a)).send({ name: 'renamed' })
    expect((await heard).channel.name).toBe('renamed')
  })

  it('do not announce a channel created inside a private category', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const cat = await mkCategory(a, server.id, 'Staff')
    await lockCategory(a, server.id, cat.id)

    const bSock = await connect(b)
    const saw = arrives(bSock, 'channel:created', p => p.channel?.name === 'plans')
    await mkText(a, server.id, 'plans', cat.id)
    expect(await saw).toBe(false)
  })

  it('send a locked stub, not the channel, to a member it is shown locked to', async () => {
    const a = await register(), b = await register()
    const { server } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const secret = await mkText(a, server.id, 'secret')
    const res = await app().patch(`/servers/${server.id}/channels/${secret.id}`).set(auth(a))
      .send({ overwrites: await lockOverwrites(a, server.id), hideWhenDenied: false })
    expect(res.status).toBe(200)

    const bSock = await connect(b)
    const heard = nextEvent(bSock, 'channel:updated')
    await app().patch(`/servers/${server.id}/channels/${secret.id}`).set(auth(a)).send({ topic: 'the plan' })
    const { channel } = await heard
    expect(channel.locked).toBe(true)
    expect(channel.overwrites).toEqual([])
  })

  it('filter a reorder broadcast down to what each member can see', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const general = textOf(channels)
    const secret = await mkText(a, server.id, 'secret')
    await lockChannel(a, server.id, secret.id)

    const bSock = await connect(b)
    const heard = nextEvent(bSock, 'channels:reordered')
    const res = await app().put(`/servers/${server.id}/channels/order`).set(auth(a))
      .send({ category: null, type: 'text', order: [secret.id, general.id] })
    expect(res.status).toBe(200)

    const payload = await heard
    expect(payload.channels.map((c: any) => c.id)).toEqual([general.id])
  })
})
