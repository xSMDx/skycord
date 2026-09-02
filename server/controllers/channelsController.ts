import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Channel, MAX_SLOWMODE, MAX_USER_LIMIT, MIN_BITRATE, MAX_BITRATE } from '../models/Channel'
import { VoiceServer } from '../models/VoiceServer'
import { findInstanceVoiceServer, isInstanceVoiceId } from '../config/instanceVoice'
import { Category } from '../models/Category'
import { loadServer, requireOwner, shapeChannel, emitToServer } from './serversController'
import { Message } from '../models/Message'
import { User } from '../models/User'
import { resolveMessages } from './messagesController'
import { getIO, rememberChannelServer, forgetChannelServer } from '../sockets/chatSocket'
import { loadAccess, channelBits, has, requirePerm, requireBits, validateOverwrites } from '../utils/access'
import { parseOverwrites } from '../permissions'

/**
 * Serializes callbacks per server id, within this process only. Guards every
 * check-then-act sequence in this file and in categoriesController.ts that
 * reads something about a server's channels/categories and then writes based
 * on what it read:
 *  - `deleteChannel`'s last-text-channel count-then-delete, against two
 *    concurrent deletes both reading the same count before either writes.
 *  - `createChannel` and `updateChannel`'s category resolution: both resolve
 *    a category id to prove it exists on this server, then persist that id
 *    on a channel. Locked against `deleteCategory`, whose reparent-then-delete
 *    could otherwise slip in between the resolve and the persist and leave
 *    the channel pointing at a category that no longer exists.
 *  - `createCategory`'s MAX_CATEGORIES count and highest-position read, both
 *    check-then-act against concurrent creates the same way.
 *  - `deleteCategory`'s reparent-then-delete itself, so it can't interleave
 *    with any of the above.
 *
 * Exported so categoriesController.ts can take the same per-server lock
 * rather than a second, uncoordinated one — two independent locks would not
 * serialize against each other and would defeat the point.
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

export function withServerLock<T>(serverId: string, fn: () => Promise<T>): Promise<T> {
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
 * Resolve a channel, prove it belongs to the server in the path, and decide
 * whether the caller may see it at all.
 *
 * The server check is not incidental: without it a member of any server could
 * address a channel in any other by id.
 *
 * The single gate for every channel operation — fetching messages, sending
 * one, editing and deleting all pass through here — so ViewChannels is
 * enforced once rather than remembered at four call sites.
 *
 * A denied channel answers **404, not 403**. 403 confirms the channel exists,
 * which for a private channel leaks the very thing it was made private to
 * hide: that there is a #incidents in this server at all. The same reason the
 * id-not-found and wrong-server branches above already answer 404.
 *
 * The resolved bitfield is returned so callers can ask further questions —
 * SendMessages, Connect — without re-running the queries.
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

  const access = await loadAccess(server, req.user!.sub)
  const category = channel.category ? await Category.findById(channel.category) : null
  const bits = channelBits(
    access,
    parseOverwrites(category?.overwrites),
    parseOverwrites(channel.overwrites),
  )
  if (!has(bits, 'ViewChannels')) {
    res.status(404).json({ message: 'Channel not found' }); return null
  }

  return { server, channel, access, bits }
}

/**
 * Turn a `category` from a request body into something storable.
 *
 * Returns the ObjectId when the value names a category of THIS server, `null`
 * for explicitly uncategorised, and `false` for anything else — a malformed
 * id, an id that resolves to nothing, and (the case that matters) an id that
 * resolves to a category belonging to a DIFFERENT server. That last one has to
 * be refused rather than silently stored: a channel filed under a category
 * that its own server does not render, and that the other server has no
 * channel of, disappears from both sidebars with nothing to click to get it
 * back.
 *
 * `false` rather than a thrown error so the callers stay in the same
 * validate-then-respond shape as the name check beside them.
 */
const resolveCategory = async (
  raw: unknown, serverId: Types.ObjectId
): Promise<Types.ObjectId | null | false> => {
  // `null` is the one spelling of "uncategorised" — the same value the
  // channel document itself stores. An empty string is deliberately NOT a
  // second spelling: it falls through to the ObjectId.isValid check below,
  // fails it, and comes back `false` (a 400) like any other malformed id. In
  // a JSON API a client sending `''` almost always means "I forgot to set
  // this" or "I have a stale/empty selection", not "explicitly none" — and
  // treating it as valid would hide that bug behind a silent success.
  if (raw === null) return null
  if (typeof raw !== 'string' || !Types.ObjectId.isValid(raw)) return false
  const category = await Category.findById(raw).select('server').lean()
  if (!category || category.server.toString() !== serverId.toString()) return false
  return category._id
}

const CATEGORY_REJECTED = 'That category does not belong to this server'

export const createChannel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!await requirePerm(server, req.user!.sub, 'ManageChannels', res)) return

    const name = String(req.body.name ?? '').trim()
    const type = req.body.type === 'voice' ? 'voice' : req.body.type === 'text' ? 'text' : null
    if (!name || name.length > 100) { res.status(400).json({ message: 'Give the channel a name' }); return }
    if (!type) { res.status(400).json({ message: 'A channel is either text or voice' }); return }

    // Resolving the category and persisting it on the new channel must be
    // atomic with respect to deleteCategory's reparent-then-delete — without
    // the lock, resolveCategory can read a category that still exists, then
    // deleteCategory can reparent + remove it, then Channel.create would
    // still store the now-dead id, stranding a dangling reference. The
    // highest-position read a few lines down rides along in the same
    // critical section; that also happens to close a pre-existing (and
    // separately harmless, writeLimit-bounded) duplicate-position race
    // between two concurrent creates, at no extra cost.
    const serverId = server._id.toString()
    const result = await withServerLock(serverId, async () => {
      // Absent means uncategorised, the same thing an explicit null means —
      // a channel created before there was anywhere to put it.
      const category = await resolveCategory(req.body.category ?? null, server._id)
      if (category === false) return { error: CATEGORY_REJECTED } as const

      // Appended to the end of its own type group.
      const last = await Channel.find({ server: server._id, type }).sort({ position: -1 }).limit(1).lean()
      const position = last.length ? last[0].position + 1 : 0

      const channel = await Channel.create({ server: server._id, name, type, position, category })
      return { channel } as const
    })
    if ('error' in result) { res.status(400).json({ message: result.error }); return }

    const channel = result.channel
    const shaped = shapeChannel(channel)
    emitToServer(server, 'channel:created', { serverId, channel: shaped })

    // Members with the app open must also start RECEIVING the new channel, not
    // merely see it appear. Their sockets joined rooms at connect time, and
    // this channel did not exist then. One socketsJoin call against the union
    // of every member's personal room, rather than an awaited fetchSockets()
    // round trip per member followed by a join loop.

    // Remember which server it belongs to before anyone can be in it: the
    // map is filled at connect time from the channels that existed then, and
    // this one did not. Without it the first call:state for this channel
    // would arrive with no serverId and the rail could not attribute it.
    rememberChannelServer(channel._id.toString(), server._id.toString())
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

    // Per-field, in the shape updateServer already uses, so a channel can be
    // moved between categories without also being renamed. A body that names
    // neither field is still the 400 it has always been: the endpoint asks for
    // something to change, and "nothing" is a client bug, not a no-op worth a
    // 200 and a broadcast.
    const wantsName     = req.body.name !== undefined
    const wantsCategory = req.body.category !== undefined
    const wantsPerms    = req.body.overwrites !== undefined || req.body.hideWhenDenied !== undefined
    // The Overview form submits whichever fields it shows, so the "nothing to
    // change" guard has to count these too or saving only a topic 400s.
    const OVERVIEW = ['topic', 'slowmode', 'userLimit', 'bitrate', 'voiceServer'] as const
    const wantsOverview = OVERVIEW.some(k => req.body[k] !== undefined)
    if (!wantsName && !wantsCategory && !wantsOverview && !wantsPerms) {
      res.status(400).json({ message: 'Give the channel a name' }); return
    }

    /*
     * Two different powers, checked against what the body actually changes.
     *
     * Manage Channels covers the name, the category and the overview fields.
     * Manage Roles covers who may see the channel. Demanding both for a
     * permissions-only edit — which is what an unconditional Manage Channels
     * gate did — would mean nobody could be trusted with the Permissions tab
     * without also being handed the ability to rename and delete the channel.
     */
    if (wantsName || wantsCategory || wantsOverview) {
      if (!requireBits(found.bits, 'ManageChannels', res)) return
    }

    /*
     * Permission edits need Manage Roles, not Manage Channels.
     *
     * Renaming a channel and deciding who may see it are different powers.
     * Someone trusted to tidy the channel list is not thereby trusted to
     * unlock #incidents, and the reference splits them the same way.
     */
    let overwrites: Awaited<ReturnType<typeof validateOverwrites>> = null
    if (wantsPerms) {
      if (!requireBits(found.bits, 'ManageRoles', res)) return
      if (req.body.overwrites !== undefined) {
        overwrites = await validateOverwrites(req.body.overwrites, found.server, found.access, res)
        if (!overwrites) return
      }
    }

    // Validate everything before writing anything: a blank name arriving
    // alongside a valid category must not leave the category moved.
    let name: string | undefined
    if (wantsName) {
      name = String(req.body.name ?? '').trim()
      if (!name || name.length > 100) { res.status(400).json({ message: 'Give the channel a name' }); return }
    }

    /**
     * Overview fields, clamped rather than rejected.
     *
     * A slider that cannot produce an out-of-range value has no legitimate way
     * to send one, so a 400 here would only ever answer a malformed client or a
     * hand-rolled request — and silently pinning to the nearest legal value is
     * the friendlier outcome for both. Names and categories still 400, because
     * an empty name is a real thing a user can type.
     *
     * Validated as a block before anything is written, for the reason the
     * comment above already gives: a bad bitrate must not leave a topic saved.
     */
    const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
      const n = Number(v)
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback
    }
    const overview: Partial<Record<typeof OVERVIEW[number], unknown>> = {}
    if (req.body.topic !== undefined) {
      // Empty string clears it. Stored as null so "no topic" is one value
      // rather than two the header would have to test for separately.
      const t = req.body.topic === null ? null : String(req.body.topic).slice(0, 1024).trim()
      overview.topic = t ? t : null
    }
    if (req.body.slowmode  !== undefined) overview.slowmode  = clamp(req.body.slowmode,  0, MAX_SLOWMODE,   0)
    if (req.body.userLimit !== undefined) overview.userLimit = clamp(req.body.userLimit, 0, MAX_USER_LIMIT, 0)
    if (req.body.bitrate   !== undefined) overview.bitrate   = clamp(req.body.bitrate,   MIN_BITRATE, MAX_BITRATE, 64)
    if (req.body.voiceServer !== undefined) {
      const raw = req.body.voiceServer
      // null clears it back to "follow the server default". Anything that is
      // not a real entry of THIS server is refused rather than stored: a
      // channel pointing at another guild's media server would be resolved
      // away at call time anyway, so storing it only creates a setting that
      // silently does nothing.
      if (raw === null || raw === '') {
        overview.voiceServer = null
      } else if (isInstanceVoiceId(raw)) {
        // Offered to every guild by whoever runs the instance, so there is no
        // ownership to check — only that it still exists in the file.
        if (!findInstanceVoiceServer(raw)) {
          res.status(400).json({ message: 'This instance does not offer that voice server' }); return
        }
        overview.voiceServer = raw
      } else if (typeof raw === 'string' && Types.ObjectId.isValid(raw)) {
        const owned = await VoiceServer.exists({ _id: raw, server: found.server._id })
        if (!owned) { res.status(400).json({ message: 'That voice server does not belong to this server' }); return }
        overview.voiceServer = raw
      } else {
        res.status(400).json({ message: 'That voice server does not belong to this server' }); return
      }
    }
    // This save() moves the channel into a category (or out of one); it has
    // the same race as createChannel against deleteCategory's
    // reparent-then-delete — resolve-then-persist has to be atomic with that,
    // or the save can land after a concurrent delete and store a dead
    // category id. Locked with the same per-server mutex only when a category
    // is actually being touched; a name-only rename never reads or writes
    // `category`, so it has nothing to race and no need to queue behind it.
    const applyUpdate = async (): Promise<{ error: string } | { ok: true }> => {
      let category: Types.ObjectId | null | undefined
      if (wantsCategory) {
        const resolved = await resolveCategory(req.body.category, found.server._id)
        if (resolved === false) return { error: CATEGORY_REJECTED }
        category = resolved
      }

      if (name !== undefined) found.channel.name = name
      if (category !== undefined) found.channel.category = category
      // Applied here, inside the same save, so a channel move and a settings
      // change submitted together are one write rather than two.
      Object.assign(found.channel, overview)
      if (overwrites !== null) found.channel.overwrites = overwrites
      if (req.body.hideWhenDenied !== undefined) {
        found.channel.hideWhenDenied = !!req.body.hideWhenDenied
      }
      await found.channel.save()
      return { ok: true }
    }

    const result = wantsCategory
      ? await withServerLock(found.server._id.toString(), applyUpdate)
      : await applyUpdate()
    if ('error' in result) { res.status(400).json({ message: result.error }); return }

    emitToServer(found.server, 'channel:updated', {
      serverId: found.server._id.toString(), channel: shapeChannel(found.channel),
    })
    res.json({ channel: shapeChannel(found.channel) })
  } catch (err) { next(err) }
}

export const deleteChannel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const found = await loadChannel(req, res); if (!found) return
    // Channel-scoped, not server-scoped: an overwrite can grant Manage
    // Channels for this channel alone.
    if (!requireBits(found.bits, 'ManageChannels', res)) return

    const serverId = found.server._id.toString()
    await withServerLock(serverId, async () => {
      // A server always has somewhere to talk.
      if (found.channel.type === 'text') {
        const texts = await Channel.countDocuments({ server: found.server._id, type: 'text' })
        if (texts <= 1) {
          res.status(400).json({ message: 'You cannot delete the last text channel' }); return
        }
      }
      const channelId = found.channel._id.toString()
      await found.channel.deleteOne()
      // Messages are addressed by conversationId, which for a channel IS the
      // channel id — so once the channel is gone nothing can ever reach them
      // again. Left behind they were unreachable AND permanent, growing the
      // collection by every message of every channel anyone ever deleted.
      // deleteServer already cascades this way; only deleteChannel did not.
      await Message.deleteMany({ conversationId: channelId, kind: 'channel' })
      emitToServer(found.server, 'channel:deleted', {
        serverId: found.server._id.toString(), channelId,
      })
      getIO()?.in(`chan:${channelId}`).socketsLeave(`chan:${channelId}`)
      // Nothing can reach this id again, so drop it rather than growing the
      // map by one entry per channel anyone ever deletes.
      forgetChannelServer(channelId)
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

    // 403 here, not 404: loadChannel already proved they may SEE the channel,
    // so its existence is not a secret from them. A read-only channel should
    // say it is read-only rather than pretend to have vanished.
    if (!has(found.bits, 'SendMessages')) {
      res.status(403).json({ message: 'You cannot send messages in this channel' }); return
    }

    const { content, replyToIds } = req.body as { content?: string; replyToIds?: string[] }
    if (!content?.trim()) { res.status(400).json({ message: 'Content required' }); return }

    /**
     * Slowmode.
     *
     * Enforced HERE and only here: this is the single path by which a channel
     * message is created (the socket paths in chatSocket.ts create DM, group
     * and call-system messages, never channel ones), so there is no second
     * door to hold shut. If a socket send is ever added for channels, this
     * check has to move somewhere both can reach.
     *
     * The owner is exempt, which is what the dialog has always promised and
     * what the client shows as "Slowmode Immune". Exempting them is not a
     * convenience: slowmode exists so one person cannot flood a room, and the
     * person who set it is the one deciding what the room is for.
     *
     * Measured from the last message that person actually landed, not from a
     * timer the client keeps — a refresh, a second tab, or a script would all
     * reset a client-side clock, and none of them can move a stored timestamp.
     */
    const slowmode = found.channel.slowmode ?? 0
    const exempt = found.server.owner.toString() === userId
    if (slowmode > 0 && !exempt) {
      const last = await Message
        .findOne({ conversationId: found.channel._id.toString(), authorId: userId })
        .sort({ createdAt: -1 }).select('createdAt').lean()
      if (last) {
        const elapsed = (Date.now() - new Date(last.createdAt).getTime()) / 1000
        const remaining = Math.ceil(slowmode - elapsed)
        if (remaining > 0) {
          // 429 rather than 403: this is "not yet", not "not allowed", and the
          // client shows a countdown rather than an error. retryAfter is the
          // authority for that countdown — a client clock can drift or be
          // reloaded, and this number cannot.
          res.status(429).json({ message: `Slowmode is on — wait ${remaining}s`, retryAfter: remaining })
          return
        }
      }
    }

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
