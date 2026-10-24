/**
 * Leaving a group takes the leaver's sockets out of its socket room.
 *
 * A socket joins `group:<id>` when it connects, and nothing ever took it out
 * again, so a former member's long-lived socket (the phone's background socket
 * is the one that lives for days) kept receiving that group's messages and
 * `call:state` until it happened to reconnect. The phone treats a group's
 * `call:state` as proof of membership, so it would have rung for a group the
 * person had left.
 *
 * The membership itself was always right: a fresh connection builds its rooms
 * from the database. It is only the sockets that were already open.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, auth, connectDb, disconnectDb, resetDb, register,
  withSocketServer, connectSocket, connectBackground, nextEvent, type TestUser,
} from './helpers'
import { Conversation } from '../models/Conversation'
import { cancelAllCallEnds, getIO } from '../sockets/chatSocket'

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => {
  open.splice(0).forEach(s => s.disconnect())
  // Those disconnects schedule call ends on the server. Let the handlers run,
  // then drop them, so a timer cannot write into the next test's database.
  await new Promise(r => setTimeout(r, 50))
  cancelAllCallEnds()
  await resetDb()
})

const track = (s: ClientSocket) => { open.push(s); return s }
const settle = (ms = 300) => new Promise(r => setTimeout(r, ms))

// Created directly against the model: group creation through the endpoint needs
// friendship setup that has nothing to do with what these tests check.
const mkGroup = (owner: TestUser, members: TestUser[]) =>
  Conversation.create({
    type: 'group', owner: owner.id,
    members: [owner.id, ...members.map(m => m.id)],
    lastMessageAt: new Date(),
  })

const leave = (who: TestUser, groupId: string) =>
  app().post(`/conversations/groups/${groupId}/leave`).set(auth(who))

/** Records every `name` event that reaches `s`. */
const watch = (s: ClientSocket, name: string) => {
  const seen: any[] = []
  s.on(name, (p: any) => { seen.push(p) })
  return seen
}

describe('leaving a group', () => {
  it('stops the leaver\'s sockets, background one included, getting the group\'s messages', async () => {
    const a = await register(), b = await register(), c = await register()
    const group = await mkGroup(a, [b, c])
    const id = group._id.toString()

    const aPage = track(await connectSocket(sockets.url, a.token))
    const aPhone = track(await connectBackground(sockets.url, a.token))
    const cSock = track(await connectSocket(sockets.url, c.token))
    const aSaw = watch(aPage, 'group:receive')
    const aPhoneSaw = watch(aPhone, 'group:receive')

    // Control: while a is a member the message reaches the sockets, so the
    // silence after leaving is the leave's doing and not a quiet harness.
    const before = nextEvent(aPhone, 'group:receive')
    await app().post(`/conversations/groups/${id}/messages`).set(auth(b)).send({ content: 'one' })
    await before

    expect((await leave(a, id)).status).toBe(200)

    const toC = nextEvent(cSock, 'group:receive')
    aSaw.length = 0; aPhoneSaw.length = 0
    await app().post(`/conversations/groups/${id}/messages`).set(auth(b)).send({ content: 'two' })
    expect((await toC).content).toBe('two')
    await settle()

    expect(aSaw).toEqual([])
    expect(aPhoneSaw).toEqual([])
  })

  it('stops the leaver\'s sockets hearing the group\'s call:state, so the phone cannot ring for it', async () => {
    const a = await register(), b = await register(), c = await register()
    const group = await mkGroup(a, [b, c])
    const id = group._id.toString()

    const aPhone = track(await connectBackground(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const cSock = track(await connectSocket(sockets.url, c.token))
    const aSaw = watch(aPhone, 'call:state')

    expect((await leave(a, id)).status).toBe(200)

    const toC = nextEvent<{ room: string; userIds: string[] }>(cSock, 'call:state')
    bSock.emit('call:join', { conversationId: id, kind: 'group' })
    expect((await toC).userIds).toEqual([b.id])
    await settle()

    expect(aSaw).toEqual([])
  })

  it('keeps the others\' sockets in the room and the leaver\'s in the groups they did not leave', async () => {
    const a = await register(), b = await register()
    const going = await mkGroup(a, [b])
    const staying = await mkGroup(a, [b])

    const aPage = track(await connectSocket(sockets.url, a.token))
    track(await connectSocket(sockets.url, b.token))

    expect((await leave(a, going._id.toString())).status).toBe(200)

    const inRoom = async (room: string) =>
      (await getIO()!.in(room).fetchSockets()).map(s => s.id)
    expect(await inRoom(`group:${going._id}`)).toHaveLength(1)        // b's only
    expect(await inRoom(`group:${going._id}`)).not.toContain(aPage.id)
    expect(await inRoom(`group:${staying._id}`)).toHaveLength(2)      // a and b
  })

  it('also covers the last member leaving, which deletes the group', async () => {
    const a = await register()
    const group = await mkGroup(a, [])
    const aPage = track(await connectSocket(sockets.url, a.token))

    const res = await leave(a, group._id.toString())
    expect(res.body).toEqual({ left: true, deleted: true })

    const ids = (await getIO()!.in(`group:${group._id}`).fetchSockets()).map(s => s.id)
    expect(ids).not.toContain(aPage.id)
  })
})
