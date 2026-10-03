import type { Server as HttpServer } from 'http'
import { Server as IOServer, Socket } from 'socket.io'
import { verifyAccessToken } from '../utils/jwt'
import { Message }  from '../models/Message'
import { User }     from '../models/User'
import { Conversation } from '../models/Conversation'
import { Friendship } from '../models/Friendship'
import { Server } from '../models/Server'
import { Channel } from '../models/Channel'
import { Category } from '../models/Category'
import { loadAccess, channelBits, categoryOverwriteMap, channelViewOf } from '../utils/access'
import { parseOverwrites, has as hasPerm, type PermissionName } from '../permissions'
import { dmConvId, canDM } from '../controllers/messagesController'
import { wellFormed } from '../utils/wellFormed'
import * as presence from '../state/presence'
import { config }   from '../config/env'
import { MusicRooms } from './musicState'
import { ActionRate, capsFromEnv, checkChannelName, checkUrlShape } from '../utils/musicLimits'
import { musicPlay, musicPlayTrack, musicClose } from '../utils/musicService'
import { Track as LibraryTrack } from '../models/Track'
import type { Source as MusicSource } from './musicState'

// Presence (who holds a socket, who is away) lives in server/state/presence.ts
// so the User model can derive a wire-safe status without importing this file,
// which would be a cycle. A user is online while they hold AT LEAST ONE socket:
// tracking a single id meant a second tab (or the brief overlap during a
// refresh, where the new socket connects before the old one disconnects) could
// mark a live user offline — or leave a closed tab online.
export const isUserOnline = presence.isOnline
export const getOnlineUserIds = presence.onlineUserIds

// Active voice calls: LiveKit room name -> set of userIds currently in it. Lets
// members who AREN'T in the room yet see "a call is happening / who's in it"
// (header Join state + "In a call" badges) without joining the LiveKit room.
const activeCalls   = new Map<string, Set<string>>()

/**
 * Music channels, per voice room.
 *
 * Module-level and not per-socket, for the same reason activeCalls is: the
 * facts belong to the room, and every socket in it reads the same ones.
 * `onClosed` is where the music service will be told to stop decoding; until
 * that exists it only tells the room, which is the half that is testable now.
 */
/** Shared across sockets: the limit is per member, not per connection. */
const musicCaps = capsFromEnv()
const musicRate = new ActionRate(musicCaps)
// Bounded: without this the map keeps a row for everyone who ever queued.
setInterval(() => musicRate.sweep(), 60_000).unref?.()

export const musicRooms = new MusicRooms(
  musicCaps,
  (room, channelId) => {
    // Both halves, and in this order. Telling the room first means the panel
    // loses the channel immediately; telling the service is what actually
    // stops the audio, and a failure there must not stop the broadcast.
    broadcastMusic(room)
    void musicClose(room, channelId)
  },
)

/**
 * A track finished on its own: advance that channel's queue.
 *
 * Called by the music service over the internal endpoint, because only the
 * service knows when audio ran out. Quietly does nothing for a channel that
 * is already gone — the service can report an end for one the API tore down
 * a moment earlier, and that must not resurrect it.
 */
/**
 * Start whatever a queue entry turned out to be.
 *
 * A library track and a pasted link reach the service by different calls —
 * one sends an id the service resolves against our own API, the other sends
 * a URL that has to survive the SSRF guard. Everywhere that advances a queue
 * needs the same branch, so it lives here rather than three times.
 */
/**
 * Work out what a member actually asked to play, and whether they may.
 *
 * Two shapes arrive on the same events. `trackId` names something in the
 * caller's own library: it is checked against their ownership here, and the
 * audio is then read by the service from an address the service composes —
 * nothing the member typed reaches the fetcher. `url` is a pasted link, so
 * it gets the cheap text pass and then the real guard inside the service.
 *
 * The ownership check is the important half. Without it a member could name
 * any track id and have the room play a stranger's file, which is both a
 * privacy leak and a way to read a library you cannot otherwise see.
 */
const resolveSource = async (
  data: { url?: string; trackId?: string },
  userId: string,
): Promise<{ ok: true; value: MusicSource } | { ok: false; reason: string }> => {
  const trackId = String(data?.trackId ?? '').trim()
  if (trackId) {
    if (!/^[0-9a-f]{24}$/i.test(trackId)) return { ok: false, reason: 'No such track.' }
    const owned = await LibraryTrack.findOne({ _id: trackId, ownerId: userId })
    // Same answer for "does not exist" and "is not yours", so this cannot be
    // used to find out which ids exist.
    if (!owned) return { ok: false, reason: 'No such track.' }
    return { ok: true, value: { kind: 'library', trackId, title: owned.title } }
  }

  const url = checkUrlShape(data?.url)
  if (!url.ok) return { ok: false, reason: url.reason }
  return { ok: true, value: { kind: 'link', url: String(data.url).trim() } }
}

const startSource = (room: string, channelId: string, now: MusicSource): void => {
  switch (now.kind) {
    case 'library': void musicPlayTrack(room, channelId, now.trackId); break
    case 'link':    void musicPlay(room, channelId, now.url); break
    default: {
      // Exhaustiveness, and it has to be written down to be true: a switch
      // with no default compiles happily when a new kind appears and then
      // plays silence. Assigning to never is what makes the compiler object.
      const unhandled: never = now
      void unhandled
    }
  }
}

export const musicTrackEnded = (room: string, channelId: string): void => {
  if (!musicRooms.get(room, channelId)) return
  const next = musicRooms.skip(room, channelId)
  broadcastMusic(room)
  if (next.ok && next.now) startSource(room, channelId, next.now)
}

/**
 * Always the full list, never a delta — see broadcastCallState.
 *
 * The audience is worked out the same way, because the room name here is a
 * LIVEKIT room and not a Socket.IO one. Emitting to `voice:<id>` reaches
 * nobody: every member joined `chan:<id>` for that channel at connect, which
 * is a deliberately different string. A first version of this emitted to the
 * LiveKit name and silently told no one — caught by the tests, and the exact
 * confusion the voice suite warns about at the top of its own file.
 */
const musicAudience = (io: IOServer, room: string) => {
  if (room.startsWith('voice:')) return io.to(`chan:${room.slice(6)}`)
  if (room.startsWith('group:')) return io.to(room)
  const [a, b] = room.slice(3).split('_')
  return io.to(`user:${a}`).to(`user:${b}`)
}

const broadcastMusic = (room: string): void => {
  const io = getIO(); if (!io) return
  musicAudience(io, room).emit('music:state', musicRooms.view(room))
}

/**
 * What each occupant of a voice room is doing: muted, deafened, sharing.
 *
 * Keyed room -> userId -> state, deliberately parallel to `activeCalls`
 * rather than folded into it. Occupancy is a set and is read as one in a
 * dozen places; widening it to carry per-user detail would cost every one of
 * those call sites.
 *
 * The server has to be the one holding this. A client can observe the mic
 * state of people in the room IT is connected to, but a sidebar shows every
 * voice channel in the server — and deafening is a purely local decision
 * about playback that publishes no track at all, so no other client can
 * observe it however close they are. Both facts have to be told, then fanned
 * out with the occupancy that gives them meaning.
 *
 * Per ROOM, not per user: leaving a channel drops the entry, so nobody
 * carries a stale "sharing" flag into the next one they walk into.
 */
export interface VoiceMemberState { muted: boolean; deafened: boolean; sharing: boolean }
const voiceStates = new Map<string, Map<string, VoiceMemberState>>()

/** The states for a room, shaped for the wire. Omitted entirely when empty so
 *  the common case adds nothing to every call:state payload. */
const statesFor = (room: string): Record<string, VoiceMemberState> | undefined => {
  const m = voiceStates.get(room)
  if (!m || m.size === 0) return undefined
  return Object.fromEntries(m)
}

/**
 * Which media server a DM or group call settled on: room -> VoiceServer id,
 * or null for the instance's own.
 *
 * A voice CHANNEL needs nothing like this — its guild answers the question the
 * same way for everyone who asks. A DM has no guild, so the answer used to be
 * "whatever the person asking prefers", and two people with different
 * preferences would mint tokens against two different LiveKit servers, join
 * rooms of the same name on each, and hear silence while the UI showed a call
 * in progress. So the FIRST token issued for a room fixes the answer and every
 * later joiner is handed the same one.
 *
 * Lives beside activeCalls and is cleared with it: once the room is empty the
 * next call is free to land somewhere else.
 *
 * PER-PROCESS, like activeCalls itself. Two API processes would each fix their
 * own answer and reintroduce the split — the same constraint already documented
 * on the server lock in channelsController.
 */
const callVoiceServer = new Map<string, string | null>()

/** The choice already fixed for this room, or `undefined` if it is not fixed
 *  yet. `null` is a real answer (the instance's own server), so callers must
 *  test for `undefined` rather than falsiness. */
export const getCallVoiceServer = (room: string): string | null | undefined =>
  callVoiceServer.get(room)

/**
 * How long a room sits EMPTY before the call in it is declared over.
 *
 * A socket dying is not a hang-up, and the two were being treated as the same
 * event. Taking the person out of occupancy the moment their socket goes is
 * right and stays immediate — every sidebar reads occupancy, and a row for
 * somebody who is not there is the wrong a user notices first. But "the last
 * occupant left, so the call is over" is a second and much larger claim, and a
 * dropped socket is no evidence for it: the LiveKit connection is a separate
 * connection to a separate service and survives the blip untouched, so the
 * person is still in the call, still audible, still a tile on everyone's
 * stage, and `call:rejoin` puts them back within seconds.
 *
 * Concluding it immediately wrote "Call ended" into the conversation's
 * permanent history for every network hiccup — and one `pm2 restart` severs
 * every socket at once, so a single deploy announced the end of every DM and
 * group call on the instance, each of which then carried straight on with the
 * message still sitting in everybody's history.
 *
 * Long enough to cover Socket.IO's reconnect backoff and a deploy's downtime;
 * short enough that somebody who really did close their laptop stops showing
 * as in a call while anyone still cares.
 */
const CALL_END_GRACE_MS = 20_000

/**
 * Read per schedule rather than captured once, so it can be shortened: the
 * tests cannot wait twenty seconds under a twenty-second timeout, and an
 * instance whose users are mostly on flaky mobile networks may want longer.
 * Documented in .env.example. A missing or nonsensical value means the
 * default above, which is the only value any deployment needs to think about.
 */
const callEndGraceMs = (): number => {
  // Tested for emptiness BEFORE Number(), which reads '' as 0 — and .env.example
  // ships the key present and blank, so that would hand every stock install a
  // grace period of nothing and quietly restore the behaviour this removes.
  // An explicit 0 is still honoured: it is the deliberate way to opt out.
  const raw = process.env.CALL_END_GRACE_MS
  if (!raw) return CALL_END_GRACE_MS
  const ms = Number(raw)
  return Number.isFinite(ms) && ms >= 0 ? ms : CALL_END_GRACE_MS
}

/** Rooms that emptied through a dropped socket and whose end has not been
 *  concluded yet. One timer per room — re-entering the room cancels it. */
const pendingCallEnd = new Map<string, NodeJS.Timeout>()

/** Who a "Call ended" message is attributed to: the occupant whose leaving
 *  emptied the room. Passed around because the write can happen a grace period
 *  after the socket that knew these two values is gone. */
type CallAuthor = { id: string; name: string }

/**
 * Whether a room is inside its grace period — its call is still live, it has
 * simply lost every socket that was watching it.
 *
 * Exported for the tests, which assert on this directly: the absence of a
 * "Call ended" message proves nothing on its own, since it may simply not have
 * been written yet.
 */
export const callEndPending = (room: string): boolean => pendingCallEnd.has(room)

/** Stop a pending end. Every path that puts somebody INTO a room calls this:
 *  an occupied room is self-evidently not one whose call is over. */
const cancelCallEnd = (room: string): void => {
  const timer = pendingCallEnd.get(room)
  if (!timer) return
  clearTimeout(timer)
  pendingCallEnd.delete(room)
}

/**
 * Abandon every pending end without concluding any of them.
 *
 * Called from the shutdown path in server/index.ts. The timers are unref'd, so
 * an immediate exit would already skip them, but `httpServer.close()` waits
 * for open connections to end and a grace period can expire inside that wait.
 * A call this process is about to stop tracking is not a call that ended — on
 * a restart the clients come back to the NEW process and rejoin, so a parting
 * message from this one is exactly the bug the grace period exists to remove.
 */
export const cancelAllCallEnds = (): void => {
  for (const timer of pendingCallEnd.values()) clearTimeout(timer)
  pendingCallEnd.clear()
}

/**
 * Drop the occupancy and per-member state of a room that has just emptied.
 *
 * Immediate on every path, whatever is then decided about the CALL. Every
 * surface reads these two together, so state outliving its occupant renders a
 * ghost row.
 */
const forgetEmptyRoom = (room: string): void => {
  activeCalls.delete(room)
  voiceStates.delete(room)
}

/**
 * Let go of a room that is empty for good: the next call in it is free to
 * settle on a different media server, and no end is pending on it any more.
 *
 * Separate from the "Call ended" message because the two have different
 * audiences and one path wants only this half — see dropFromCall.
 */
const releaseCallRoom = (room: string): void => {
  cancelCallEnd(room)
  callVoiceServer.delete(room)
}

/** How many people are in a call room right now, and whether a given user is
 *  already one of them. Occupancy is the only thing a user limit can be checked
 *  against, and it lives here rather than in the database because a call is
 *  live state, not a record. */
export const callOccupancy = (room: string): number => activeCalls.get(room)?.size ?? 0
export const isInCall = (room: string, userId: string): boolean =>
  activeCalls.get(room)?.has(userId) ?? false

/**
 * The voice CHANNEL room this user is sitting in, or null.
 *
 * Voice moderation needs it because a moderator acts on a person, not on a
 * room: "mute them" carries no channel, and the answer is wherever they
 * currently are. Restricted to `voice:` rooms deliberately — a server mute is a
 * guild power and must not reach into somebody's DM call, which belongs to no
 * server and to no moderator.
 *
 * One room per user by construction: `call:join` adds to whichever room is
 * being joined and `leaveCall` removes it, and a client can only hold one voice
 * connection at a time. The scan is over rooms rather than users because
 * `activeCalls` is keyed that way, and a server has at most a handful live.
 */
export const voiceRoomOfUser = (userId: string): string | null => {
  for (const [room, members] of activeCalls) {
    if (room.startsWith('voice:') && members.has(userId)) return room
  }
  return null
}

/** Fix the choice for a room, if it is not fixed already. Returns what the
 *  room is now on, which is NOT necessarily what was passed. */
export const fixCallVoiceServer = (room: string, id: string | null): string | null => {
  if (!callVoiceServer.has(room)) callVoiceServer.set(room, id)
  return callVoiceServer.get(room)!
}

/** Move a room that is already fixed. Unlike `fixCallVoiceServer` this
 *  overwrites, and is only reached from the deliberate "move this call"
 *  action — never from an ordinary join, which must never relocate a call out
 *  from under the people already in it. */
export const setCallVoiceServer = (room: string, id: string | null): void => {
  callVoiceServer.set(room, id)
}

/**
 * Tell everyone IN a call that it has moved, so they rejoin.
 *
 * Addressed to the occupants through their personal rooms rather than
 * reproducing broadcastCall's prefix grammar: only people actually in the call
 * have to do anything, and `activeCalls` already knows exactly who they are.
 * People merely watching the call badge see no change, because nothing they
 * can see has changed.
 */
export const announceCallVoiceServer = (
  room: string, voiceServer: { id: string | null; name: string },
): void => {
  const io = getIO(); if (!io) return
  for (const uid of activeCalls.get(room) ?? []) {
    io.to(`user:${uid}`).emit('call:voice-server', { room, voiceServer })
  }
}

let _io: IOServer | null = null
/**
 * Which server a voice channel belongs to.
 *
 * `call:state` names its room as `voice:<channelId>`, and the client uses
 * that occupancy to mark a server in the rail as having someone in voice.
 * But the client only knows a channel's server for servers it has actually
 * opened — it fetches channels lazily — so on a fresh load it receives
 * occupancy it cannot attribute to anything.
 *
 * Sending the server id alongside costs two fields and removes the need for
 * the client to either poll or fetch every server's channel list on boot.
 * Filled as sockets connect and as channels are created; a miss is harmless
 * and simply means the payload carries no serverId.
 */
const channelServer = new Map<string, string>()
export const rememberChannelServer = (channelId: string, serverId: string): void => {
  channelServer.set(channelId, serverId)
}
export const forgetChannelServer = (channelId: string): void => {
  channelServer.delete(channelId)
}
export const getIO = (): IOServer | null => _io

/**
 * Fan a room's occupancy and per-member state out to whoever should see it.
 *
 * Hoisted out of the connection handler so voice MODERATION can reach it: a
 * moderator disconnecting somebody has to correct everyone's occupancy, and
 * they act from an HTTP request that has no socket of its own. The handler
 * delegates here rather than keeping a second copy — two implementations of
 * this fan-out would drift, and the symptom would be one surface showing a
 * person in a channel they had left.
 */
/**
 * One room's occupancy and state, shaped for `call:state`.
 *
 * Split out because `call:rejoin` answers the socket that asked as well as
 * telling the room: a socket that has just reconnected may not be back in
 * `chan:<id>` yet — the handlers are registered synchronously but the room
 * joins are in the async setup below — so a broadcast alone can arrive before
 * it is listening, and it would be the one client missing itself from the
 * list. Two builders of this payload would be two chances to drift.
 */
const callStatePayload = (room: string) => {
  const userIds = [...(activeCalls.get(room) ?? [])]
  // serverId only means anything for a voice room, and only when we know
  // it — see channelServer. The client uses it to attribute occupancy to
  // a server whose channel list it has not fetched.
  const serverId = room.startsWith('voice:') ? channelServer.get(room.slice(6)) : undefined
  const states = statesFor(room)
  return { room, userIds, ...(serverId ? { serverId } : {}), ...(states ? { states } : {}) }
}

export const broadcastCallState = (room: string): void => {
  const io = _io
  if (!io) return
  const payload = callStatePayload(room)
  if (room.startsWith('voice:')) {
    // Occupancy is server-wide news: everyone should see who is sitting in
    // a voice channel without being in it. Every member joined the socket
    // room `chan:<id>` for this channel at connect, so it is exactly the
    // right audience — note that is the SOCKET room, deliberately named
    // differently from this LiveKit room.
    io.to(`chan:${room.slice(6)}`).emit('call:state', payload)
  } else if (room.startsWith('group:')) {
    io.to(room).emit('call:state', payload)
  } else {
    // DM last, because this branch PARSES the room name and would happily
    // produce nonsense from any prefix it does not recognise.
    const [a, b] = room.slice(3).split('_')
    io.to(`user:${a}`).to(`user:${b}`).emit('call:state', payload)
  }
}

/**
 * Write "Call ended" into the conversation the room belongs to.
 *
 * Module level rather than a closure over the socket that triggered it,
 * because the write can happen a grace period after that socket is gone — so
 * there is no `userId`/`username` in scope by then, and the author has to be
 * carried in. Derives the conversation straight from the room name for the
 * same reason: the leaver's own closure state is not available to be trusted.
 */
const postCallEnded = async (room: string, author: CallAuthor) => {
  const io = _io
  if (!io) return
  // The other half of the no-system-message rule: a voice channel has no
  // text history to announce into, and the DM branch below would parse
  // `voice:<id>` into a garbage conversationId rather than refusing it.
  if (room.startsWith('voice:')) return
  try {
    const isGroup = room.startsWith('group:')
    const conversationId = isGroup ? room.slice(6) : room.slice(3)
    const msg = await Message.create({
      conversationId, kind: 'system', systemType: 'call',
      authorId: author.id, authorName: author.name, authorAvatar: null, content: 'Call ended',
    })
    const payload = {
      _id: msg._id.toString(), conversationId, kind: 'system', systemType: 'call',
      authorId: author.id, authorName: author.name, authorAvatar: null, content: 'Call ended',
      reactions: [], pinned: false, edited: false, replyTo: null,
      createdAt: msg.createdAt.toISOString(),
    }
    if (isGroup) io.to(room).emit('group:receive', payload)
    else { const [a, b] = conversationId.split('_'); io.to(`user:${a}`).to(`user:${b}`).emit('dm:receive', payload) }
  } catch (err) { console.error('[WS] postCallEnded', err) }
}

/**
 * Conclude, after the grace period, that the call in an emptied room is over.
 *
 * Scheduled only from the dropped-socket path. A deliberate `call:leave` and a
 * moderator's eviction both end the call on the spot — they are evidence about
 * the person, not about the network — and only a socket vanishing leaves the
 * question genuinely open.
 */
const scheduleCallEnd = (room: string, author: CallAuthor): void => {
  cancelCallEnd(room)
  const timer = setTimeout(() => {
    pendingCallEnd.delete(room)
    // Belt and braces: every path that re-enters a room cancels this timer, so
    // arriving here with occupants would be a bug — and the cost of being
    // wrong is a message in somebody's history that nothing ever takes back.
    if ((activeCalls.get(room)?.size ?? 0) > 0) return
    releaseCallRoom(room)
    void postCallEnded(room, author)
  }, callEndGraceMs())
  /*
   * Unref'd deliberately, and not only so a pending end cannot hold a
   * shutdown open for the whole grace period: a process on its way out must
   * NOT write "Call ended". `pm2 restart` is the case that matters — every
   * socket drops, every room empties, and the clients come back to the new
   * process and rejoin there. See cancelAllCallEnds, which closes the window
   * where the exit is slow enough for a grace period to expire inside it.
   */
  timer.unref?.()
  pendingCallEnd.set(room, timer)
}

/**
 * Remove somebody from a call from OUTSIDE their own socket.
 *
 * The ordinary path is `call:leave`, which only ever deletes the caller's own
 * id. This is the moderated path, and it has to exist separately: LiveKit
 * having evicted a participant does not tell this process anything, so without
 * it the person would sit in every sidebar as a ghost occupant until their
 * socket happened to disconnect.
 *
 * Emptying a room THIS way ends the call immediately, with no grace period. A
 * moderator removing the last person is not a network blip — it is the one
 * case where somebody has decided the person is out, and there is nobody left
 * to come back. The grace period exists because a dropped socket is no
 * evidence a call ended; an eviction is precisely that evidence.
 */
export const dropFromCall = (room: string, userId: string): boolean => {
  const set = activeCalls.get(room)
  if (!set || !set.has(userId)) return false
  set.delete(userId)
  const st = voiceStates.get(room)
  if (st) { st.delete(userId); if (st.size === 0) voiceStates.delete(room) }
  if (set.size === 0) {
    forgetEmptyRoom(room)
    /*
     * The room is released but nothing is announced, which is also why this
     * needs no author. Every caller derives the room from a channel — and
     * voiceRoomOfUser, which the other one asks, answers for `voice:` rooms
     * only — so this path only ever sees a voice channel, and a voice channel
     * has no text history for a system message to land in. A caller that ever
     * brings a dm: or group: room here has to decide who the message is from
     * before it can be written.
     */
    releaseCallRoom(room)
  }
  broadcastCallState(room)
  return true
}

// Helper: get partner ID from a DM conversationId
const getPartner = (convId: string, myId: string) =>
  convId.split('_').find(p => p !== myId) ?? null

/**
 * May this user touch this message at all?
 *
 * Pin and react previously had no check whatsoever — findById, mutate, save —
 * so any authenticated user could pin or react to ANY message in the database
 * by id, including DMs between other people. Mongo ObjectIds embed a timestamp
 * and counter, so they enumerate; this was not protected by obscurity.
 *
 * Edit and delete were fine because they check authorship, but authorship is
 * the wrong test for pin/react: both are things a participant may legitimately
 * do to someone else's message. The right test is membership of the
 * conversation, which is what this does.
 */
const canAccessMessage = async (msg: { conversationId: string; kind: string }, userId: string) => {
  if (msg.kind === 'group') {
    const group = await Conversation.findById(msg.conversationId).select('members').lean()
    return !!group && group.members.some(m => m.toString() === userId)
  }
  if (msg.kind === 'channel') {
    // A channel has no member list of its own — access follows the server's
    // membership. Without this branch, a channel message fell through to
    // the DM check below: its conversationId is a bare ObjectId with no
    // underscore, so split('_').includes(userId) was always false and
    // pin/react were permanently "Not allowed" in every channel.
    const channel = await Channel.findById(msg.conversationId).select('server').lean()
    if (!channel) return false
    const server = await Server.findById(channel.server).select('members').lean()
    return !!server && server.members.some(m => m.toString() === userId)
  }
  // DM/system: the conversationId is the two participant ids joined, so
  // membership is simply being one of them.
  return msg.conversationId.split('_').includes(userId)
}

/**
 * Effective channel permissions for the conversation a message lives in.
 *
 * `canAccessMessage` above answers "may you see this at all", which for a
 * channel is server membership. That is not enough for the actions that go
 * beyond reading: reacting, pinning and deleting somebody else's message are
 * each their own permission, and each can be granted or denied by a channel
 * overwrite.
 *
 * Returns null for a DM or a group, which have no overwrites and no roles —
 * callers read null as "not a channel, so channel permissions do not apply"
 * rather than as a denial.
 *
 * Four queries, and deliberately not cached: a permission read from a stale
 * cache is a permission that keeps working after it was taken away. Reactions
 * are the hottest caller and are still a human clicking a button.
 */
const channelPermsFor = async (
  msg: { conversationId: string; kind: string }, userId: string,
): Promise<bigint | null> => {
  if (msg.kind !== 'channel') return null
  const channel = await Channel.findById(msg.conversationId)
    .select('server category overwrites').lean()
  if (!channel) return null
  const server = await Server.findById(channel.server)
  if (!server) return null
  const access = await loadAccess(server, userId)
  const cat = (channel as any).category
    ? await Category.findById((channel as any).category).select('overwrites').lean()
    : null
  return channelBits(
    access,
    parseOverwrites((cat as any)?.overwrites),
    parseOverwrites((channel as any).overwrites),
  )
}

/**
 * Whether a channel action is allowed, for a handler that may also be serving
 * a DM or a group.
 *
 * `null` bits mean the message is not in a channel, and every one of these
 * permissions is a guild concept — nobody administers a DM, so nothing there
 * is denied on these grounds.
 */
const allowsInChannel = (bits: bigint | null, perm: PermissionName): boolean =>
  bits === null || hasPerm(bits, perm)

/**
 * May this user actually be added to this call's occupancy?
 *
 * `call:join` used to run no check at all: an authenticated user naming ANY
 * channel or group id landed in `activeCalls` and was broadcast to every real
 * member of that server or group, with no way for anyone to evict the
 * phantom occupant afterwards — `leaveCall` only ever removes the caller.
 *
 * Every branch mirrors the checks `getVoiceToken` (voiceController.ts)
 * already runs for `POST /voice/token`, rather than inventing a second,
 * possibly-different set of rules for the socket path:
 *
 *   - channel: Channel -> Server -> members (same resolution as
 *     `canAccessMessage`'s channel branch above), AND `channel.type ===
 *     'voice'`. Without the type check, a member could name a TEXT channel:
 *     they could never actually join its LiveKit room, but `voice:<id>` still
 *     entered `activeCalls` and `call:state` fanned out to `chan:<id>` —
 *     every member of the server — as permanent phantom occupancy in a
 *     channel that can never display it, with nothing to ever evict it.
 *   - dm: the named partner must be a real user, and must not be the caller.
 *     Without this, `callRoom`'s dm branch — `dm:${dmConvId(userId,
 *     convId)}` — happily builds a room from ANY string, and
 *     `postCallSystem`/`postCallEnded` write a real `Message` into it
 *     (`dmConvId(userId, junk)`) and emit to `user:<junk>`. Looped, that is
 *     unbounded database growth driven by one authenticated client. Whether
 *     two real, distinct people are allowed to ring each other at all
 *     (friendship, DND, etc.) is a separate product question this event
 *     never enforced before and is out of scope here.
 *   - group: Conversation -> members, same as `canAccessMessage`'s group
 *     branch above.
 *
 * Any lookup failure (malformed id, doc deleted mid-flight) reads as "not
 * allowed" rather than throwing out of a handler with no surrounding
 * try/catch.
 */
const canJoinCall = async (
  kind: 'dm' | 'group' | 'channel', conversationId: string, userId: string,
): Promise<boolean> => {
  try {
    if (kind === 'channel') {
      const channel = await Channel.findById(conversationId).select('server type').lean()
      if (!channel || channel.type !== 'voice') return false
      const server = await Server.findById(channel.server).select('members').lean()
      return !!server && server.members.some(m => m.toString() === userId)
    }
    if (kind === 'dm') {
      if (conversationId === userId) return false
      const partner = await User.findById(conversationId).select('_id').lean()
      return !!partner
    }
    const group = await Conversation.findById(conversationId).select('members').lean()
    return !!group && group.members.some(m => m.toString() === userId)
  } catch {
    return false
  }
}

/**
 * Everyone entitled to hear this user's presence: their accepted friends,
 * plus everyone who shares a server with them — deduplicated, minus the
 * user themselves.
 *
 * Queried fresh on every call rather than cached in the connection closure.
 * The old closure was computed once at connect and never touched again, so
 * a server membership change made mid-connection (someone else joining or
 * leaving a shared server) left it silently wrong for the rest of the
 * socket's life — the exact bug this replaces. Presence events (connect,
 * disconnect, status change, idle toggle) are rare enough that two indexed
 * queries at emit time is a negligible cost at this app's scale, and this
 * removes the entire staleness class rather than adding cache-invalidation
 * hooks that would have to be remembered at every future membership-changing
 * call site (join, leave, kick, server delete, ...).
 *
 * `knownServers`, when given, is a `Server.find({ members: userId })` result
 * the caller already ran for another purpose (connect-time channel-room
 * joining does exactly this query) so this doesn't run it a second time.
 */
const presenceAudience = async (
  userId: string,
  knownServers?: { members: unknown[] }[],
): Promise<string[]> => {
  const fr = await Friendship.find({
    status: 'accepted',
    $or: [{ requester: userId }, { receiver: userId }],
  }).select('requester receiver').lean()
  const friendIds = fr.map(f =>
    f.requester.toString() === userId ? f.receiver.toString() : f.requester.toString())

  const servers = knownServers ?? await Server.find({ members: userId }).select('members').lean()
  const coMemberIds = servers.flatMap(s => s.members.map(m => (m as any).toString()))

  return [...new Set([...friendIds, ...coMemberIds])].filter(id => id !== userId)
}

// Resolve a list of parent message ids into reply previews, preserving order
// and dropping any that no longer exist. `conversationId` is required, not
// optional — every call site knows exactly which conversation it's building
// a message for, and an optional scope here is one forgotten call site away
// from reopening the same leak: a crafted replyToIds naming a message in
// someone else's DM would otherwise resolve and echo that message's author +
// a content snippet into whatever conversation the caller chose.
const buildReplyPreviews = async (ids: string[] | undefined, conversationId: string) => {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const targets = await Message.find({ _id: { $in: ids }, conversationId }).select('authorName content').lean()
  const byId = new Map(targets.map(t => [t._id.toString(), t]))
  return ids
    .map(id => byId.get(id))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map(t => ({ id: t._id.toString(), author: t.authorName, content: t.content.slice(0, 80) }))
}

export const initSocket = (httpServer: HttpServer): IOServer => {
  const io = new IOServer(httpServer, {
    cors: { origin: config.cors.clientOrigin, credentials: true },
    transports: ['websocket', 'polling'],
    // Detect dead connections in ~15s instead of the ~45s default, so a killed
    // tab or dropped network stops showing the user as online for so long.
    pingInterval: 10000,
    pingTimeout: 5000,
  })
  _io = io

  // Connectivity is in-memory, so a restart clears it for free — there is no
  // longer any stale presence to scrub from the database.
  //
  // What DOES need scrubbing is the legacy value: 'offline' used to be written
  // into `status`, which now means "the user's choice" and has no such option.
  // Rows left that way would be stuck outside the enum, so they become
  // 'online' (the default choice) once, on the first boot after this ships.
  void User.updateMany({ status: { $nin: presence.CHOSEN_STATUSES } }, { $set: { status: 'online' } })
    .then(r => { if (r.modifiedCount) console.log(`[WS] migrated ${r.modifiedCount} user(s) to a chosen status`) })
    .catch(err => console.error('[WS] status migration failed', err))

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) return next(new Error('No token'))
    try {
      const p = verifyAccessToken(token)
      ;(socket as any).userId   = p.sub
      ;(socket as any).username = p.username
      next()
    } catch { next(new Error('Invalid token')) }
  })

  io.on('connection', async (socket: Socket) => {
    const userId   = (socket as any).userId   as string
    const username = (socket as any).username as string
    console.log(`[WS] + ${username}`)

    const wasOffline = presence.addSocket(userId, socket.id)
    socket.join(`user:${userId}`)

    /*
     * These are filled in by the async setup at the bottom of this callback,
     * but they must EXIST before the socket.on(...) handlers are registered.
     *
     * Handler registration used to happen after two awaits, which left a window
     * between the client's `connect` event and any listener existing. Anything
     * emitted in that window hit no handler at all: silently dropped, ack never
     * fired. It cost a message on every fresh connection that sent immediately,
     * and during the security sweep it faked two "safe" results by swallowing
     * the probe's first event.
     *
     * Handlers read these at call time, so a message arriving in the first few
     * milliseconds gets a null avatar and the JWT's username rather than being
     * lost — a far better failure than silence.
     */
    let myAvatar: string | null = null
    let myAvatarCrop: { zoom: number; x: number; y: number } | null = null
    let myName = username
    let myGroups: { _id: any }[] = []
    // The user's CHOSEN status, read once at connect. Kept here so the
    // presence handlers below can re-derive what friends should see without a
    // database round-trip on every idle flicker.
    let myStatus: presence.ChosenStatus = 'online'
    // The chosen status's end, carried beside the choice itself. Held per
    // socket for the same reason myStatus is: effectiveStatus needs both on
    // every broadcast, and re-reading the row on each one would be a database
    // round trip per presence event.
    let myStatusUntil: Date | null = null
    // The connect-time load below runs after several awaits. A presence:set
    // that lands inside that window must win over the stale row the load
    // read before it — this flag is how the load knows it lost the race.
    let statusTouched = false

    // ── Send DM ───────────────────────────────────────────────────────────
    socket.on('dm:send', async (data: {
      partnerId: string; content: string
      authorName: string; replyToIds?: string[]
    }, ack) => {
      try {
        if (!data.content?.trim()) { ack?.({ ok: false, error: 'Empty' }); return }
        if (!await canDM(userId, data.partnerId)) {
          ack?.({ ok: false, error: 'Not allowed' }); return
        }
        const conversationId = dmConvId(userId, data.partnerId)
        // Resolved once (scoped to this DM), then reused for both what gets
        // persisted and what goes out in the payload — a reply id naming a
        // message outside this conversation is dropped from both, not merely
        // hidden from the response while still sitting in the stored doc.
        const replyTo = await buildReplyPreviews(data.replyToIds, conversationId)
        const msg = await Message.create({
          conversationId,
          kind:           'dm',
          authorId:       userId,
          // Server-side name, never the client's. data.authorName let a sender
          // attribute its own message to "Skycord System" or to someone else.
          authorName:     myName,
          authorAvatar:   myAvatar,
          authorAvatarCrop: myAvatarCrop,
          content:        wellFormed(data.content.trim()),
          replyToIds:     replyTo.map(r => r.id),
        })
        const payload = {
          _id:            msg._id.toString(),
          conversationId: msg.conversationId,
          authorId:       userId,
          authorName:     msg.authorName,
          authorAvatar:   msg.authorAvatar,
          content:        msg.content,
          reactions:      [],
          pinned:         false,
          edited:         false,
          replyTo,
          createdAt:      msg.createdAt.toISOString(),
        }
        io.to(`user:${data.partnerId}`).emit('dm:receive', payload)
        if (/@everyone\b/.test(msg.content)) io.to(`user:${data.partnerId}`).emit('mention:everyone', { conversationId: msg.conversationId, authorName: msg.authorName })
        ack?.({ ok: true, message: payload })
      } catch (err) {
        console.error('[WS] dm:send', err)
        ack?.({ ok: false, error: 'Failed' })
      }
    })

    // ── Edit message ───────────────────────────────────────────────────────
    socket.on('message:edit', async (data: {
      messageId: string; content: string
    }, ack) => {
      try {
        const msg = await Message.findById(data.messageId)
        if (!msg)                              { ack?.({ ok: false, error: 'Not found' });   return }
        if (msg.authorId.toString() !== userId){ ack?.({ ok: false, error: 'Not allowed' }); return }

        msg.content = wellFormed(data.content.trim())
        msg.edited  = true
        await msg.save()

        const payload = { messageId: msg._id.toString(), content: msg.content }

        // Channel routing goes first and stands alone: getPartner assumes a
        // DM-shaped "id1_id2" conversationId, but a channel's is a bare
        // ObjectId. Calling it anyway returns that whole id back as a
        // truthy-but-bogus "partner", which would route this into a
        // phantom `user:<channelId>` room instead of `chan:<channelId>` —
        // reaching nobody. DM and group routing below are untouched.
        if (msg.kind === 'channel') {
          io.to(`chan:${msg.conversationId}`).except(`user:${userId}`).emit('message:edited', payload)
        } else {
          const partner = getPartner(msg.conversationId, userId)
          if (partner) io.to(`user:${partner}`).emit('message:edited', payload)
          else if (msg.kind === 'group') socket.to(`group:${msg.conversationId}`).emit('message:edited', payload)
        }
        ack?.({ ok: true })
      } catch (err) {
        console.error('[WS] message:edit', err)
        ack?.({ ok: false, error: 'Failed' })
      }
    })

    // ── Delete message ─────────────────────────────────────────────────────
    socket.on('message:delete', async (data: { messageId: string }, ack) => {
      try {
        const msg = await Message.findById(data.messageId)
        if (!msg)                              { ack?.({ ok: false, error: 'Not found' });   return }
        /*
         * Your own message, always. Somebody else's needs Manage Messages, and
         * only in a channel — the other half of that permission's description
         * and, until now, the half that did not exist: deleting another
         * person's message was impossible for everyone including the owner, so
         * a channel could not actually be moderated.
         *
         * Note this is DELETE only. `message:edit` above keeps the flat author
         * check and must keep it: putting words in someone's mouth is not
         * moderation, and no permission should buy it.
         */
        if (msg.authorId.toString() !== userId) {
          // Access first, so a stranger naming a random id cannot tell an
          // existing message apart from a missing one — both answer the same.
          if (!await canAccessMessage(msg, userId)) {
            ack?.({ ok: false, error: 'Not allowed' }); return
          }
          const bits = await channelPermsFor(msg, userId)
          // null means a DM or group. No moderator exists there, so somebody
          // else's message is simply not yours to delete.
          if (bits === null || !hasPerm(bits, 'ManageMessages')) {
            ack?.({ ok: false, error: 'Not allowed' }); return
          }
        }

        const partner = getPartner(msg.conversationId, userId)
        const isGroup = msg.kind === 'group'
        const isChannel = msg.kind === 'channel'
        const conversationId = msg.conversationId
        await msg.deleteOne()

        const payload = { messageId: data.messageId }
        // See message:edit above for why channel routing can't go through
        // getPartner and must be checked first.
        if (isChannel) io.to(`chan:${conversationId}`).except(`user:${userId}`).emit('message:deleted', payload)
        else if (partner) io.to(`user:${partner}`).emit('message:deleted', payload)
        else if (isGroup) socket.to(`group:${conversationId}`).emit('message:deleted', payload)
        ack?.({ ok: true })
      } catch (err) {
        console.error('[WS] message:delete', err)
        ack?.({ ok: false, error: 'Failed' })
      }
    })

    // ── Pin / Unpin message ────────────────────────────────────────────────
    socket.on('message:pin', async (data: { messageId: string; pinned: boolean }, ack) => {
      try {
        const msg = await Message.findById(data.messageId)
        if (!msg) { ack?.({ ok: false, error: 'Not found' }); return }
        if (!await canAccessMessage(msg, userId)) {
          ack?.({ ok: false, error: 'Not allowed' }); return
        }
        /*
         * Pinning was open to everyone who could see the channel — any member
         * could pin or unpin anything, including unpinning what a moderator had
         * pinned. In a DM or a group it stays open, deliberately: there is no
         * moderator there and a pin is a shared bookmark between the people in
         * the conversation.
         */
        if (!allowsInChannel(await channelPermsFor(msg, userId), 'ManageMessages')) {
          ack?.({ ok: false, error: 'You need Manage Messages to pin here' }); return
        }

        msg.pinned = data.pinned
        await msg.save()

        const payload = { messageId: msg._id.toString(), pinned: msg.pinned }

        // See message:edit above for why channel routing can't go through
        // getPartner and must be checked first.
        if (msg.kind === 'channel') {
          io.to(`chan:${msg.conversationId}`).except(`user:${userId}`).emit('message:pinned', payload)
        } else {
          const partner = getPartner(msg.conversationId, userId)
          if (partner) io.to(`user:${partner}`).emit('message:pinned', payload)
          else if (msg.kind === 'group') socket.to(`group:${msg.conversationId}`).emit('message:pinned', payload)
        }
        ack?.({ ok: true })
      } catch (err) {
        console.error('[WS] message:pin', err)
        ack?.({ ok: false, error: 'Failed' })
      }
    })

    // ── React to message ───────────────────────────────────────────────────
    socket.on('message:react', async (data: { messageId: string; emoji: string }, ack) => {
      try {
        const msg = await Message.findById(data.messageId)
        if (!msg) { ack?.({ ok: false, error: 'Not found' }); return }
        // Without this, the ack below also leaked the userIds of everyone who
        // reacted to any message an attacker could name.
        if (!await canAccessMessage(msg, userId)) {
          ack?.({ ok: false, error: 'Not allowed' }); return
        }

        // An emoji is a handful of codepoints. Unbounded, this field accepted
        // arbitrary strings of arbitrary length straight into the document.
        const emoji = wellFormed(String(data.emoji ?? ''))
        if (!emoji || [...emoji].length > 8) { ack?.({ ok: false, error: 'Invalid emoji' }); return }
        if (msg.reactions.length >= 40 && !msg.reactions.some(r => r.emoji === emoji)) {
          ack?.({ ok: false, error: 'Too many reactions' }); return
        }

        const existing  = msg.reactions.find(r => r.emoji === emoji)

        /*
         * AddReactions gates STARTING a reaction, not joining one.
         *
         * That asymmetry is the permission's actual meaning and it is what the
         * settings copy promises: clicking a reaction somebody else already put
         * there needs nothing. Removing your own never needs anything either —
         * a permission that could trap your reaction on a message would be a
         * strange thing to hand anyone.
         */
        const startingNew = !existing
        if (startingNew) {
          const bits = await channelPermsFor(msg, userId)
          if (!allowsInChannel(bits, 'AddReactions')) {
            ack?.({ ok: false, error: 'You cannot add new reactions here' }); return
          }
        }

        if (existing) {
          const hasReacted = existing.userIds.some(id => id.toString() === userId)
          if (hasReacted) {
            existing.userIds = existing.userIds.filter(id => id.toString() !== userId)
            if (existing.userIds.length === 0) {
              msg.reactions = msg.reactions.filter(r => r.emoji !== emoji)
            }
          } else {
            existing.userIds.push(userId as any)
          }
        } else {
          msg.reactions.push({ emoji, userIds: [userId as any] })
        }
        await msg.save()

        // Build public reaction payload (counts + whether current user reacted)
        const reactions = msg.reactions.map(r => ({
          emoji:   r.emoji,
          count:   r.userIds.length,
          userIds: r.userIds.map(id => id.toString()),
        }))

        const payload = { messageId: msg._id.toString(), reactions, reactorId: userId }

        // See message:edit above for why channel routing can't go through
        // getPartner and must be checked first.
        if (msg.kind === 'channel') {
          io.to(`chan:${msg.conversationId}`).except(`user:${userId}`).emit('message:reacted', payload)
        } else {
          const partner = getPartner(msg.conversationId, userId)
          if (partner) io.to(`user:${partner}`).emit('message:reacted', payload)
          else if (msg.kind === 'group') socket.to(`group:${msg.conversationId}`).emit('message:reacted', payload)
        }
        ack?.({ ok: true, reactions })
      } catch (err) {
        console.error('[WS] message:react', err)
        ack?.({ ok: false, error: 'Failed' })
      }
    })

    // ── Reply to message ───────────────────────────────────────────────────
    socket.on('dm:reply', async (data: {
      partnerId:    string
      content:      string
      replyToIds:   string[]
      authorName:   string
    }, ack) => {
      try {
        if (!data.content?.trim()) { ack?.({ ok: false, error: 'Empty' }); return }
        if (!await canDM(userId, data.partnerId)) {
          ack?.({ ok: false, error: 'Not allowed' }); return
        }

        const conversationId = dmConvId(userId, data.partnerId)
        const replyTo = await buildReplyPreviews(data.replyToIds, conversationId)
        const msg = await Message.create({
          conversationId,
          kind:           'dm',
          authorId:       userId,
          authorName:     myName,
          authorAvatar:   myAvatar,
          authorAvatarCrop: myAvatarCrop,
          content:        wellFormed(data.content.trim()),
          replyToIds:     replyTo.map(r => r.id),
        })

        const payload = {
          _id:            msg._id.toString(),
          conversationId: msg.conversationId,
          authorId:       userId,
          authorName:     msg.authorName,
          authorAvatar:   msg.authorAvatar,
          content:        msg.content,
          reactions:      [],
          pinned:         false,
          edited:         false,
          replyTo,
          createdAt: msg.createdAt.toISOString(),
        }

        io.to(`user:${data.partnerId}`).emit('dm:receive', payload)
        if (/@everyone\b/.test(msg.content)) io.to(`user:${data.partnerId}`).emit('mention:everyone', { conversationId: msg.conversationId, authorName: msg.authorName })
        ack?.({ ok: true, message: payload })
      } catch (err) {
        console.error('[WS] dm:reply', err)
        ack?.({ ok: false, error: 'Failed' })
      }
    })

    // ── Send group message ──────────────────────────────────────────────────
    socket.on('group:send', async (data: {
      groupId: string; content: string; authorName: string; replyToIds?: string[]
    }, ack) => {
      try {
        if (!data.content?.trim()) { ack?.({ ok: false, error: 'Empty' }); return }

        // Membership check — can't post to a group you're not in, even if you
        // somehow know its id.
        const group = await Conversation.findById(data.groupId)
        if (!group || !group.members.some(m => m.toString() === userId)) {
          ack?.({ ok: false, error: 'Not a member' }); return
        }

        const replyTo = await buildReplyPreviews(data.replyToIds, data.groupId)
        const msg = await Message.create({
          conversationId: data.groupId,
          kind:           'group',
          authorId:       userId,
          authorName:     myName,
          authorAvatar:   myAvatar,
          authorAvatarCrop: myAvatarCrop,
          content:        wellFormed(data.content.trim()),
          replyToIds:     replyTo.map(r => r.id),
        })

        // Bump lastMessageAt so the group sorts to the top of conversation lists.
        group.lastMessageAt = msg.createdAt
        await group.save()

        const payload = {
          _id:            msg._id.toString(),
          conversationId: data.groupId,
          authorId:       userId,
          authorName:     msg.authorName,
          authorAvatar:   myAvatar,
          authorAvatarCrop: myAvatarCrop,
          content:        msg.content,
          reactions:      [],
          pinned:         false,
          edited:         false,
          replyTo,
          createdAt:      msg.createdAt.toISOString(),
        }

        // Broadcast to the rest of the group room — NOT the sender, who already
        // shows an optimistic copy (mirrors how dm:send only emits to the
        // partner). Emitting to the sender too caused every group message to
        // render twice for the author.
        socket.to(`group:${data.groupId}`).emit('group:receive', payload)
        if (/@everyone\b/.test(msg.content)) socket.to(`group:${data.groupId}`).emit('mention:everyone', { conversationId: data.groupId, authorName: msg.authorName })
        ack?.({ ok: true, message: payload })
      } catch (err) {
        console.error('[WS] group:send', err)
        ack?.({ ok: false, error: 'Failed' })
      }
    })

    // ── Join a group room mid-session ───────────────────────────────────────
    // Called by the client when it learns it's been added to a new group
    // (via group:created / group:updated), so the user starts receiving that
    // group's messages immediately instead of only after a reconnect.
    socket.on('group:subscribe', async (data: { groupId: string }) => {
      const group = await Conversation.findById(data.groupId).select('members').lean()
      if (group && group.members.some(m => m.toString() === userId)) {
        socket.join(`group:${data.groupId}`)
      }
    })

    // ── Typing ─────────────────────────────────────────────────────────────
    socket.on('typing:start', (data: { partnerId: string }) => {
      io.to(`user:${data.partnerId}`).emit('typing:start', { userId, username })
    })
    socket.on('typing:stop', (data: { partnerId: string }) => {
      io.to(`user:${data.partnerId}`).emit('typing:stop', { userId })
    })

    // ── Voice call presence ──────────────────────────────────────────────────
    // The browser joins the LiveKit room directly; these events only track WHO is
    // in a call so everyone else can see it. Room names mirror voiceController's
    // roomFor EXACTLY — if the two ever disagree, two people each believe they
    // are in a call together while sitting in different LiveKit rooms, and
    // nothing errors anywhere. A server voice channel is `voice:<channelId>`,
    // deliberately NOT `chan:<channelId>`, which is the Socket.IO room carrying
    // that same channel's text traffic (see broadcastCall below).
    const callRoom = (kind: 'dm' | 'group' | 'channel', convId: string) =>
      kind === 'channel' ? `voice:${convId}`
      : kind === 'group' ? `group:${convId}`
      : `dm:${dmConvId(userId, convId)}`

    const joinedCallRooms = new Set<string>()

    // Delegates to the module-level implementation, which voice moderation also
    // calls — see broadcastCallState.
    const broadcastCall = (room: string) => broadcastCallState(room)

    // Never called for a channel — the parameter type is the guard, and the one
    // call site narrows `kind` before reaching here. A voice channel has no
    // readable text history for a system message to land in.
    const postCallSystem = async (kind: 'dm' | 'group', convId: string, content: string) => {
      const conversationId = kind === 'group' ? convId : dmConvId(userId, convId)
      const msg = await Message.create({
        conversationId, kind: 'system', systemType: 'call',
        authorId: userId, authorName: username, authorAvatar: null, content,
      })
      const payload = {
        _id: msg._id.toString(), conversationId, kind: 'system', systemType: 'call',
        authorId: userId, authorName: username, authorAvatar: null, content,
        reactions: [], pinned: false, edited: false, replyTo: null,
        createdAt: msg.createdAt.toISOString(),
      }
      if (kind === 'group') io.to(`group:${convId}`).emit('group:receive', payload)
      else { const [a, b] = conversationId.split('_'); io.to(`user:${a}`).to(`user:${b}`).emit('dm:receive', payload) }
    }

    // Who a "Call ended" from this socket is attributed to. Captured once,
    // because the write may happen a grace period after this socket is gone.
    const me: CallAuthor = { id: userId, name: username }

    /**
     * Take this socket's user out of a call room.
     *
     * No membership check here, deliberately: this only ever deletes the
     * CALLER's own id from the room's Set (`set.has(userId)` guards that), so
     * it cannot forge or evict anyone else's occupancy. Once call:join is
     * guarded above, a caller can only ever be in a room they were let into,
     * so there is nothing left for a leave-side check to catch.
     *
     * `cause` is the whole of the difference between ending the call now and
     * ending it after a grace period, and it is a required argument so that a
     * third caller has to say which it is rather than inherit a default.
     * A `call:leave` is a person deciding to leave. A `disconnect` is a socket
     * vanishing, which says nothing at all about whether the person is still
     * in the LiveKit room — usually they are, and are back in seconds.
     */
    const leaveCall = (room: string, cause: 'hang-up' | 'socket-lost') => {
      const set = activeCalls.get(room)
      if (!set || !set.has(userId)) return
      set.delete(userId)
      // Leaving the call leaves its music too. Not a teardown: the channel
      // keeps its own grace period, so coming straight back finds it playing.
      if (musicRooms.forget(userId).includes(room)) broadcastMusic(room)
      // State outliving its occupant would render a ghost row: every client
      // reads occupancy and state together.
      const st = voiceStates.get(room)
      if (st) { st.delete(userId); if (st.size === 0) voiceStates.delete(room) }
      joinedCallRooms.delete(room)
      if (set.size === 0) {
        // Occupancy goes at once whichever this was. The sidebars have to stay
        // honest about who is there, and only the CALL's fate is in question.
        forgetEmptyRoom(room)
        if (cause === 'hang-up') {
          releaseCallRoom(room)
          void postCallEnded(room, me)
        } else {
          scheduleCallEnd(room, me)
        }
      }
      broadcastCall(room)
    }

    /**
     * Report what you are doing in the call you are in.
     *
     * Carries no user id on purpose: the socket already knows who is
     * speaking, and accepting one would let any client mute anyone. It also
     * names no room — you can only be in one voice room at a time from a
     * given socket, and taking a room from the payload would let a client
     * write state into a channel it never joined.
     */
    socket.on('voice:state', (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return
      // The one voice room this socket is actually in. Nothing to describe
      // otherwise, and nowhere to broadcast it.
      const room = [...joinedCallRooms].find(r => r.startsWith('voice:'))
      if (!room || !activeCalls.get(room)?.has(userId)) return

      const r = raw as Record<string, unknown>
      // Coerced, not trusted: a missing flag means false rather than
      // undefined, so the wire shape is the same for every occupant.
      const next: VoiceMemberState = {
        muted:    !!r.muted,
        deafened: !!r.deafened,
        sharing:  !!r.sharing,
      }
      let m = voiceStates.get(room)
      if (!m) { m = new Map(); voiceStates.set(room, m) }
      const prev = m.get(userId)
      // A client that re-reports an unchanged state (a reconnect, a
      // redundant mute) must not fan a payload out to the whole channel.
      if (prev && prev.muted === next.muted && prev.deafened === next.deafened
          && prev.sharing === next.sharing) return
      m.set(userId, next)
      broadcastCall(room)
    })
    socket.on('call:join', async (data: { conversationId: string; kind: 'dm' | 'group' | 'channel' }) => {
      if (!data?.conversationId || (data.kind !== 'dm' && data.kind !== 'group' && data.kind !== 'channel')) return
      // Refuse silently, same shape every other handler in this file uses for
      // "not allowed" — no ack is expected on this event, so there is nothing
      // to report back beyond simply not joining.
      if (!await canJoinCall(data.kind, data.conversationId, userId)) return
      const room = callRoom(data.kind, data.conversationId)
      let set = activeCalls.get(room)
      const wasEmpty = !set || set.size === 0
      /*
       * A room inside its grace period is not an empty room: its call is still
       * live, it has just lost every socket that was watching it. So somebody
       * arriving now is joining that call rather than starting a new one, and
       * two things follow. No second "X started a call" — the conversation was
       * told once and nothing has contradicted it. And the media server the
       * call settled on is KEPT rather than released, because whoever dropped
       * may still be sitting in the LiveKit room on it, and letting the new
       * arrival land somewhere else would split the call in two.
       *
       * The ordinary reconnect never reaches here — it uses call:rejoin. This
       * is the client that gave up and came back in through the front door.
       */
      const resuming = callEndPending(room)
      cancelCallEnd(room)
      if (!set) { set = new Set(); activeCalls.set(room, set) }
      set.add(userId)
      joinedCallRooms.add(room)
      // No "X started a call" for a voice channel: there is no text history
      // there to read it in, so the Message would only ever be dead weight in
      // a conversation nobody can open. Narrowing here is also what keeps
      // postCallSystem's signature honest.
      if (wasEmpty && !resuming && data.kind !== 'channel') {
        await postCallSystem(data.kind, data.conversationId, `${username} started a call`)
      }
      broadcastCall(room)
    })

    /**
     * Put somebody back in the occupancy their socket took with it.
     *
     * A dropped socket empties this person out of every call: the disconnect
     * handler runs `leaveCall` for each room it held, and every sidebar in
     * the instance loses them at once. Their LiveKit connection is a separate
     * connection to a separate service and survives the blip untouched — they
     * are still in the call, still audible, still a tile on everyone's stage.
     * Socket.IO then reconnects with a NEW socket whose `joinedCallRooms` is
     * empty, and nothing used to refill it. The stage and the sidebar
     * disagreed from that moment until the person left for real.
     *
     * A single `pm2 restart` severs every socket at once, so one deploy could
     * empty every voice channel in the instance while every call carried on.
     *
     * Deliberately NOT a flag on `call:join`. The two differ in what they must
     * not do: a rejoin is not the start of a call, so it posts no "X started a
     * call" — after an API restart that would announce every call in the
     * instance a second time, in everybody's history.
     */
    socket.on('call:rejoin', async (data: { conversationId: string; kind: 'dm' | 'group' | 'channel' }) => {
      if (!data?.conversationId || (data.kind !== 'dm' && data.kind !== 'group' && data.kind !== 'channel')) return
      // The same gate as call:join: coming back from a blip is not a way in.
      if (!await canJoinCall(data.kind, data.conversationId, userId)) return
      const room = callRoom(data.kind, data.conversationId)
      // The evidence the grace period was waiting for, arriving before
      // anything was written down. A room whose last occupant is back is not a
      // room whose call ended, so the pending conclusion is dropped — and
      // dropped before the broadcast below, so no surface ever sees a call
      // that is both occupied and on its way out.
      cancelCallEnd(room)
      let set = activeCalls.get(room)
      if (!set) { set = new Set(); activeCalls.set(room, set) }
      const wasPresent = set.has(userId)
      set.add(userId)
      joinedCallRooms.add(room)
      // Tell the caller either way: it may have reconnected before its own
      // `chan:` membership was restored, and a client missing itself from the
      // list is the same fault seen from the other side.
      socket.emit('call:state', callStatePayload(room))
      // Already listed — a second tab, or a duplicate rejoin. Nothing changed
      // for anyone else, so nothing is fanned out to them.
      if (wasPresent) return
      broadcastCall(room)
    })

    socket.on('call:leave', (data: { conversationId: string; kind: 'dm' | 'group' | 'channel' }) => {
      if (!data?.conversationId || (data.kind !== 'dm' && data.kind !== 'group' && data.kind !== 'channel')) return
      leaveCall(callRoom(data.kind, data.conversationId), 'hang-up')
    })

    // ── Music channels ─────────────────────────────────────────────────────
    /**
     * Several music streams inside one voice channel, each member tuned to at
     * most one, everybody still talking.
     *
     * One gate serves all of them, and it is the same shape as the call
     * handlers': the member must be IN the call right now, checked against
     * `activeCalls` on the server rather than asserted by the client. A member
     * who left, or who never joined, cannot queue, skip or close anything —
     * and since v1 has no roles, this membership check is the whole of the
     * permission model. What limits the damage is the caps, not who you are.
     */
    const musicGate = (data: unknown): { room: string } | null => {
      const d = data as { conversationId?: string; kind?: string } | null
      if (!d?.conversationId) return null
      if (d.kind !== 'dm' && d.kind !== 'group' && d.kind !== 'channel') return null
      const room = callRoom(d.kind, d.conversationId)
      if (!activeCalls.get(room)?.has(userId)) return null
      return { room }
    }

    /** Refusals go to the asker alone; nobody else needs to see them fail. */
    const musicRefuse = (reason: string) => socket.emit('music:error', { reason })

    socket.on('music:create', (data: { conversationId: string; kind: string; name: string; url?: string; trackId?: string }) => {
      void (async () => {
        const gate = musicGate(data); if (!gate) return
        if (!musicRate.take(userId).ok) return musicRefuse('You are doing that too fast. Give it a moment.')
        const name = checkChannelName(data?.name)
        if (!name.ok) return musicRefuse(name.reason)

        const source = await resolveSource(data, userId)
        if (!source.ok) return musicRefuse(source.reason)

        const made = musicRooms.create(gate.room, String(data.name).trim(), source.value, userId)
        if (!made.ok) return musicRefuse(made.reason)
        broadcastMusic(gate.room)
        startSource(gate.room, made.id!, source.value)
      })()
    })

    socket.on('music:queue', (data: { conversationId: string; kind: string; channelId: string; url?: string; trackId?: string }) => {
      void (async () => {
        const gate = musicGate(data); if (!gate) return
        if (!musicRate.take(userId).ok) return musicRefuse('You are doing that too fast. Give it a moment.')

        const source = await resolveSource(data, userId)
        if (!source.ok) return musicRefuse(source.reason)

        const channelId = String(data?.channelId ?? '')
        const wasSilent = musicRooms.get(gate.room, channelId)?.now == null
        const r = musicRooms.queue(gate.room, channelId, source.value, userId)
        if (!r.ok) return musicRefuse(r.reason)
      // A channel whose queue ran dry is stopped, and nothing is going to
      // report an end for it — so the thing just queued has to be started
      // here or it waits for a skip that nobody will press.
        if (wasSilent) {
          const next = musicRooms.skip(gate.room, channelId)
          if (next.ok && next.now) startSource(gate.room, channelId, next.now)
        }
        broadcastMusic(gate.room)
      })()
    })

    socket.on('music:skip', (data: { conversationId: string; kind: string; channelId: string }) => {
      const gate = musicGate(data); if (!gate) return
      const skipId = String(data?.channelId ?? '')
      const r = musicRooms.skip(gate.room, skipId)
      if (!r.ok) return musicRefuse(r.reason)
      broadcastMusic(gate.room)
      if (r.now) startSource(gate.room, skipId, r.now)
      else void musicClose(gate.room, skipId)
    })

    socket.on('music:close', (data: { conversationId: string; kind: string; channelId: string }) => {
      const gate = musicGate(data); if (!gate) return
      const r = musicRooms.close(gate.room, String(data?.channelId ?? ''))
      if (!r.ok) return musicRefuse(r.reason)
      broadcastMusic(gate.room)
    })

    /**
     * Tune in, or out with null.
     *
     * Not rate limited: this is the one music action a member does while
     * simply using the feature, and it is free — it moves a name between two
     * sets. The rate limit is on the actions that cost a fetch.
     */
    socket.on('music:listen', (data: { conversationId: string; kind: string; channelId: string | null }) => {
      const gate = musicGate(data); if (!gate) return
      const id = data?.channelId == null ? null : String(data.channelId)
      const r = musicRooms.listen(gate.room, userId, id)
      if (!r.ok) return musicRefuse(r.reason)
      broadcastMusic(gate.room)
    })

    // ── Presence ───────────────────────────────────────────────────────────
    /**
     * Fan the user's current effective status out to everyone entitled to it.
     * One place, so the "invisible reads as offline" rule can't be forgotten
     * at one of the call sites.
     */
    const broadcastPresence = async () => {
      const status = presence.effectiveStatus(myStatus, userId, myStatusUntil)
      const audience = await presenceAudience(userId)
      for (const fid of audience) io.to(`user:${fid}`).emit('presence', { userId, status })
      // Your own other tabs get the RAW choice — you must see your own
      // "Invisible", even while your friends are being told you're offline.
      io.to(`user:${userId}`).emit('presence:self', { status: myStatus, effective: status, until: myStatusUntil })
    }

    /** The user picked a status. Persist the choice, then tell people. */
    socket.on('presence:set', async (raw: unknown, ack?: (r: any) => void) => {
      const next = typeof raw === 'string' ? raw : (raw as any)?.status
      if (!presence.isChosenStatus(next)) { ack?.({ ok: false, error: 'Unknown status' }); return }

      // An optional duration, in minutes. A bare string still works — that is
      // the "Forever" case and the shape every existing client sends.
      const mins = typeof raw === 'object' && raw ? Number((raw as any).minutes) : NaN
      let until: Date | null = null
      if (Number.isFinite(mins) && mins > 0) until = new Date(Date.now() + mins * 60_000)

      myStatus      = next
      myStatusUntil = until
      statusTouched = true
      // Choosing a status explicitly means you're at the keyboard.
      presence.setAway(userId, false)
      try {
        // statusUntil is always written, never merged: picking a status with
        // no duration has to clear whatever expiry the previous one left, or
        // "Online forever" would silently inherit the old DND's end time.
        await User.findByIdAndUpdate(userId, { status: next, statusUntil: until })
      } catch { ack?.({ ok: false, error: 'Could not save that' }); return }
      await broadcastPresence()
      ack?.({ ok: true, status: next, effective: presence.effectiveStatus(next, userId, myStatusUntil), until: myStatusUntil })
    })

    /**
     * The client reports inactivity. Deliberately NOT persisted: idleness is a
     * property of this session, not of the account, so a fresh sign-in never
     * starts you as away. effectiveStatus() only lets it apply to 'online'.
     */
    socket.on('presence:away', async (raw: unknown) => {
      const away = raw === true || (raw as any)?.away === true
      if (presence.isAway(userId) === away) return   // no-op, don't spam friends
      presence.setAway(userId, away)
      await broadcastPresence()
    })

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      try {
        console.log(`[WS] - ${username}`)
        // Drop out of any calls this socket was in so presence doesn't go stale.
        // 'socket-lost', not 'hang-up': this fires for a closed tab AND for a
        // network blip, and nothing here can tell them apart — so the call is
        // left standing for a grace period rather than declared over.
        for (const room of [...joinedCallRooms]) leaveCall(room, 'socket-lost')
        // Only go offline once the user's LAST socket closes — otherwise closing
        // one of two tabs (or a refresh) would falsely mark them offline.
        if (presence.removeSocket(userId, socket.id)) {
          // lastSeenAt only. Writing status: 'offline' here is exactly what used
          // to erase the user's Do Not Disturb every time they closed the app.
          await User.findByIdAndUpdate(userId, { lastSeenAt: new Date() })
          const audience = await presenceAudience(userId)
          for (const fid of audience) io.to(`user:${fid}`).emit('presence', { userId, status: 'offline' })
        }
      } catch (err) {
        console.error('[WS] disconnect', err)
      }
    })

    // ── Async setup ────────────────────────────────────────────────────────
    // Deliberately LAST: every handler above is registered synchronously first,
    // so nothing a client sends immediately after `connect` can fall into a gap
    // where no listener exists yet.
    try {
      // Reads the chosen status rather than stamping 'online' over it. That
      // write was the reason Do Not Disturb never survived a sign-in.
      const me = await User.findByIdAndUpdate(
        userId, { lastSeenAt: new Date() }, { new: true }
      ).select('avatar avatarCrop displayName username status statusUntil').lean()
      // Skipped entirely when presence:set beat this load: the row was read
    // before that write, so "catching up" from it would roll the fresher
    // choice back to the stale one.
    if (!statusTouched) {
      myStatus      = presence.isChosenStatus(me?.status) ? me!.status : 'online'
      myStatusUntil = (me?.statusUntil as Date | null | undefined) ?? null
    }

      // Looked up once per connection rather than trusting what the client
      // sends per-message. A reconnect after changing your avatar or display
      // name picks the new value up naturally, with no per-message lookup.
      myAvatar = me?.avatar ?? null
      myAvatarCrop = (me as any)?.avatarCrop ?? null
      myName   = me?.displayName || me?.username || username

      // Join a room per group so group:send broadcasts reach every member.
      myGroups = await Conversation.find({ members: userId }).select('_id').lean()
      myGroups.forEach(g => socket.join(`group:${g._id.toString()}`))

      // One room per channel, not per server, so a member receives only the
      // channels they can see. That was the stated intent here from the start
      // and the join below never applied it: every member joined every
      // channel's room, so a private channel's messages reached the whole
      // server. It now asks `channelViewOf`, the rule GET /servers/:sid uses;
      // later changes to who sees what are applied by refreshChannelAccess.
      // `members` is selected alongside `_id` so the presence announce below
      // can reuse this same query instead of running Server.find({ members:
      // userId }) a second time; `owner` and `memberRoles` because access is
      // resolved from them.
      //
      // The ids are kept in `myChannelIds` rather than thrown away after the
      // joins, because the call catch-up below needs exactly the same rule: a
      // `voice:<channelId>` call is yours when that channel is one of these.
      // Reusing this set keeps the catch-up and the live broadcast agreeing by
      // construction, and costs no extra query.
      const myChannelIds = new Set<string>()
      const myServers = await Server.find({ members: userId }).select('_id members owner memberRoles').lean()
      if (myServers.length) {
        const serverIds = myServers.map(s => s._id)
        // `server` is selected alongside `_id` so this same query can fill the
        // channel -> server map the voice-occupancy payload needs.
        const [myChannels, myCategories, accessList] = await Promise.all([
          Channel.find({ server: { $in: serverIds } })
            .select('_id server category overwrites hideWhenDenied').lean(),
          Category.find({ server: { $in: serverIds } }).select('_id overwrites').lean(),
          Promise.all(myServers.map(s => loadAccess(s, userId))),
        ])
        const accessIn = new Map(myServers.map((s, i) => [s._id.toString(), accessList[i]]))
        // Category ids are unique across servers, so one map serves them all.
        const catOverwrites = await categoryOverwriteMap(myCategories as never)
        myChannels.forEach(c => {
          const id = c._id.toString()
          const sid = c.server.toString()
          // Remembered whether or not this member may see it: the map answers
          // "which server is this channel in", not "may you".
          rememberChannelServer(id, sid)
          const access = accessIn.get(sid)
          if (!access || channelViewOf(access, c, catOverwrites) !== 'full') return
          myChannelIds.add(id)
          socket.join(`chan:${id}`)
        })
      }

      // Announce only on the first socket; extra tabs shouldn't re-broadcast.
      // Presence reaches friends PLUS anyone sharing a server (see
      // presenceAudience above) — a member list without live status is most
      // of the point of a member list, and the audience only widens to rooms
      // the user chose to join. Invisible is still a full opt-out, because
      // effectiveStatus maps it to offline.
      if (wasOffline) {
        const eff = presence.effectiveStatus(myStatus, userId, myStatusUntil)
        const audience = await presenceAudience(userId, myServers)
        for (const fid of audience) io.to(`user:${fid}`).emit('presence', { userId, status: eff })
      }

      // Catch up on calls already in progress. Without this, someone who was
      // offline when the call started sees no ringing/indicator when they come
      // online — call:state is only broadcast on join/leave, which they missed.
      for (const [room, participants] of activeCalls) {
        if (participants.size === 0) continue
        // Same three-way shape as broadcastCall, and for the same reason: the
        // DM test PARSES the room name, so it has to come last or it would
        // claim every prefix it does not recognise.
        const belongs = room.startsWith('voice:')
          ? myChannelIds.has(room.slice(6))
          : room.startsWith('group:')
            ? myGroups.some(g => `group:${g._id.toString()}` === room)
            : room.slice(3).split('_').includes(userId)
        if (!belongs) continue
        const sid = room.startsWith('voice:') ? channelServer.get(room.slice(6)) : undefined
        // Without this a late arrival sees the room's occupants but none of
        // their state until somebody happens to change theirs.
        const catchUpStates = statesFor(room)
        socket.emit('call:state', { room, userIds: [...participants], ...(sid ? { serverId: sid } : {}), ...(catchUpStates ? { states: catchUpStates } : {}) })
      }
    } catch (err) {
      // A failed setup must not take the connection down — the handlers are
      // already live and usable with their fallback values.
      console.error('[WS] connection setup failed', err)
    }
  })

  return io
}