import type { Server as HttpServer } from 'http'
import { Server as IOServer, Socket } from 'socket.io'
import { verifyAccessToken } from '../utils/jwt'
import { Message }  from '../models/Message'
import { User }     from '../models/User'
import { Conversation } from '../models/Conversation'
import { Friendship } from '../models/Friendship'
import { Server } from '../models/Server'
import { Channel } from '../models/Channel'
import { dmConvId, canDM } from '../controllers/messagesController'
import * as presence from '../state/presence'
import { config }   from '../config/env'

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
const callStartedAt = new Map<string, number>()

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
          content:        data.content.trim(),
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

        msg.content = data.content.trim()
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
        if (msg.authorId.toString() !== userId){ ack?.({ ok: false, error: 'Not allowed' }); return }

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
        const emoji = String(data.emoji ?? '')
        if (!emoji || [...emoji].length > 8) { ack?.({ ok: false, error: 'Invalid emoji' }); return }
        if (msg.reactions.length >= 40 && !msg.reactions.some(r => r.emoji === emoji)) {
          ack?.({ ok: false, error: 'Too many reactions' }); return
        }

        const existing  = msg.reactions.find(r => r.emoji === emoji)

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
          content:        data.content.trim(),
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
          content:        data.content.trim(),
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

    const broadcastCall = (room: string) => {
      const userIds = [...(activeCalls.get(room) ?? [])]
      // serverId only means anything for a voice room, and only when we know
      // it — see channelServer. The client uses it to attribute occupancy to
      // a server whose channel list it has not fetched.
      const serverId = room.startsWith('voice:') ? channelServer.get(room.slice(6)) : undefined
      const states = statesFor(room)
      const payload = { room, userIds, ...(serverId ? { serverId } : {}), ...(states ? { states } : {}) }
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

    // Posted when the last participant leaves, mirroring "X started a call".
    // Derives the conversation straight from the room name (the leaver may already
    // be disconnecting, so we can't rely on per-call closure state here).
    const postCallEnded = async (room: string) => {
      // The other half of the no-system-message rule: a voice channel has no
      // text history to announce into, and the DM branch below would parse
      // `voice:<id>` into a garbage conversationId rather than refusing it.
      if (room.startsWith('voice:')) return
      try {
        const isGroup = room.startsWith('group:')
        const conversationId = isGroup ? room.slice(6) : room.slice(3)
        const msg = await Message.create({
          conversationId, kind: 'system', systemType: 'call',
          authorId: userId, authorName: username, authorAvatar: null, content: 'Call ended',
        })
        const payload = {
          _id: msg._id.toString(), conversationId, kind: 'system', systemType: 'call',
          authorId: userId, authorName: username, authorAvatar: null, content: 'Call ended',
          reactions: [], pinned: false, edited: false, replyTo: null,
          createdAt: msg.createdAt.toISOString(),
        }
        if (isGroup) io.to(room).emit('group:receive', payload)
        else { const [a, b] = conversationId.split('_'); io.to(`user:${a}`).to(`user:${b}`).emit('dm:receive', payload) }
      } catch (err) { console.error('[WS] postCallEnded', err) }
    }

    // No membership check here, deliberately: this only ever deletes the
    // CALLER's own id from the room's Set (`set.has(userId)` guards that), so
    // it cannot forge or evict anyone else's occupancy. Once call:join is
    // guarded above, a caller can only ever be in a room they were let into,
    // so there is nothing left for a leave-side check to catch.
    const leaveCall = (room: string) => {
      const set = activeCalls.get(room)
      if (!set || !set.has(userId)) return
      set.delete(userId)
      // State outliving its occupant would render a ghost row: every client
      // reads occupancy and state together.
      const st = voiceStates.get(room)
      if (st) { st.delete(userId); if (st.size === 0) voiceStates.delete(room) }
      joinedCallRooms.delete(room)
      if (set.size === 0) {
        activeCalls.delete(room); callStartedAt.delete(room); voiceStates.delete(room)
        void postCallEnded(room)
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
      if (!set) { set = new Set(); activeCalls.set(room, set) }
      set.add(userId)
      joinedCallRooms.add(room)
      if (wasEmpty) {
        callStartedAt.set(room, Date.now())
        // No "X started a call" for a voice channel: there is no text history
        // there to read it in, so the Message would only ever be dead weight in
        // a conversation nobody can open. Narrowing here is also what keeps
        // postCallSystem's signature honest.
        if (data.kind !== 'channel') {
          await postCallSystem(data.kind, data.conversationId, `${username} started a call`)
        }
      }
      broadcastCall(room)
    })

    socket.on('call:leave', (data: { conversationId: string; kind: 'dm' | 'group' | 'channel' }) => {
      if (!data?.conversationId || (data.kind !== 'dm' && data.kind !== 'group' && data.kind !== 'channel')) return
      leaveCall(callRoom(data.kind, data.conversationId))
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
        for (const room of [...joinedCallRooms]) leaveCall(room)
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

      // One room per channel, not per server: a member receives only the
      // channels they can see, which is the shape per-channel permissions
      // will need in a later cycle. `members` is selected alongside `_id` so
      // the presence announce below can reuse this same query instead of
      // running Server.find({ members: userId }) a second time.
      //
      // The ids are kept in `myChannelIds` rather than thrown away after the
      // joins, because the call catch-up below needs exactly the same rule: a
      // `voice:<channelId>` call is yours when that channel is one of these.
      // Reusing this set keeps the catch-up and the live broadcast agreeing by
      // construction, and costs no extra query.
      const myChannelIds = new Set<string>()
      const myServers = await Server.find({ members: userId }).select('_id members').lean()
      if (myServers.length) {
        // `server` is selected alongside `_id` so this same query can fill the
        // channel -> server map the voice-occupancy payload needs. One field,
        // no extra round trip.
        const myChannels = await Channel.find({ server: { $in: myServers.map(s => s._id) } })
          .select('_id server').lean()
        myChannels.forEach(c => {
          const id = c._id.toString()
          myChannelIds.add(id)
          rememberChannelServer(id, c.server.toString())
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