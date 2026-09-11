import type { Types } from 'mongoose'
import { Server } from '../models/Server'
import { Channel } from '../models/Channel'
import { Category } from '../models/Category'
import { getIO } from './chatSocket'
import {
  loadMemberAccess, categoryOverwriteMap, channelViewOf, type VisibleChannelLike,
} from '../utils/access'
import { shapeChannel } from '../controllers/serversController'

/**
 * Who hears about a channel, decided member by member.
 *
 * There is no `server:<id>` room, and the `chan:<id>` rooms used to hold every
 * member of a server. Anything addressed to either reached people the REST read
 * would never have shown the channel to — a private channel's messages
 * included. Everything here answers with `channelViewOf`, the rule
 * GET /servers/:sid uses, so the live wire and the sidebar agree.
 *
 * Each call loads its own fresh copy of the server rather than taking the
 * caller's. Callers hold a document read before their write, and a role
 * assignment judged against the memberRoles from before it would put the
 * member in exactly the rooms they are leaving.
 *
 * Failures are logged, not thrown: every caller has already committed its
 * write, and a 500 for a broadcast that went wrong would tell the client its
 * change failed when it did not.
 */

type Id = string | Types.ObjectId
type ChannelRow = VisibleChannelLike & { _id: Types.ObjectId }

const room = (id: Id) => `chan:${id.toString()}`

const loadView = async (serverId: Id) => {
  const server = await Server.findById(serverId).select('owner members memberRoles').lean()
  if (!server) return null
  const [categories, accessOf] = await Promise.all([
    Category.find({ server: server._id }).select('_id overwrites').lean(),
    loadMemberAccess(server),
  ])
  const catOverwrites = await categoryOverwriteMap(categories as never)
  return {
    members: server.members.map(m => m.toString()),
    viewOf: (uid: string, c: VisibleChannelLike) => channelViewOf(accessOf(uid), c, catOverwrites),
  }
}

const guarded = async (what: string, run: () => Promise<void>): Promise<void> => {
  try { await run() } catch (err) { console.error(`[visibility] ${what}`, err) }
}

/**
 * Put members' sockets in exactly the channel rooms they may see.
 *
 * Call after anything that can change who sees what: an overwrite on a channel
 * or a category, a channel changing category, a category deleted, a role's
 * permissions, a role deleted, a member's roles, a channel created.
 *
 * `announce` (on by default) also tells each of them to refetch the server.
 * That is how a sidebar drops a channel it may no longer show, and how a
 * member picks up permissions they have just been given: there is no finer
 * event saying "you can now see X", and inventing one per case would be a
 * second copy of the rule above.
 */
export const refreshChannelAccess = (
  serverId: Id, opts: { only?: string[]; announce?: boolean } = {},
): Promise<void> => guarded('refreshChannelAccess', async () => {
  const io = getIO(); if (!io) return
  const view = await loadView(serverId); if (!view) return
  const targets = opts.only ? view.members.filter(m => opts.only!.includes(m)) : view.members
  if (!targets.length) return

  const channels = await Channel.find({ server: serverId })
    .select('_id category overwrites hideWhenDenied').lean()
  const sid = serverId.toString()
  for (const uid of targets) {
    const join: string[] = [], leave: string[] = []
    for (const c of channels) (view.viewOf(uid, c as never) === 'full' ? join : leave).push(room(c._id))
    // Each list checked for emptiness: the target is always one personal
    // room, and nothing here may ever become an `io.in([])`, which Socket.IO
    // reads as "every socket in the process".
    if (join.length)  io.in(`user:${uid}`).socketsJoin(join)
    if (leave.length) io.in(`user:${uid}`).socketsLeave(leave)
    if (opts.announce !== false) io.to(`user:${uid}`).emit('server:accessChanged', { serverId: sid })
  }
})

/**
 * `channel:created` or `channel:updated`, each member sent what
 * GET /servers/:sid would show them: the channel, a locked stub, or nothing.
 */
export const emitChannelEvent = (
  serverId: Id, event: 'channel:created' | 'channel:updated', channel: ChannelRow,
): Promise<void> => guarded(event, async () => {
  const io = getIO(); if (!io) return
  const view = await loadView(serverId); if (!view) return
  const sid = serverId.toString()
  for (const uid of view.members) {
    const v = view.viewOf(uid, channel)
    if (v === 'none') continue
    io.to(`user:${uid}`).emit(event, { serverId: sid, channel: shapeChannel(channel, v === 'locked') })
  }
})

/** `channels:reordered`, each member's copy cut down to what they may see. */
export const emitChannelsReordered = (
  serverId: Id, bucket: { category: string | null; type: 'text' | 'voice' }, channels: ChannelRow[],
): Promise<void> => guarded('channels:reordered', async () => {
  const io = getIO(); if (!io) return
  const view = await loadView(serverId); if (!view) return
  const sid = serverId.toString()
  for (const uid of view.members) {
    const shown = channels.flatMap(c => {
      const v = view.viewOf(uid, c)
      return v === 'none' ? [] : [shapeChannel(c, v === 'locked')]
    })
    // Nothing they can see moved, so there is nothing to tell them.
    if (!shown.length) continue
    io.to(`user:${uid}`).emit('channels:reordered', { serverId: sid, ...bucket, channels: shown })
  }
})
