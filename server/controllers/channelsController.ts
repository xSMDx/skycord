import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Channel } from '../models/Channel'
import { loadServer, requireOwner, shapeChannel } from './serversController'
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
    res.status(201).json({ channel: shapeChannel(channel) })
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
      res.json({ ok: true })
    })
  } catch (err) { next(err) }
}

/** Oldest-first, resolved so author data is live rather than the frozen snapshot. */
export const getChannelMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await loadChannel(req, res); if (!found) return
    const raw = await Message.find({ conversationId: found.channel._id.toString() })
      .sort({ createdAt: 1 }).lean()
    res.json({ messages: await resolveMessages(raw) })
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
    const targets = ids.length
      ? await Message.find({ _id: { $in: ids } }).select('authorName content').lean()
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
      replyToIds:       ids,
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

    // Reach connected members live. The sender used REST because their own
    // socket is down, so they will not echo this back to themselves.
    getIO()?.to(`chan:${channelId}`).emit('channel:receive', payload)

    res.status(201).json({ message: payload })
  } catch (err) { next(err) }
}
