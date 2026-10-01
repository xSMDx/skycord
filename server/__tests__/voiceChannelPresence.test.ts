/**
 * Voice-channel occupancy: who is sitting in a server's voice channel, and who
 * gets told about it.
 *
 * Two room names are in play and they are deliberately different strings:
 *   - `voice:<channelId>` — the LiveKit room (see roomFor in voiceController)
 *   - `chan:<channelId>`  — the Socket.IO room every server member joined at
 *                           connect for that channel's text traffic
 * Occupancy is broadcast to the SOCKET room, so members who are not in the call
 * still see who is. Conflating the two is the bug these tests exist to catch.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Socket as ClientSocket } from 'socket.io-client'
import {
  app, connectDb, disconnectDb, resetDb, register, auth,
  withSocketServer, connectSocket, connectSocketRaw, nextEvent, type TestUser,
} from './helpers'
import { Server } from '../models/Server'
import { Message } from '../models/Message'
import { Conversation } from '../models/Conversation'
import { roomFor } from '../controllers/voiceController'
import {
  callEndPending, cancelAllCallEnds, dropFromCall,
  fixCallVoiceServer, getCallVoiceServer,
} from '../sockets/chatSocket'
import { dmConvId } from '../controllers/messagesController'

/*
 * The grace period before an emptied room's call is declared over, shortened
 * for these tests. Twenty seconds is the shipped default and nothing here
 * could wait for it under a twenty-second test timeout. It has to comfortably
 * clear connectSocket's own 350ms setup wait, because a reconnect in these
 * tests costs that much before it can emit anything at all.
 *
 * Read by the server per scheduled end rather than captured at import, so
 * setting it here needs no ordering against the imports above.
 */
const GRACE_MS = 1200
process.env.CALL_END_GRACE_MS = String(GRACE_MS)

/** Wait until a scheduled call end has certainly either fired or not. */
const pastGrace = () => new Promise(r => setTimeout(r, GRACE_MS + 400))

const callEndedCount = () => Message.countDocuments({ content: 'Call ended' })

let sockets: { url: string; close: () => Promise<void> }
const open: ClientSocket[] = []

beforeAll(async () => { await connectDb(); sockets = await withSocketServer() })
afterAll(async () => { await sockets.close(); await disconnectDb() })
beforeEach(async () => {
  open.splice(0).forEach(s => s.disconnect())
  // Those disconnects schedule call ends on the server — which is the whole
  // behaviour under test here. Let the handlers run, then drop every pending
  // one: a timer surviving into the next test would write "Call ended" into
  // ITS database and corrupt a message count that has nothing to do with it.
  await new Promise(r => setTimeout(r, 50))
  cancelAllCallEnds()
  await resetDb()
})

const track = (s: ClientSocket) => { open.push(s); return s }

const mkServer = async (u: TestUser) =>
  (await app().post('/servers').set(auth(u)).send({ name: 'EA' })).body

// No join endpoint yet — seed membership directly, same pattern as
// channels.test.ts and voiceChannelToken.test.ts.
const joinAsMember = async (sid: string, uid: string) =>
  Server.updateOne({ _id: sid }, { $push: { members: uid } })

/** A server with a member `b`, plus its default voice channel. */
const seed = async (a: TestUser, b?: TestUser) => {
  const { server, channels } = await mkServer(a)
  if (b) await joinAsMember(server.id, b.id)
  const voice = channels.find((c: any) => c.type === 'voice')
  return { server, voice }
}

const ids = (p: { userIds: string[] }) => [...p.userIds].sort()

describe('voice channel presence', () => {
  it('tells another member of the same server who just joined the voice channel', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)

    // b must connect AFTER joining, since chan: rooms are joined at connect.
    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const seen = nextEvent(bSock, 'call:state')

    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })

    const payload = await seen
    // Exactly what roomFor mints, or the two halves of the app put people in
    // different LiveKit rooms while both believing they are connected.
    expect(payload.room).toBe(roomFor('channel', voice.id, a.id))
    expect(payload.room).toBe(`voice:${voice.id}`)
    expect(payload.userIds).toEqual([a.id])
  })

  it('tells nobody outside the server', async () => {
    const a = await register(), outsider = await register()
    const { voice } = await seed(a)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const oSock = track(await connectSocket(sockets.url, outsider.token))
    let seen = false
    oSock.on('call:state', () => { seen = true })

    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })

    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
  })

  it('removes the occupant again when they leave', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const joined = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    expect((await joined).userIds).toEqual([a.id])

    const left = nextEvent(bSock, 'call:state')
    aSock.emit('call:leave', { conversationId: voice.id, kind: 'channel' })
    const payload = await left
    expect(payload.room).toBe(`voice:${voice.id}`)
    expect(payload.userIds).toEqual([])
  })

  it('shows both occupants to each other when two members are in the channel', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const aFirst = nextEvent(aSock, 'call:state')
    const bFirst = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    expect(ids(await aFirst)).toEqual([a.id])
    expect(ids(await bFirst)).toEqual([a.id])

    const aSecond = nextEvent(aSock, 'call:state')
    const bSecond = nextEvent(bSock, 'call:state')
    bSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    expect(ids(await aSecond)).toEqual([a.id, b.id].sort())
    expect(ids(await bSecond)).toEqual([a.id, b.id].sort())
  })

  it('clears occupancy when a participant vanishes without leaving cleanly', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const joined = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    expect((await joined).userIds).toEqual([a.id])

    const cleared = nextEvent(bSock, 'call:state')
    aSock.disconnect()
    const payload = await cleared
    expect(payload.room).toBe(`voice:${voice.id}`)
    expect(payload.userIds).toEqual([])
  })

  it('catches a member up on a channel call that started before they connected', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const aSelf = nextEvent(aSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await aSelf   // the call is definitely registered before b shows up

    // Raw: the catch-up replays from inside the connect handler, so waiting
    // until setup finishes would mean waiting until after the thing we are
    // here to observe has already gone.
    const bSock = track(await connectSocketRaw(sockets.url, b.token))
    const payload = await nextEvent(bSock, 'call:state')
    expect(payload.room).toBe(`voice:${voice.id}`)
    expect(payload.userIds).toEqual([a.id])
  })

  it('catches nobody up who is not in the server', async () => {
    const a = await register(), outsider = await register()
    const { voice } = await seed(a)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const aSelf = nextEvent(aSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await aSelf

    const oSock = track(await connectSocket(sockets.url, outsider.token))
    let seen = false
    oSock.on('call:state', () => { seen = true })
    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
  })

  it('writes no system message for a channel call — there is no text history to write it into', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const before = await Message.countDocuments()

    const joined = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await joined

    // Leaving is the other half: postCallEnded fires for the last participant.
    const left = nextEvent(bSock, 'call:state')
    aSock.emit('call:leave', { conversationId: voice.id, kind: 'channel' })
    await left

    expect(await Message.countDocuments()).toBe(before)
  })
})

// call:join used to perform no membership check of any kind: an authenticated
// user naming any channel/group id landed in activeCalls and was broadcast to
// every real member, with no way for anyone to evict the phantom occupant
// afterwards (leaveCall only ever removes the caller). These prove the
// refusal actually blocks occupancy rather than merely rejecting politely —
// a real member who WOULD see call:state for a genuine join never sees one.
describe('call:join refuses non-members', () => {
  it('does not add a non-member of the server to a channel call', async () => {
    const a = await register(), outsider = await register()
    const { voice } = await seed(a)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const oSock = track(await connectSocket(sockets.url, outsider.token))
    let seen = false
    aSock.on('call:state', () => { seen = true })

    oSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })

    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
  })

  it('does not add a non-member of the group to a group call', async () => {
    const a = await register(), b = await register(), outsider = await register()
    const group = await Conversation.create({
      type: 'group', owner: a.id, members: [a.id, b.id], lastMessageAt: new Date(),
    })
    const groupId = group._id.toString()

    const aSock = track(await connectSocket(sockets.url, a.token))
    const oSock = track(await connectSocket(sockets.url, outsider.token))
    let seen = false
    aSock.on('call:state', () => { seen = true })

    oSock.emit('call:join', { conversationId: groupId, kind: 'group' })

    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
  })

  // POST /voice/token already refuses a text channel with a 400 — a voice call
  // in a text channel is not a thing. canJoinCall's channel branch used to skip
  // that check entirely, so a member naming a TEXT channel still landed in
  // activeCalls and broadcast to every real member of the server via chan:<id>
  // — permanent phantom occupancy in a channel that can never display it, and
  // nothing could ever evict it (leaveCall only removes the caller, and no
  // caller could ever legitimately "join" a text channel to leave it).
  it('does not add a text channel to call occupancy — a voice call in a text channel is not a thing', async () => {
    const a = await register(), b = await register()
    const { server, channels } = await mkServer(a)
    await joinAsMember(server.id, b.id)
    const text = channels.find((c: any) => c.type === 'text')

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    let seen = false
    bSock.on('call:state', () => { seen = true })

    aSock.emit('call:join', { conversationId: text.id, kind: 'channel' })

    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
  })
})

// canJoinCall used to early-return true for kind: 'dm' with no check
// whatsoever, unlike getVoiceToken (voiceController.ts), which requires the
// named partner to be a real user and not the caller themselves. Without that
// check here, an authenticated client naming ANY string as the partner id
// gets a real Message written by postCallSystem (dmConvId(userId, junk)) and,
// looped, that's unbounded database growth from one authenticated socket.
// These prove the refusal actually blocks both occupancy AND the write, not
// just one half of it.
describe('call:join validates the dm partner the way getVoiceToken does', () => {
  it('refuses a junk partner id: no call:state, no Message written', async () => {
    const a = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))
    let seen = false
    aSock.on('call:state', () => { seen = true })
    const before = await Message.countDocuments()

    // Well-formed ObjectId shape but no such user, same shape as
    // voiceChannelToken.test.ts's "404s a nonexistent (but well-formed) ...".
    aSock.emit('call:join', { conversationId: '507f1f77bcf86cd799439011', kind: 'dm' })

    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
    expect(await Message.countDocuments()).toBe(before)
  })

  it('refuses a self-join: no call:state, no Message written', async () => {
    const a = await register()
    const aSock = track(await connectSocket(sockets.url, a.token))
    let seen = false
    aSock.on('call:state', () => { seen = true })
    const before = await Message.countDocuments()

    aSock.emit('call:join', { conversationId: a.id, kind: 'dm' })

    await new Promise(r => setTimeout(r, 400))
    expect(seen).toBe(false)
    expect(await Message.countDocuments()).toBe(before)
  })
})

// broadcastCall's DM branch PARSES the room name rather than matching a prefix,
// so it is the branch that quietly produces nonsense if the new channel case is
// bolted on carelessly. These two keep the old paths honest.
describe('the DM and group call paths still work', () => {
  it('still reaches both DM participants, and still posts the system message on join AND on leave', async () => {
    const a = await register(), b = await register()

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const before = await Message.countDocuments()
    const seen = nextEvent(bSock, 'call:state')

    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })

    const payload = await seen
    expect(payload.room).toBe(`dm:${dmConvId(a.id, b.id)}`)
    expect(payload.userIds).toEqual([a.id])
    // "started a call" — call:join awaits postCallSystem before broadcasting,
    // so by the time call:state lands the write is already there.
    expect(await Message.countDocuments()).toBe(before + 1)

    // Leaving is the other half, and it is NOT proven by a blanket `return`
    // (or an outright deleted postCallEnded) at all: 294 tests passed either
    // way before this. leaveCall fires postCallEnded WITHOUT awaiting it
    // before broadcasting call:state, so waiting on call:state here would
    // race the "Call ended" write. postCallEnded's own dm:receive is emitted
    // only after its Message.create resolves, so waiting on THAT instead
    // guarantees the count below is read after the write lands.
    const ended = nextEvent(bSock, 'dm:receive')
    aSock.emit('call:leave', { conversationId: b.id, kind: 'dm' })
    const endedPayload = await ended
    expect(endedPayload.content).toBe('Call ended')
    expect(await Message.countDocuments()).toBe(before + 2)
  })

  it('still reaches the group room, and still posts the system message on join AND on leave', async () => {
    const a = await register(), b = await register()
    // Made against the model: the real endpoint requires friendship setup that
    // is irrelevant here (same shortcut groupMessages.test.ts takes).
    const group = await Conversation.create({
      type: 'group', owner: a.id, members: [a.id, b.id], lastMessageAt: new Date(),
    })
    const groupId = group._id.toString()

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    const before = await Message.countDocuments()
    const seen = nextEvent(bSock, 'call:state')

    aSock.emit('call:join', { conversationId: groupId, kind: 'group' })

    const payload = await seen
    expect(payload.room).toBe(`group:${groupId}`)
    expect(payload.userIds).toEqual([a.id])
    expect(await Message.countDocuments()).toBe(before + 1)

    // Same race-avoidance as the DM case above: wait on group:receive (fired
    // only after postCallEnded's Message.create resolves), not call:state.
    const ended = nextEvent(bSock, 'group:receive')
    aSock.emit('call:leave', { conversationId: groupId, kind: 'group' })
    const endedPayload = await ended
    expect(endedPayload.content).toBe('Call ended')
    expect(await Message.countDocuments()).toBe(before + 2)
  })
  // The rail marks a server as having someone in voice. The client only
  // knows which server a channel belongs to for servers it has actually
  // opened — channels are fetched lazily — so occupancy for an unopened
  // server would arrive unattributable. Naming the server on the wire is
  // what removes the need for the client to poll or to fetch every server
  // it is in on boot.
  it('names the server the voice channel belongs to', async () => {
    const a = await register(), b = await register()
    const { server, voice } = await seed(a, b)

    const bSock = track(await connectSocket(sockets.url, b.token))
    const seen = nextEvent(bSock, 'call:state')

    const aSock = track(await connectSocket(sockets.url, a.token))
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })

    const payload = await seen
    expect(payload.room).toBe(`voice:${voice.id}`)
    expect(payload.serverId).toBe(server.id)
  })
})

/*
 * A reconnect must put the person back, and must not announce anything.
 *
 * Presence and media are two connections to two services. A dropped socket
 * makes this process run leaveCall for every room it held, so every sidebar
 * loses that person at once — while their LiveKit connection carries on
 * untouched, leaving them audible and still a tile on everyone's call
 * stage. Socket.IO then reconnects with a NEW socket whose joinedCallRooms
 * is empty, and nothing refilled it: the two views disagreed until the
 * person left for real. One `pm2 restart` did it to every call at once.
 */
describe('coming back after a dropped socket', () => {
  it('puts the person back in the occupancy their socket took with it', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const joined = nextEvent(bSock, 'call:state')
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    expect((await joined).userIds).toEqual([a.id])

    // The blip. a is still in the LiveKit room throughout — nothing here
    // can see that, which is the whole reason this gap existed.
    const cleared = nextEvent(bSock, 'call:state')
    aSock.disconnect()
    expect((await cleared).userIds).toEqual([])

    const back = nextEvent(bSock, 'call:state')
    const aAgain = track(await connectSocket(sockets.url, a.token))
    aAgain.emit('call:rejoin', { conversationId: voice.id, kind: 'channel' })
    expect((await back).userIds).toEqual([a.id])
  })

  it('answers the rejoining socket directly, so it is never the one missing itself', async () => {
    // The handlers are registered synchronously but the chan: joins are in
    // the async setup, so a broadcast alone can reach this socket before it
    // is listening to the room it was broadcast to.
    const a = await register()
    const { voice } = await seed(a)

    const aSock = track(await connectSocket(sockets.url, a.token))
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    aSock.disconnect()

    const aAgain = track(await connectSocket(sockets.url, a.token))
    const self = nextEvent(aAgain, 'call:state')
    aAgain.emit('call:rejoin', { conversationId: voice.id, kind: 'channel' })
    const payload = await self
    expect(payload.room).toBe(`voice:${voice.id}`)
    expect(payload.userIds).toEqual([a.id])
  })

  it('leaves again when the second socket goes too, rather than sticking', async () => {
    const a = await register(), b = await register()
    const { voice } = await seed(a, b)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    aSock.disconnect()

    const back = nextEvent(bSock, 'call:state')
    const aAgain = track(await connectSocket(sockets.url, a.token))
    aAgain.emit('call:rejoin', { conversationId: voice.id, kind: 'channel' })
    expect((await back).userIds).toEqual([a.id])

    // joinedCallRooms is per socket: without the rejoin adding the room to
    // the NEW socket's set, this disconnect would clean up nothing and a
    // would be a permanent ghost.
    const gone = nextEvent(bSock, 'call:state')
    aAgain.disconnect()
    expect((await gone).userIds).toEqual([])
  })

  it('does not announce the call a second time', async () => {
    // A voice channel has no history to announce into, so this is the DM
    // and group case: after an API restart, every call in the instance
    // rejoining would post "X started a call" all over again.
    const a = await register(), b = await register()
    const group = await Conversation.create({
      type: 'group', owner: a.id, members: [a.id, b.id], lastMessageAt: new Date(),
    })
    const groupId = group._id.toString()

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    aSock.emit('group:subscribe', { groupId })
    bSock.emit('group:subscribe', { groupId })

    const started = nextEvent(bSock, 'group:receive')
    aSock.emit('call:join', { conversationId: groupId, kind: 'group' })
    expect((await started).content).toBe(`${a.username} started a call`)

    // Await the drop's own broadcast before listening for the rejoin's, or
    // the next call:state to arrive is the empty one this disconnect causes.
    // The drop writes nothing at all now — see the grace-period tests below,
    // which is what makes the count read just after it stable rather than racy.
    const cleared = nextEvent(bSock, 'call:state')
    aSock.disconnect()
    expect((await cleared).userIds).toEqual([])
    const before = await Message.countDocuments()

    const back = nextEvent(bSock, 'call:state')
    const aAgain = track(await connectSocket(sockets.url, a.token))
    aAgain.emit('call:rejoin', { conversationId: groupId, kind: 'group' })
    expect((await back).userIds).toEqual([a.id])

    // The rejoin itself writes nothing at all, and the conversation is told
    // about this call starting exactly once however many blips it survives.
    expect(await Message.countDocuments()).toBe(before)
    expect(await Message.countDocuments({ content: `${a.username} started a call` })).toBe(1)
  })

  /*
   * The other half, closed here: leaveCall used to see the room empty and
   * declare the call over, because it could not tell a hang-up from a hiccup.
   * The call had not ended — a is in the LiveKit room throughout and comes
   * straight back — but "Call ended" was already in everybody's history, and
   * nothing takes a Message back. Occupancy still goes the instant the socket
   * does; only the conclusion waits.
   */

  it('says nothing in the conversation while the call could still come back', async () => {
    const a = await register(), b = await register()
    const room = roomFor('dm', b.id, a.id)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const started = nextEvent(bSock, 'dm:receive')
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    expect((await started).content).toBe(`${a.username} started a call`)

    // The blip. Occupancy is gone at once — the sidebars have to stay honest
    // about who is there — but the room is only pending, not over.
    const cleared = nextEvent(bSock, 'call:state')
    aSock.disconnect()
    expect((await cleared).userIds).toEqual([])
    expect(callEndPending(room)).toBe(true)
    expect(await callEndedCount()).toBe(0)

    const back = nextEvent(bSock, 'call:state')
    const aAgain = track(await connectSocket(sockets.url, a.token))
    aAgain.emit('call:rejoin', { conversationId: b.id, kind: 'dm' })
    expect((await back).userIds).toEqual([a.id])
    expect(callEndPending(room)).toBe(false)

    // The point: not merely deferred past the assertion above, cancelled.
    await pastGrace()
    expect(await callEndedCount()).toBe(0)
  })

  it('still ends the call once nobody comes back', async () => {
    // The guard against "fixing" this by never ending a call again: a grace
    // period that silently swallowed the message would pass every test above.
    const a = await register(), b = await register()
    const room = roomFor('dm', b.id, a.id)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))

    const started = nextEvent(bSock, 'dm:receive')
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    await started

    // Listened for only now that "started a call" has landed — registered any
    // earlier, this would resolve with that message instead of the end.
    // b stays listening throughout, so this also proves the message reaches
    // the open DM rather than only landing in the database.
    const ended = nextEvent(bSock, 'dm:receive', GRACE_MS + 3000)
    // `disconnect()` is a client-side call; waiting for the occupancy the
    // server broadcasts in response is what proves its handler has run, and
    // the grace period only starts there.
    const cleared = nextEvent(bSock, 'call:state')
    aSock.disconnect()
    expect((await cleared).userIds).toEqual([])
    expect(callEndPending(room)).toBe(true)

    expect((await ended).content).toBe('Call ended')
    expect(await callEndedCount()).toBe(1)
    expect(callEndPending(room)).toBe(false)
  })

  it('ends nothing when a restart takes every socket in the call at once', async () => {
    // The case this was found through: one `pm2 restart` severs every socket in
    // the instance, so every room empties within the same tick and every client
    // reconnects to the new process a moment later. A single deploy used to
    // announce the end of every call on the instance.
    const a = await register(), b = await register()
    const group = await Conversation.create({
      type: 'group', owner: a.id, members: [a.id, b.id], lastMessageAt: new Date(),
    })
    const groupId = group._id.toString()
    const room = `group:${groupId}`

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: groupId, kind: 'group' })
    bSock.emit('call:join', { conversationId: groupId, kind: 'group' })
    await new Promise(r => setTimeout(r, 150))

    aSock.disconnect()
    bSock.disconnect()
    await new Promise(r => setTimeout(r, 150))
    expect(callEndPending(room)).toBe(true)

    const aAgain = track(await connectSocket(sockets.url, a.token))
    const bAgain = track(await connectSocket(sockets.url, b.token))
    aAgain.emit('call:rejoin', { conversationId: groupId, kind: 'group' })
    bAgain.emit('call:rejoin', { conversationId: groupId, kind: 'group' })
    await new Promise(r => setTimeout(r, 150))

    expect(callEndPending(room)).toBe(false)
    await pastGrace()
    expect(await callEndedCount()).toBe(0)
    // One "started a call", from the real start. The call never stopped, so it
    // never restarted either.
    expect(await Message.countDocuments({ systemType: 'call' })).toBe(1)
  })

  it('hangs up at once when somebody actually leaves', async () => {
    // The contrast that gives the grace period its meaning. `call:leave` is a
    // person deciding; nothing about it is in doubt, so nothing waits.
    const a = await register(), b = await register()
    const room = roomFor('dm', b.id, a.id)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    await nextEvent(bSock, 'call:state')

    const ended = nextEvent(bSock, 'dm:receive')
    aSock.emit('call:leave', { conversationId: b.id, kind: 'dm' })
    expect((await ended).content).toBe('Call ended')
    // Never scheduled, rather than scheduled and beaten to it.
    expect(callEndPending(room)).toBe(false)
  })

  it('lets a moderator end a call at once, with no grace period', async () => {
    /*
     * dropFromCall is the moderated path, and a moderator removing the last
     * person is not a blip: somebody has decided they are out, and there is
     * nobody to come back. It only ever sees a voice channel, which has no
     * text history for a message to land in, so what is observable is the
     * room's media server being let go — immediately here, and only after the
     * grace period on the dropped-socket path below.
     */
    const a = await register()
    const { voice } = await seed(a)
    const room = roomFor('channel', voice.id, a.id)

    const aSock = track(await connectSocket(sockets.url, a.token))
    aSock.emit('call:join', { conversationId: voice.id, kind: 'channel' })
    await nextEvent(aSock, 'call:state')
    fixCallVoiceServer(room, 'vs-moderated')
    expect(getCallVoiceServer(room)).toBe('vs-moderated')

    expect(dropFromCall(room, a.id)).toBe(true)
    expect(getCallVoiceServer(room)).toBeUndefined()
    expect(callEndPending(room)).toBe(false)
  })

  it('keeps the media server a dropped call settled on until the grace period runs out', async () => {
    /*
     * The pin is what stops two people in one DM minting tokens against two
     * different LiveKit servers and hearing silence. Releasing it the moment
     * the last socket dropped would do exactly that: whoever dropped may still
     * be in the LiveKit room on the old server, and the next person to join
     * would be free to land on another and be split off from them.
     */
    const a = await register(), b = await register()
    const room = roomFor('dm', b.id, a.id)

    const aSock = track(await connectSocket(sockets.url, a.token))
    track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    await new Promise(r => setTimeout(r, 150))
    fixCallVoiceServer(room, 'vs-dropped')

    aSock.disconnect()
    await new Promise(r => setTimeout(r, 150))
    expect(callEndPending(room)).toBe(true)
    expect(getCallVoiceServer(room)).toBe('vs-dropped')

    await pastGrace()
    expect(getCallVoiceServer(room)).toBeUndefined()
  })

  it('treats a plain join during the grace period as joining, not starting', async () => {
    /*
     * A client that gave up on reconnecting and came back through the front
     * door, or somebody else arriving while the call is pending. Either way
     * the room was never really empty — whoever dropped may still be in the
     * LiveKit room — so there is no second "started a call" to post, no end to
     * conclude, and the media server the call settled on is kept, not released.
     */
    const a = await register(), b = await register()
    const room = roomFor('dm', b.id, a.id)

    const aSock = track(await connectSocket(sockets.url, a.token))
    const bSock = track(await connectSocket(sockets.url, b.token))
    aSock.emit('call:join', { conversationId: b.id, kind: 'dm' })
    await nextEvent(bSock, 'call:state')
    fixCallVoiceServer(room, 'vs-resumed')

    aSock.disconnect()
    await new Promise(r => setTimeout(r, 150))
    expect(callEndPending(room)).toBe(true)

    const joined = nextEvent(bSock, 'call:state')
    bSock.emit('call:join', { conversationId: a.id, kind: 'dm' })
    expect((await joined).userIds).toEqual([b.id])

    expect(callEndPending(room)).toBe(false)
    expect(getCallVoiceServer(room)).toBe('vs-resumed')
    await pastGrace()
    expect(await callEndedCount()).toBe(0)
    expect(await Message.countDocuments({ systemType: 'call' })).toBe(1)
  })

  it('refuses a rejoin from somebody who was never allowed in', async () => {
    // Coming back from a blip is not a way in: the same gate as call:join.
    const a = await register(), outsider = await register()
    const { voice } = await seed(a)

    const oSock = track(await connectSocket(sockets.url, outsider.token))
    const aSock = track(await connectSocket(sockets.url, a.token))
    let seen = false
    aSock.on('call:state', () => { seen = true })

    oSock.emit('call:rejoin', { conversationId: voice.id, kind: 'channel' })
    await new Promise(r => setTimeout(r, 120))
    expect(seen).toBe(false)
  })
})
