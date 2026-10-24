import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Message } from '../models/Message'
import { User } from '../models/User'
import { Server } from '../models/Server'
import { Channel } from '../models/Channel'
import { Category } from '../models/Category'
import { Conversation } from '../models/Conversation'
import { loadAccess, categoryOverwriteMap, channelViewOf } from '../utils/access'

/**
 * What did I miss: the messages that would have notified this person while a
 * phone's background connection was down.
 *
 * The server keeps no read state, so this is deliberately not "what is unread".
 * It is "since T, what would the rules have buzzed for", which is the same
 * question the live socket answers one message at a time. The phone still
 * applies its own rules to the result — mutes, Do Not Disturb, levels — so a
 * mute set during the gap is respected there, and this does not need to know
 * about it: muted conversations are returned.
 */

/** Never reach further back than this, whatever `since` says. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000
/** The newest this many from one conversation: a burst is one notification anyway. */
const PER_CONVERSATION = 5
/** And this many in all, newest first. */
const TOTAL = 100
/** Queries in flight at once. One per conversation is cheap; hundreds together are not. */
const PARALLEL = 20

/** A server left alone is Only @mentions: the same default notifyLevels.ts holds. */
const SERVER_DEFAULT = 'mentions'

type Prefs = Record<string, { level?: string } | undefined>

/** The notification level that applies: the nearest set on channel, category, server. */
const levelAt = (prefs: Prefs, chain: string[]): 'all' | 'mentions' | 'nothing' => {
  for (const id of chain) {
    const level = prefs[id]?.level
    if (level === 'all' || level === 'mentions' || level === 'nothing') return level
  }
  return SERVER_DEFAULT
}

interface ChannelInfo { serverId: string; categoryId: string | null; all: boolean }

/**
 * The text channels this person may read, in servers they belong to, each with
 * where it sits and whether its effective level is All messages.
 *
 * Readability is the one rule every path that hands a channel to a client goes
 * through — loadAccess once per server, channelViewOf once per channel, and
 * only 'full' counts — so a channel hidden from someone is never summarised
 * for them here either. A locked stub shows a name and never a message, so it
 * is no more readable here than anywhere else.
 */
const readableChannels = async (userId: string, prefs: Prefs): Promise<Map<string, ChannelInfo>> => {
  const servers = await Server.find({ members: new Types.ObjectId(userId) })
    .select('_id owner memberRoles').lean()
  const found = new Map<string, ChannelInfo>()
  if (!servers.length) return found

  const serverIds = servers.map(s => s._id)
  const [channels, categories, accesses] = await Promise.all([
    Channel.find({ server: { $in: serverIds }, type: 'text' }).select('_id server category overwrites').lean(),
    Category.find({ server: { $in: serverIds } }).select('_id overwrites').lean(),
    Promise.all(servers.map(s => loadAccess(s, userId))),
  ])
  const accessOf = new Map(servers.map((s, i) => [s._id.toString(), accesses[i]]))
  const categoryOverwrites = await categoryOverwriteMap(categories)

  for (const c of channels) {
    const serverId = c.server.toString()
    const categoryId = c.category ? c.category.toString() : null
    if (channelViewOf(accessOf.get(serverId)!, c, categoryOverwrites) !== 'full') continue
    const chain = categoryId ? [c._id.toString(), categoryId, serverId] : [c._id.toString(), serverId]
    found.set(c._id.toString(), { serverId, categoryId, all: levelAt(prefs, chain) === 'all' })
  }
  return found
}

/** Newest first; the id breaks a tie so two requests agree on the order. */
const newestFirst = (x: { _id: unknown; createdAt: Date }, y: { _id: unknown; createdAt: Date }) =>
  +y.createdAt - +x.createdAt || (String(y._id) < String(x._id) ? -1 : 1)

export const getMissed = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Taken before anything is read and sent back as `now`: the phone sends it as
    // the next `since`, so a message written while these queries run is seen
    // again then rather than falling in the gap. A repeat is harmless — a
    // notification's id is its message id, so it replaces rather than stacks.
    const now = Date.now()

    const raw = typeof req.query.since === 'string' ? req.query.since.trim() : ''
    const asked = raw === '' ? NaN : Number(raw)
    // Epoch milliseconds. 8.64e15 is the last instant a Date can hold.
    if (!Number.isFinite(asked) || asked < 0 || asked > 8.64e15) {
      res.status(400).json({ message: 'since is required' }); return
    }
    const since = new Date(Math.max(asked, now - MAX_AGE_MS))

    const userId = req.user!.sub
    // It goes into a regex below, as it does in getMyDMs.
    if (!/^[a-f0-9]{24}$/i.test(userId)) { res.status(400).json({ message: 'Invalid user' }); return }
    const me = new Types.ObjectId(userId)

    // convPrefs is select:false, and `+convPrefs` beside an inclusion list would
    // silently drop it, so it is named in the list instead.
    const user = await User.findById(userId).select('convPrefs').lean()
    if (!user) { res.status(404).json({ message: 'User not found' }); return }
    // Lean leaves the prefs Map as the plain object it is stored as.
    const prefs = (user.convPrefs ?? {}) as unknown as Prefs

    const [groups, channels] = await Promise.all([
      Conversation.find({ members: me }).select('_id').lean(),
      readableChannels(userId, prefs),
    ])

    // A channel at a quiet level still counts for a mention or an @everyone.
    // The mention is the id the message resolved to when it was written
    // (Message.mentions, filled by the model's hook and backfilled for older
    // rows), not a pattern run over every message's text in the window. The
    // index { conversationId, mentions, createdAt } answers it.
    const forMe = [{ mentionsEveryone: true }, { mentions: me }]
    const allIds   = [...channels].filter(([, c]) => c.all).map(([id]) => id)
    const quietIds = [...channels].filter(([, c]) => !c.all).map(([id]) => id)

    /**
     * Step 1: which conversations have anything in the window, and when the
     * newest of it was. Nothing is read from a document, so the cost does not
     * grow with how much was said — every filter here is on the two fields of
     * the { conversationId, createdAt } index, and a conversation that turns out
     * to hold only the caller's own words or a system line is weeded out in
     * step 2. The exception is a quiet channel, where the lookup is "mentions me
     * or @everyone": each side has its own index on the conversation, so the
     * two are unioned there too and no message is read to be tested.
     *
     * A DM has no document of its own: its id is the two user ids, sorted and
     * joined by `_`, so the caller is the prefix or the suffix. The prefix form
     * is an index range; the suffix form reads every key of the index, as
     * getMyDMs does, and still touches no document.
     */
    const fresh = { createdAt: { $gte: since } }
    const active = (match: object) => Message.aggregate<{ _id: string; last: Date }>([
      { $match: { ...fresh, ...match } },
      { $group: { _id: '$conversationId', last: { $max: '$createdAt' } } },
    ])
    const [dmsLow, dmsHigh, inGroups, inAll, inQuiet] = await Promise.all([
      active({ conversationId: { $regex: `^${userId}_` } }),
      active({ conversationId: { $regex: `_${userId}$` } }),
      groups.length ? active({ conversationId: { $in: groups.map(g => g._id.toString()) } }) : [],
      allIds.length ? active({ conversationId: { $in: allIds } }) : [],
      quietIds.length ? active({ conversationId: { $in: quietIds }, kind: 'channel', authorId: { $ne: me }, $or: forMe }) : [],
    ])

    // `match` is what step 2 asks of each conversation's messages. Never the
    // caller's own, and never a system message: each names its `kind`.
    type Hit = { id: string; last: Date; match: object }
    const hits = new Map<string, Hit>()
    const add = (rows: { _id: string; last: Date }[], match: object) => {
      for (const r of rows) hits.set(r._id, { id: r._id, last: r.last, match })
    }
    add([...dmsLow, ...dmsHigh], { kind: 'dm' })
    add(inGroups, { kind: 'group' })
    add(inAll, { kind: 'channel' })
    add(inQuiet, { kind: 'channel', $or: forMe })
    const byRecency = [...hits.values()].sort((x, y) => +y.last - +x.last)

    /**
     * Step 2: the newest few from each, most recently active first.
     *
     * Stops early. A conversation's `last` is no older than anything in it that
     * counts, so once TOTAL messages are in hand and the TOTAL-th is newer than
     * the next conversation's `last`, nothing unread can place among them. That
     * keeps the work in step with what is returned, not with how many
     * conversations were quiet.
     */
    const read = (h: Hit) =>
      Message.find({ createdAt: { $gte: since }, authorId: { $ne: me }, ...h.match, conversationId: h.id })
        .sort({ createdAt: -1 })
        .limit(PER_CONVERSATION)
        .select('conversationId kind authorId authorName content createdAt mentionsEveryone')
        .lean()
    let rows: Awaited<ReturnType<typeof read>> = []
    for (let i = 0; i < byRecency.length; i += PARALLEL) {
      if (rows.length >= TOTAL && +rows[TOTAL - 1].createdAt > +byRecency[i].last) break
      const batch = await Promise.all(byRecency.slice(i, i + PARALLEL).map(read))
      rows = [...rows, ...batch.flat()].sort(newestFirst).slice(0, TOTAL)
    }

    const events = rows.map(m => {
      const common = {
        _id: m._id.toString(), conversationId: m.conversationId,
        authorId: m.authorId.toString(), authorName: m.authorName, content: m.content,
        createdAt: m.createdAt.toISOString(),
      }
      if (m.kind === 'channel') {
        const where = channels.get(m.conversationId)!
        return {
          type: 'channel' as const, ...common,
          serverId: where.serverId, categoryId: where.categoryId, mentionsEveryone: !!m.mentionsEveryone,
        }
      }
      return { type: m.kind as 'dm' | 'group', ...common }
    })

    res.json({ now, events })
  } catch (err) { next(err) }
}
