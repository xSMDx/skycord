/**
 * Declining a call.
 *
 * When a DM call rings on the phone and the person taps Decline, two things
 * have to happen: the caller is told ("B declined"), and the person's OTHER
 * devices stop ringing. Both ride on one event, `call:declined`, which the
 * server sends to the decliner's own personal room (every device they have) and,
 * for a DM, to the partner's.
 *
 * Declining only ever notifies. It never touches who is in the call, and the
 * phone sends it over its background socket — so, unlike joining, a background
 * socket is allowed to do it.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  connectDb, disconnectDb, resetDb, register,
  withSocketServer, connectSocket, connectBackground, nextEvent, type TestUser,
} from './helpers'
import { Conversation } from '../models/Conversation'
import { User } from '../models/User'
import { cancelAllCallEnds, isInCall } from '../sockets/chatSocket'
import { dmConvId } from '../controllers/messagesController'

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

type Declined = { room: string; userId: string; name: string }

const dmRoom = (x: TestUser, y: TestUser) => `dm:${dmConvId(x.id, y.id)}`

// Created directly against the model: group creation through the endpoint needs
// friendship setup that has nothing to do with what these tests check.
const mkGroup = (owner: TestUser, members: TestUser[]) =>
  Conversation.create({
    type: 'group', owner: owner.id,
    members: [owner.id, ...members.map(m => m.id)],
    lastMessageAt: new Date(),
  })

/** Puts `who` in the call and waits until the server has said so. */
const joinCall = async (who: ClientSocket, kind: 'dm' | 'group', conversationId: string) => {
  const state = nextEvent(who, 'call:state')
  who.emit('call:join', { conversationId, kind })
  await state
}

/** Records every `call:declined` that reaches `s`. */
const watchDeclines = (s: ClientSocket) => {
  const seen: Declined[] = []
  s.on('call:declined', (p: Declined) => { seen.push(p) })
  return seen
}

describe('call:decline', () => {
  it('declining a DM call tells the caller and the decliner\'s other devices', async () => {
    const a = await register(), b = await register()
    // A display name that differs from the username, so the assertion below
    // can only pass by reading the right field.
    await User.updateOne({ _id: b.id }, { displayName: 'Bee Display' })

    const aSock = track(await connectSocket(sockets.url, a.token))
    const b1 = track(await connectSocket(sockets.url, b.token))
    const b2 = track(await connectSocket(sockets.url, b.token))
    await joinCall(aSock, 'dm', b.id)

    const room = dmRoom(a, b)
    const toCaller = nextEvent<Declined>(aSock, 'call:declined')
    const toOtherDevice = nextEvent<Declined>(b2, 'call:declined')
    b1.emit('call:decline', { room })

    const expected = { room, userId: b.id, name: 'Bee Display' }
    expect(await toCaller).toEqual(expected)
    expect(await toOtherDevice).toEqual(expected)

    // Notifies only: the call and who is in it are exactly as they were.
    expect(isInCall(room, a.id)).toBe(true)
    expect(isInCall(room, b.id)).toBe(false)
  })

  it('the name falls back to the username when there is no display name', async () => {
    const a = await register(), b = await register()
    await User.updateOne({ _id: b.id }, { displayName: '' })

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    await joinCall(aSock, 'dm', b.id)

    const got = nextEvent<Declined>(aSock, 'call:declined')
    bSock.emit('call:decline', { room: dmRoom(a, b) })

    expect((await got).name).toBe(b.username)
  })

  it('a background socket can decline a DM call', async () => {
    const a = await register(), b = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))
    // The phone: its Decline button speaks over the notification socket, the
    // one that is refused call:join and call:rejoin.
    const bPhone = track(await connectBackground(sockets.url, b.token))
    await joinCall(aSock, 'dm', b.id)

    const room = dmRoom(a, b)
    const got = nextEvent<Declined>(aSock, 'call:declined')
    bPhone.emit('call:decline', { room })

    expect(await got).toEqual({ room, userId: b.id, name: b.username })
    expect(isInCall(room, b.id)).toBe(false)
  })

  it('declining a group call tells only the decliner', async () => {
    const a = await register(), b = await register(), c = await register()
    const group = await mkGroup(a, [b, c])

    const aSock = track(await connectSocket(sockets.url, a.token))
    const b1 = track(await connectSocket(sockets.url, b.token))
    const b2 = track(await connectSocket(sockets.url, b.token))
    const cSock = track(await connectSocket(sockets.url, c.token))
    await joinCall(aSock, 'group', group.id)

    const room = `group:${group.id}`
    const callerSaw = watchDeclines(aSock)
    const otherMemberSaw = watchDeclines(cSock)
    const otherDevice = nextEvent<Declined>(b2, 'call:declined')
    b1.emit('call:decline', { room })

    expect(await otherDevice).toEqual({ room, userId: b.id, name: b.username })
    // Nobody else in the group is told: a ringing group call has no single
    // caller to answer to, and C declining-by-proxy would be noise.
    await settle(300)
    expect(callerSaw).toEqual([])
    expect(otherMemberSaw).toEqual([])
  })

  it('a decline for a DM room you\'re not part of is ignored', async () => {
    const a = await register(), b = await register(), c = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const cSock = track(await connectSocket(sockets.url, c.token))
    await joinCall(aSock, 'dm', b.id)

    const room = dmRoom(a, b)
    const saw = [watchDeclines(aSock), watchDeclines(bSock), watchDeclines(cSock)]
    cSock.emit('call:decline', { room })
    await settle(300)
    expect(saw).toEqual([[], [], []])

    // The control: the same event from somebody who IS part of the room goes
    // through, so the silence above is the guard and not a dead listener.
    const got = nextEvent<Declined>(aSock, 'call:declined')
    bSock.emit('call:decline', { room })
    expect((await got).userId).toBe(b.id)
  })

  it('a decline for a group you\'re not a member of is ignored', async () => {
    const a = await register(), b = await register(), outsider = await register()
    const group = await mkGroup(a, [b])

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const outsiderSock = track(await connectSocket(sockets.url, outsider.token))
    await joinCall(aSock, 'group', group.id)

    const room = `group:${group.id}`
    const saw = [watchDeclines(aSock), watchDeclines(bSock), watchDeclines(outsiderSock)]
    outsiderSock.emit('call:decline', { room })
    await settle(300)
    expect(saw).toEqual([[], [], []])

    // The control: a real member's decline is delivered.
    const got = nextEvent<Declined>(bSock, 'call:declined')
    bSock.emit('call:decline', { room })
    expect((await got).userId).toBe(b.id)
  })

  it('a decline for an empty room is ignored', async () => {
    const a = await register(), b = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    // Nobody is calling anybody.
    const room = dmRoom(a, b)
    const saw = [watchDeclines(aSock), watchDeclines(bSock)]
    bSock.emit('call:decline', { room })
    await settle(300)
    expect(saw).toEqual([[], []])

    // The control: once the call is real, the same decline is delivered — so
    // it was the empty room that stopped it.
    await joinCall(aSock, 'dm', b.id)
    const got = nextEvent<Declined>(aSock, 'call:declined')
    bSock.emit('call:decline', { room })
    expect((await got).userId).toBe(b.id)
  })

  it('a decline from someone already in the call is ignored', async () => {
    const a = await register(), b = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    await joinCall(aSock, 'dm', b.id)
    await joinCall(bSock, 'dm', a.id)

    // B answered. A late Decline (a second device, a double tap) must not tell
    // the caller they were turned down by somebody who is on the call.
    const room = dmRoom(a, b)
    const saw = [watchDeclines(aSock), watchDeclines(bSock)]
    bSock.emit('call:decline', { room })
    await settle(300)
    expect(saw).toEqual([[], []])
    expect(isInCall(room, b.id)).toBe(true)
  })

  it('malformed declines are ignored and the server keeps working', async () => {
    const a = await register(), b = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    await joinCall(aSock, 'dm', b.id)

    const saw = [watchDeclines(aSock), watchDeclines(bSock)]
    const room = dmRoom(a, b)
    const junk: unknown[] = [
      undefined, null, 'dm', {}, { room: 42 }, { room: ['x'] }, { room: '' },
      { room: 'dm:' }, { room: `${room}_${b.id}` }, { room: `x${room}` },
      { room: 'voice:507f1f77bcf86cd799439011' }, { room: 'group:not-an-id' },
    ]
    for (const j of junk) bSock.emit('call:decline', j)
    await settle(300)
    expect(saw).toEqual([[], []])

    // Still alive, and the real thing still works.
    const got = nextEvent<Declined>(aSock, 'call:declined')
    bSock.emit('call:decline', { room })
    expect((await got).room).toBe(room)
  })
})
