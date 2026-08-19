import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Channel } from '../models/Channel'
import { loadServer, requireOwner, shapeChannel, emitToServer } from './serversController'
import { Message } from '../models/Message'
import { User } from '../models/User'
import { resolveMessages } from './messagesController'
import { getIO } from '../sockets/chatSocket'

/**
 * Serializes callbacks per server id, within this process only. Guards the
 * last-text-channel check-then-delete in `deleteChannel` against two
 * concurrent deletes both reading the same count before either writes.
 *
 * PER-PROCESS ONLY: this Map lives in one Node process's memory and
 * coordinates nothing beyond it. It is enough today because the API runs as
 * a single pm2 process and Mongo here is a standalone instance (no replica
 * set, so no multi-document transactions are available). If the API is ever
 * run as more than one instance, this guard stops being sufficient — the
 * invariant would need a distributed lock (e.g. Redis) or a replica-set
 * transaction to close the same race across processes.
 */
const serverLocks = new Map<string, Promise<void>>()

function withServerLock<T>(serverId: string, fn: () => Promise<T>): Promise<T> {
  const prev = serverLocks.get(serverId) ?? Promise.resolve()
  const run = prev.then(fn)
  // Settle the chain whether fn resolved or threw, so a failed delete can
  // never wedge every future delete for this server.
  const tail = run.then(() => undefined, () => undefined)
  serverLocks.set(serverId, tail)
  tail.finally(() => { if (serverLocks.get(serverId) === tail) serverLocks.delete(serverId) })
  return run
}

/**
 * Resolve a channel and prove the caller may touch it. The channel must belong
 * to the server in the path — otherwise a member of any server could address a
 * channel in any other by id.
 */
export const loadChannel = async (req: Request, res: Response) => {
  const server = await loadServer(req, res)
  if (!server) return null
  const { cid } = req.params
  if (!Types.ObjectId.isValid(cid)) { res.status(404).json({ message: 'Channel not found' }); return null }
  const channel = await Channel.findById(cid)
  if (!channel || channel.server.toString() !== server._id.toString()) {
    res.status(404).json({ message: 'Channel not found' }); return null
  }
  return { server, channel }
}

export const createChannel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return

    const name = String(req.body.name ?? '').trim()
    const type = req.body.type === 'voice' ? 'voice' : req.body.type === 'text' ? 'text' : null
    if (!name || name.length > 100) { res.status(400).json({ message: 'Give the channel a name' }); return }
    if (!type) { res.status(400).json({ message: 'A channel is either text or voice' }); return }

    // Appended to the end of its own type group.
    const last = await Channel.find({ server: server._id, type }).sort({ position: -1 }).limit(1).lean()
    const position = last.length ? last[0].position + 1 : 0

    const channel = await Channel.create({ server: server._id, name, type, position })
    const shaped = shapeChannel(channel)
    emitToServer(server, 'channel:created', { serverId: server._id.toString(), channel: shaped })

    // Members with the app open must also start RECEIVING the new channel, not
    // merely see it appear. Their sockets joined rooms at connect time, and
    // this channel did not exist then. One socketsJoin call against the union
    // of every member's personal room, rather than an awaited fetchSockets()
    // round trip per member followed by a join loop.
    const io = getIO()
    // Guarded on a non-empty member list: Socket.IO treats io.in([]) as "every
    // connected socket", not "nobody" — an empty array here would silently
    // join every user in the process to this channel's room. Unreachable
    // today (the owner is always a member), but structurally safe rather
    // than incidentally safe.
    if (io && server.members.length) {
      const room = `chan:${channel._id.toString()}`
      io.in(server.members.map(m => `user:${m.toString()}`)).socketsJoin(room)
    }
    res.status(201).json({ channel: shaped })
  } catch (err) { next(err) }
}

export const updateChannel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await loadChannel(req, res); if (!found) return
    if (!requireOwner(found.server, req.user!.sub, res)) return

    const name = String(req.body.name ?? '').trim()
    if (!name || name.length > 100) { res.status(400).json({ message: 'Give the channel a name' }); return }
    found.channel.name = name
    await found.channel.save()
    emitToServer(found.server, 'channel:updated', {
      serverId: found.server._id.toString(), channel: shapeChannel(found.channel),
    })
    res.json({ channel: shapeChannel(found.channel) })
  } catch (err) { next(err) }
}

export const deleteChannel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await loadChannel(req, res); if (!found) return
    if (!requireOwner(found.server, req.user!.sub, res)) return

    const serverId = found.server._id.toString()
    await withServerLock(serverId, async () => {
      // A server always has somewhere to talk.
      if (found.channel.type === 'text') {
        const texts = await Channel.countDocuments({ server: found.server._id, type: 'text' })
        if (texts <= 1) {
          res.status(400).json({ message: 'You cannot delete the last text channel' }); return
        }
      }
      await found.channel.deleteOne()
      const channelId = found.channel._id.toString()
      emitToServer(found.server, 'channel:deleted', {
        serverId: found.server._id.toString(), channelId,
      })
      getIO()?.in(`chan:${channelId}`).socketsLeave(`chan:${channelId}`)
      res.json({ ok: true })
    })
  } catch (err) { next(err) }
}

/**
 * Oldest-first, resolved so author data is live rather than the frozen
 * snapshot. Paginated with the same contract as getDMMessages
 * (messagesController.ts): `limit` defaults to 50 and caps at 100, `before`
 * filters to messages older than that timestamp. Without a cap this loaded
 * an entire channel's history in one query, and resolveMessages then ran an
 * unbounded $in across every reply target in that history.
 */
export const getChannelMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await loadChannel(req, res); if (!found) return
    const before = req.query.before as string | undefined
    const limit  = Math.min(Number(req.query.limit) || 50, 100)

    const filter: any = { conversationId: found.channel._id.toString() }
    if (before) filter.createdAt = { $lt: new Date(before) }

    const raw = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()

    const resolved = await resolveMessages(raw, found.channel._id.toString())
    res.json({ messages: resolved.reverse() })
  } catch (err) { next(err) }
}

export const sendChannelMessage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await loadChannel(req, res); if (!found) return
    const userId = req.user!.sub

    // A voice channel is one thing. Text-in-voice is deliberately out of scope.
    if (found.channel.type !== 'text') {
      res.status(400).json({ message: 'You cannot post messages in a voice channel' }); return
    }

    const { content, replyToIds } = req.body as { content?: string; replyToIds?: string[] }
    if (!content?.trim()) { res.status(400).json({ message: 'Content required' }); return }

    // Name and avatar come from the User document, never the request body —
    // accepting them from the client is how an author-spoofing hole was opened
    // on the other send paths.
    const sender = await User.findById(userId)
      .select('avatar avatarCrop displayName username').lean()

    const ids = Array.isArray(replyToIds) ? replyToIds : []
    // Scoped to this channel: without the conversationId filter, a caller could
    // name a message id from someone else's DM or an unrelated group/channel and
    // have its authorName + a content snippet echoed into this channel's
    // replyTo preview for every member to see. An id that resolves but belongs
    // to a different conversation is treated the same as an id that resolves to
    // nothing at all — silently dropped, never leaked.
    const targets = ids.length
      ? await Message.find({ _id: { $in: ids }, conversationId: found.channel._id.toString() })
          .select('authorName content').lean()
      : []
    const byId = new Map(targets.map(t => [t._id.toString(), t]))
    const replyTo = ids
      .map(id => byId.get(id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map(t => ({ id: t._id.toString(), author: t.authorName, content: t.content.slice(0, 80) }))

    const channelId = found.channel._id.toString()
    const msg = await Message.create({
      conversationId:   channelId,
      kind:             'channel',
      authorId:         userId,
      authorName:       sender?.displayName || sender?.username || 'Unknown',
      authorAvatar:     sender?.avatar ?? null,
      authorAvatarCrop: (sender as any)?.avatarCrop ?? null,
      content:          content.trim(),
      // Persist only the ids that survived the channel-scoped validation
      // above (replyTo.map), never the raw request-body ids. Storing `ids`
      // here let a client name a message from an unrelated channel or a DM
      // it has no part in: the POST response was already scrubbed, but the
      // stored document wasn't, so resolveMessages' conversation-blind $in
      // lookup would resolve that other conversation's author + content
      // snippet back in on every future GET of this channel — a permanent
      // leak, not merely a one-time echo.
      replyToIds:       replyTo.map(r => r.id),
    })

    const payload = {
      _id:              msg._id.toString(),
      conversationId:   channelId,
      kind:             'channel',
      authorId:         userId,
      authorName:       msg.authorName,
      authorAvatar:     sender?.avatar ?? null,
      authorAvatarCrop: (sender as any)?.avatarCrop ?? null,
      content:          msg.content,
      reactions:        [],
      pinned:           false,
      edited:           false,
      replyTo,
      createdAt:        msg.createdAt.toISOString(),
    }

    // Reach connected members live, excluding the sender's own socket(s):
    // they already have this payload from the 201 response below, and
    // io.to(room) reaches every socket in the room including the sender's —
    // without the exclusion every message rendered twice for its own author.
    // Mirrors the fix already applied to group:send in chatSocket.ts.
    getIO()?.to(`chan:${channelId}`).except(`user:${userId}`).emit('channel:receive', payload)

    res.status(201).json({ message: payload })
  } catch (err) { next(err) }
}
