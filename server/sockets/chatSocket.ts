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
const callStartedAt = new Map<string, number>()

let _io: IOServer | null = null
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
  // DM/system: the conversationId is the two participant ids joined, so
  // membership is simply being one of them.
  return msg.conversationId.split('_').includes(userId)
}

// Resolve a list of parent message ids into reply previews, preserving order
// and dropping any that no longer exist.
const buildReplyPreviews = async (ids?: string[]) => {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const targets = await Message.find({ _id: { $in: ids } }).select('authorName content').lean()
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
    // Who is allowed to hear about this user's presence. Populated below.
    let myFriendIds: string[] = []
    // The user's CHOSEN status, read once at connect. Kept here so the
    // presence handlers below can re-derive what friends should see without a
    // database round-trip on every idle flicker.
    let myStatus: presence.ChosenStatus = 'online'

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
        const msg = await Message.create({
          conversationId: dmConvId(userId, data.partnerId),
          kind:           'dm',
          authorId:       userId,
          // Server-side name, never the client's. data.authorName let a sender
          // attribute its own message to "Skycord System" or to someone else.
          authorName:     myName,
          authorAvatar:   myAvatar,
          authorAvatarCrop: myAvatarCrop,
          content:        data.content.trim(),
          replyToIds:     Array.isArray(data.replyToIds) ? data.replyToIds : [],
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
          replyTo:        await buildReplyPreviews(data.replyToIds),
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

        const partner = getPartner(msg.conversationId, userId)
        const payload = { messageId: msg._id.toString(), content: msg.content }

        if (partner) io.to(`user:${partner}`).emit('message:edited', payload)
        else if (msg.kind === 'group') socket.to(`group:${msg.conversationId}`).emit('message:edited', payload)
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
        const groupId = msg.conversationId
        await msg.deleteOne()

        if (partner) io.to(`user:${partner}`).emit('message:deleted', { messageId: data.messageId })
        else if (isGroup) socket.to(`group:${groupId}`).emit('message:deleted', { messageId: data.messageId })
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

        const partner = getPartner(msg.conversationId, userId)
        const payload = { messageId: msg._id.toString(), pinned: msg.pinned }

        if (partner) io.to(`user:${partner}`).emit('message:pinned', payload)
        else if (msg.kind === 'group') socket.to(`group:${msg.conversationId}`).emit('message:pinned', payload)
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

        const partner = getPartner(msg.conversationId, userId)
        const payload = { messageId: msg._id.toString(), reactions, reactorId: userId }

        if (partner) io.to(`user:${partner}`).emit('message:reacted', payload)
        else if (msg.kind === 'group') socket.to(`group:${msg.conversationId}`).emit('message:reacted', payload)
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

        const msg = await Message.create({
          conversationId: dmConvId(userId, data.partnerId),
          kind:           'dm',
          authorId:       userId,
          authorName:     myName,
          authorAvatar:   myAvatar,
          authorAvatarCrop: myAvatarCrop,
          content:        data.content.trim(),
          replyToIds:     Array.isArray(data.replyToIds) ? data.replyToIds : [],
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
          replyTo:        await buildReplyPreviews(data.replyToIds),
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

        const msg = await Message.create({
          conversationId: data.groupId,
          kind:           'group',
          authorId:       userId,
          authorName:     myName,
          authorAvatar:   myAvatar,
          authorAvatarCrop: myAvatarCrop,
          content:        data.content.trim(),
          replyToIds:     Array.isArray(data.replyToIds) ? data.replyToIds : [],
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
          replyTo:        await buildReplyPreviews(data.replyToIds),
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
    // in a call so everyone else can see it. Room names mirror voiceController.
    const callRoom = (kind: 'dm' | 'group', convId: string) =>
      kind === 'group' ? `group:${convId}` : `dm:${dmConvId(userId, convId)}`

    const joinedCallRooms = new Set<string>()

    const broadcastCall = (room: string) => {
      const userIds = [...(activeCalls.get(room) ?? [])]
      const payload = { room, userIds }
      if (room.startsWith('group:')) {
        io.to(room).emit('call:state', payload)
      } else {
        const [a, b] = room.slice(3).split('_')
        io.to(`user:${a}`).to(`user:${b}`).emit('call:state', payload)
      }
    }

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

    const leaveCall = (room: string) => {
      const set = activeCalls.get(room)
      if (!set || !set.has(userId)) return
      set.delete(userId)
      joinedCallRooms.delete(room)
      if (set.size === 0) {
        activeCalls.delete(room); callStartedAt.delete(room)
        void postCallEnded(room)
      }
      broadcastCall(room)
    }

    socket.on('call:join', async (data: { conversationId: string; kind: 'dm' | 'group' }) => {
      if (!data?.conversationId || (data.kind !== 'dm' && data.kind !== 'group')) return
      const room = callRoom(data.kind, data.conversationId)
      let set = activeCalls.get(room)
      const wasEmpty = !set || set.size === 0
      if (!set) { set = new Set(); activeCalls.set(room, set) }
      set.add(userId)
      joinedCallRooms.add(room)
      if (wasEmpty) {
        callStartedAt.set(room, Date.now())
        await postCallSystem(data.kind, data.conversationId, `${username} started a call`)
      }
      broadcastCall(room)
    })

    socket.on('call:leave', (data: { conversationId: string; kind: 'dm' | 'group' }) => {
      if (!data?.conversationId || (data.kind !== 'dm' && data.kind !== 'group')) return
      leaveCall(callRoom(data.kind, data.conversationId))
    })

    // ── Presence ───────────────────────────────────────────────────────────
    /**
     * Fan the user's current effective status out to everyone entitled to it.
     * One place, so the "invisible reads as offline" rule can't be forgotten
     * at one of the call sites.
     */
    const broadcastPresence = () => {
      const status = presence.effectiveStatus(myStatus, userId)
      for (const fid of myFriendIds) io.to(`user:${fid}`).emit('presence', { userId, status })
      // Your own other tabs get the RAW choice — you must see your own
      // "Invisible", even while your friends are being told you're offline.
      io.to(`user:${userId}`).emit('presence:self', { status: myStatus, effective: status })
    }

    /** The user picked a status. Persist the choice, then tell people. */
    socket.on('presence:set', async (raw: unknown, ack?: (r: any) => void) => {
      const next = typeof raw === 'string' ? raw : (raw as any)?.status
      if (!presence.isChosenStatus(next)) { ack?.({ ok: false, error: 'Unknown status' }); return }
      myStatus = next
      // Choosing a status explicitly means you're at the keyboard.
      presence.setAway(userId, false)
      try {
        await User.findByIdAndUpdate(userId, { status: next })
      } catch { ack?.({ ok: false, error: 'Could not save that' }); return }
      broadcastPresence()
      ack?.({ ok: true, status: next, effective: presence.effectiveStatus(next, userId) })
    })

    /**
     * The client reports inactivity. Deliberately NOT persisted: idleness is a
     * property of this session, not of the account, so a fresh sign-in never
     * starts you as away. effectiveStatus() only lets it apply to 'online'.
     */
    socket.on('presence:away', (raw: unknown) => {
      const away = raw === true || (raw as any)?.away === true
      if (presence.isAway(userId) === away) return   // no-op, don't spam friends
      presence.setAway(userId, away)
      broadcastPresence()
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
          for (const fid of myFriendIds) io.to(`user:${fid}`).emit('presence', { userId, status: 'offline' })
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
      ).select('avatar avatarCrop displayName username status').lean()
      myStatus = presence.isChosenStatus(me?.status) ? me!.status : 'online'

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
      // will need in a later cycle.
      const myServers = await Server.find({ members: userId }).select('_id').lean()
      if (myServers.length) {
        const myChannels = await Channel.find({ server: { $in: myServers.map(s => s._id) } })
          .select('_id').lean()
        myChannels.forEach(c => socket.join(`chan:${c._id.toString()}`))
      }

      // Presence goes to friends only. It used to be io.emit(...), so every
      // connected client learned every other user's online/offline transitions
      // — a behavioural-pattern leak, and friends are the only people with a UI
      // that displays it.
      const fr = await Friendship.find({
        status: 'accepted',
        $or: [{ requester: userId }, { receiver: userId }],
      }).select('requester receiver').lean()
      myFriendIds = fr.map(f =>
        f.requester.toString() === userId ? f.receiver.toString() : f.requester.toString())

      // Announce only on the first socket; extra tabs shouldn't re-broadcast.
      if (wasOffline) {
        const eff = presence.effectiveStatus(myStatus, userId)
        for (const fid of myFriendIds) io.to(`user:${fid}`).emit('presence', { userId, status: eff })
      }

      // Catch up on calls already in progress. Without this, someone who was
      // offline when the call started sees no ringing/indicator when they come
      // online — call:state is only broadcast on join/leave, which they missed.
      for (const [room, participants] of activeCalls) {
        if (participants.size === 0) continue
        const belongs = room.startsWith('group:')
          ? myGroups.some(g => `group:${g._id.toString()}` === room)
          : room.slice(3).split('_').includes(userId)
        if (belongs) socket.emit('call:state', { room, userIds: [...participants] })
      }
    } catch (err) {
      // A failed setup must not take the connection down — the handlers are
      // already live and usable with their fallback values.
      console.error('[WS] connection setup failed', err)
    }
  })

  return io
}