/**
 * Who is muted, deafened, or sharing their screen.
 *
 * Until now the server tracked exactly one thing about a voice room: the set
 * of user ids in it. That is enough to say "three people are in here" and
 * nothing else — so a sidebar could not show a crossed-out mic, and could not
 * show that someone is live.
 *
 * It cannot be solved on the client. LiveKit knows the mic state of remote
 * participants, but only in the room YOU are connected to, and a sidebar
 * shows every voice channel in the server. Deafening is worse: it is a purely
 * local decision about what you play back, so it publishes no track and no
 * other client can observe it at all. Both facts have to be told to the
 * server and fanned out with the occupancy.
 *
 * Hence `voice:state`. The rules it has to keep:
 *
 * - **State is per room, not per user.** Someone who leaves a channel and
 *   joins another must not carry a stale "sharing" flag into it.
 * - **It dies with the membership.** Occupancy and state are read together by
 *   every client; state that outlives its occupant would render a ghost row.
 * - **It only speaks for the sender.** The event carries no user id — the
 *   socket's own identity is used — so no client can mute another.
 * - **It survives a reconnect**, because the catch-up replay is the only way a
 *   client that was offline learns the room's contents.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, connectSocketRaw, type TestUser,
} from './helpers'
import { Server } from '../models/Server'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => { open.splice(0).forEach(s => s.disconnect()); await resetDb() })

const track = (s: ClientSocket) => { open.push(s); return s }

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body.server
const mkVoice = async (u: TestUser, sid: string, name = 'General') =>
  (await app().post(`/servers/${sid}/channels`).set(auth(u)).send({ type: 'voice', name })).body.channel

/** Resolves on the next call:state for this exact room. */
const nextCallState = (s: ClientSocket, room: string): Promise<any> =>
  new Promise(resolve => {
    const on = (p: any) => { if (p.room === room) { s.off('call:state', on); resolve(p) } }
    s.on('call:state', on)
  })

/**
 * Resolves once the room holds exactly these occupants.
 *
 * Waiting for "the next call:state" is not enough when two people are
 * joining: the second join emits its own broadcast, and a listener registered
 * after the first one catches THAT instead of the state change under test.
 */
const settledWith = (s: ClientSocket, room: string, ids: string[]): Promise<any> =>
  new Promise(resolve => {
    const on = (p: any) => {
      if (p.room !== room) return
      if (ids.every(i => p.userIds.includes(i)) && p.userIds.length === ids.length) {
        s.off('call:state', on); resolve(p)
      }
    }
    s.on('call:state', on)
  })

describe('voice:state', () => {
  it('rides along with the occupancy it describes', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await Server.updateOne({ _id: s.id }, { $push: { members: b.id } })
    const v = await mkVoice(a, s.id)
    const room = `voice:${v.id}`

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    aSock.emit('call:join', { conversationId: v.id, kind: 'channel' })
    await nextCallState(bSock, room)

    const seen = nextCallState(bSock, room)
    aSock.emit('voice:state', { muted: true, deafened: false, sharing: true })
    const p = await seen

    expect(p.userIds).toEqual([a.id])
    expect(p.states?.[a.id]).toEqual({ muted: true, deafened: false, sharing: true })
  })

  it('speaks only for the sender — the payload carries no user id to spoof', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await Server.updateOne({ _id: s.id }, { $push: { members: b.id } })
    const v = await mkVoice(a, s.id)
    const room = `voice:${v.id}`

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const both = settledWith(aSock, room, [a.id, b.id])
    aSock.emit('call:join', { conversationId: v.id, kind: 'channel' })
    bSock.emit('call:join', { conversationId: v.id, kind: 'channel' })
    await both

    // b tries to claim a is muted, naming them explicitly.
    const seen = nextCallState(aSock, room)
    bSock.emit('voice:state', { userId: a.id, muted: true } as any)
    const p = await seen

    // The flag landed on b, who sent it — never on a.
    expect(p.states?.[b.id]?.muted).toBe(true)
    expect(p.states?.[a.id]?.muted ?? false).toBe(false)
  })

  it('is dropped when its owner leaves the room', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await Server.updateOne({ _id: s.id }, { $push: { members: b.id } })
    const v = await mkVoice(a, s.id)
    const room = `voice:${v.id}`

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: v.id, kind: 'channel' })
    bSock.emit('call:join', { conversationId: v.id, kind: 'channel' })
    await nextCallState(bSock, room)
    aSock.emit('voice:state', { muted: true })
    await nextCallState(bSock, room)

    const afterLeave = nextCallState(bSock, room)
    aSock.emit('call:leave', { conversationId: v.id, kind: 'channel' })
    const p = await afterLeave

    expect(p.userIds).toEqual([b.id])
    // State that outlives its occupant renders a ghost row in the sidebar.
    expect(p.states?.[a.id]).toBeUndefined()
  })

  it('does not follow you from one channel into another', async () => {
    // Per room, not per user: sharing your screen in one channel says nothing
    // about the next one you walk into.
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await Server.updateOne({ _id: s.id }, { $push: { members: b.id } })
    const v1 = await mkVoice(a, s.id, 'One')
    const v2 = await mkVoice(a, s.id, 'Two')

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    aSock.emit('call:join', { conversationId: v1.id, kind: 'channel' })
    await nextCallState(bSock, `voice:${v1.id}`)
    aSock.emit('voice:state', { sharing: true })
    await nextCallState(bSock, `voice:${v1.id}`)

    aSock.emit('call:leave', { conversationId: v1.id, kind: 'channel' })
    const inTwo = nextCallState(bSock, `voice:${v2.id}`)
    aSock.emit('call:join', { conversationId: v2.id, kind: 'channel' })
    const p = await inTwo

    expect(p.userIds).toEqual([a.id])
    expect(p.states?.[a.id]?.sharing ?? false).toBe(false)
  })

  it('reaches someone who was offline when it was set', async () => {
    // The catch-up replay is the only way a late arrival learns the room's
    // contents, so state omitted there is state nobody sees until it changes.
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await Server.updateOne({ _id: s.id }, { $push: { members: b.id } })
    const v = await mkVoice(a, s.id)
    const room = `voice:${v.id}`

    const aSock = track(await connectSocket(sockets.url, a.token))
    aSock.emit('call:join', { conversationId: v.id, kind: 'channel' })
    await new Promise(r => setTimeout(r, 120))
    aSock.emit('voice:state', { muted: true, sharing: true })
    await new Promise(r => setTimeout(r, 120))

    // b only now comes online. connectSocketRaw, not connectSocket: the
    // catch-up is emitted DURING server-side setup, and connectSocket
    // deliberately waits past setup — which would be waiting past the very
    // thing under test (see the note on the helper).
    const bSock = track(await connectSocketRaw(sockets.url, b.token))
    const p = await nextCallState(bSock, room)

    expect(p.states?.[a.id]).toMatchObject({ muted: true, sharing: true })
  })

  it('ignores a payload that is not an object, rather than storing junk', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await Server.updateOne({ _id: s.id }, { $push: { members: b.id } })
    const v = await mkVoice(a, s.id)
    const room = `voice:${v.id}`

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: v.id, kind: 'channel' })
    await nextCallState(bSock, room)

    aSock.emit('voice:state', 'muted' as any)
    // Followed by a real one, so there is something to wait for either way.
    const seen = nextCallState(bSock, room)
    aSock.emit('voice:state', { muted: true })
    const p = await seen

    expect(p.states?.[a.id]).toEqual({ muted: true, deafened: false, sharing: false })
  })

  it('is ignored from someone who is not in a call at all', async () => {
    const a = await register(), b = await register()
    const s = await mkServer(a)
    await Server.updateOne({ _id: s.id }, { $push: { members: b.id } })
    const v = await mkVoice(a, s.id)
    const room = `voice:${v.id}`

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    bSock.emit('call:join', { conversationId: v.id, kind: 'channel' })
    await nextCallState(bSock, room)

    // a never joined. Nothing to attach state to, and no room to broadcast in.
    const seen = nextCallState(bSock, room)
    aSock.emit('voice:state', { muted: true })
    bSock.emit('voice:state', { deafened: true })
    const p = await seen

    expect(p.states?.[a.id]).toBeUndefined()
    expect(p.states?.[b.id]?.deafened).toBe(true)
  })
})
