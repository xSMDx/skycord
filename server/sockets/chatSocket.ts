import type { Server as HttpServer } from 'http'
import { Server as IOServer, Socket } from 'socket.io'
import { verifyAccessToken } from '../utils/jwt'
import { Message }  from '../models/Message'
import { User }     from '../models/User'
import { Conversation } from '../models/Conversation'
import { dmConvId } from '../controllers/messagesController'
import { config }   from '../config/env'

// userId -> the socket ids that user currently has open. A user is online while
// they hold AT LEAST ONE socket: tracking a single id meant a second tab (or the
// brief overlap during a refresh, where the new socket connects before the old
// one disconnects) could mark a live user offline — or leave a closed tab online.
const onlineUsers = new Map<string, Set<string>>()
export const getOnlineUsers = () => onlineUsers
export const isUserOnline = (userId: string) => (onlineUsers.get(userId)?.size ?? 0) > 0

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
  })
  _io = io

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

    let sockets = onlineUsers.get(userId)
    if (!sockets) { sockets = new Set(); onlineUsers.set(userId, sockets) }
    const wasOffline = sockets.size === 0
    sockets.add(socket.id)
    socket.join(`user:${userId}`)
    const me = await User.findByIdAndUpdate(
      userId, { status: 'online', lastSeenAt: new Date() }, { new: true }
    ).select('avatar').lean()
    // Announce only on the first socket; extra tabs shouldn't re-broadcast.
    if (wasOffline) io.emit('presence', { userId, status: 'online' })

    // Looked up once per connection rather than trusting whatever the client
    // sends per-message — avatars are no longer frozen onto each message at
    // send time. A reconnect (e.g. after the user changes their avatar) picks
    // up the new value naturally, without needing a per-message DB lookup.
    const myAvatar = me?.avatar ?? null

    // Join a room for each group this user is in, so group:send broadcasts
    // reach every connected member. Room name is the group's _id.
    const myGroups = await Conversation.find({ members: userId }).select('_id').lean()
    myGroups.forEach(g => socket.join(`group:${g._id.toString()}`))

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

    // ── Send DM ───────────────────────────────────────────────────────────
    socket.on('dm:send', async (data: {
      partnerId: string; content: string
      authorName: string; replyToIds?: string[]
    }, ack) => {
      try {
        if (!data.content?.trim()) { ack?.({ ok: false, error: 'Empty' }); return }
        const msg = await Message.create({
          conversationId: dmConvId(userId, data.partnerId),
          kind:           'dm',
          authorId:       userId,
          authorName:     data.authorName || username,
          authorAvatar:   myAvatar,
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

        const existing  = msg.reactions.find(r => r.emoji === data.emoji)

        if (existing) {
          const hasReacted = existing.userIds.some(id => id.toString() === userId)
          if (hasReacted) {
            existing.userIds = existing.userIds.filter(id => id.toString() !== userId)
            if (existing.userIds.length === 0) {
              msg.reactions = msg.reactions.filter(r => r.emoji !== data.emoji)
            }
          } else {
            existing.userIds.push(userId as any)
          }
        } else {
          msg.reactions.push({ emoji: data.emoji, userIds: [userId as any] })
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

        const msg = await Message.create({
          conversationId: dmConvId(userId, data.partnerId),
          kind:           'dm',
          authorId:       userId,
          authorName:     data.authorName || username,
          authorAvatar:   myAvatar,
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
          authorName:     data.authorName || username,
          authorAvatar:   myAvatar,
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

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`[WS] - ${username}`)
      // Drop out of any calls this socket was in so presence doesn't go stale.
      for (const room of [...joinedCallRooms]) leaveCall(room)
      // Only go offline once the user's LAST socket closes — otherwise closing
      // one of two tabs (or a refresh) would falsely mark them offline.
      const set = onlineUsers.get(userId)
      set?.delete(socket.id)
      if (set && set.size === 0) {
        onlineUsers.delete(userId)
        await User.findByIdAndUpdate(userId, { status: 'offline', lastSeenAt: new Date() })
        io.emit('presence', { userId, status: 'offline' })
      }
    })
  })

  return io
}