import type { Request, Response, NextFunction } from 'express'
import { Server, MAX_SERVER_MEMBERS } from '../models/Server'
import { Channel } from '../models/Channel'
import { Category } from '../models/Category'
import { ServerInvite } from '../models/ServerInvite'
import { User } from '../models/User'
import { generateInviteCode } from '../utils/inviteCode'
import { loadServer, requireOwner, shapeServer, shapeChannel, shapeCategory, emitToServer } from './serversController'
import { effectiveStatus } from '../state/presence'
import { getIO } from '../sockets/chatSocket'

const DAY = 24 * 60 * 60 * 1000
const expiryFor = (v: unknown): Date | null =>
  v === 'never' ? null : v === '7d' ? new Date(Date.now() + 7 * DAY) : new Date(Date.now() + DAY)

const shapeInvite = (i: any, inviter?: any) => ({
  code:      i.code,
  uses:      i.uses,
  expiresAt: i.expiresAt ?? null,
  createdAt: i.createdAt,
  inviter:   inviter ? { id: inviter._id.toString(), username: inviter.username } : null,
})

export const createInvite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return

    // base64url of 6 bytes; retry on the vanishingly rare collision.
    let code = generateInviteCode()
    for (let i = 0; i < 5 && await ServerInvite.exists({ code }); i++) code = generateInviteCode()

    const invite = await ServerInvite.create({
      code, server: server._id, createdBy: req.user!.sub, expiresAt: expiryFor(req.body.expiry),
    })
    res.status(201).json({ invite: shapeInvite(invite, { _id: req.user!.sub, username: req.user!.username }) })
  } catch (err) { next(err) }
}

export const listInvites = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return

    const invites = await ServerInvite.find({ server: server._id }).sort({ createdAt: -1 }).lean()
    const users = await User.find({ _id: { $in: invites.map(i => i.createdBy) } })
      .select('username').lean()
    const byId = new Map(users.map((u: any) => [u._id.toString(), u]))
    res.json({ invites: invites.map(i => shapeInvite(i, byId.get(i.createdBy.toString()))) })
  } catch (err) { next(err) }
}

export const revokeInvite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return
    await ServerInvite.deleteOne({ server: server._id, code: req.params.code })
    res.json({ ok: true })
  } catch (err) { next(err) }
}

/**
 * What a join screen needs, and nothing more. Deliberately omits the member
 * list and the channel list: the caller is not a member yet, and a preview
 * that leaked either would make an invite code a directory of who is inside.
 */
export const previewInvite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invite = await ServerInvite.findOne({ code: req.params.code })
    if (!invite) { res.status(404).json({ message: 'That invite does not exist' }); return }
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      res.status(410).json({ message: 'This invite has expired' }); return
    }
    const server = await Server.findById(invite.server)
    if (!server) { res.status(404).json({ message: 'That server no longer exists' }); return }

    const userId = req.user!.sub
    res.json({
      server: {
        id:          server._id.toString(),
        name:        server.name,
        icon:        server.icon ?? null,
        iconCrop:    server.iconCrop ?? null,
        bannerColor: server.bannerColor ?? null,
        description: server.description ?? null,
        memberCount: server.members.length,
      },
      alreadyMember: server.members.some(m => m.toString() === userId),
      full:          server.members.length >= MAX_SERVER_MEMBERS,
    })
  } catch (err) { next(err) }
}

/**
 * Join. Expired, revoked and full are three different problems and get three
 * different answers — a single generic failure would leave the user guessing.
 *
 * The membership check-and-add is a single atomic `updateOne`, not a plain
 * document read/push/save. Two concurrent joins (two users racing the cap,
 * or one user double-clicking the same link) would otherwise both read the
 * same pre-write state, both pass their checks, and both write — breaching
 * the cap or duplicating the member id. A transaction isn't available (this
 * Mongo is a standalone instance, no replica set), and a per-process lock
 * like `withServerLock` isn't needed either: the invariant lives entirely
 * inside one document, so a single conditional update closes it completely
 * — and unlike an in-process lock, it still holds if this API ever runs as
 * more than one process.
 */
export const joinViaInvite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.sub
    const invite = await ServerInvite.findOne({ code: req.params.code })
    if (!invite) { res.status(404).json({ message: 'That invite does not exist' }); return }
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      res.status(410).json({ message: 'This invite has expired' }); return
    }

    let server = await Server.findById(invite.server)
    if (!server) { res.status(404).json({ message: 'That server no longer exists' }); return }

    const alreadyBefore = server.members.some(m => m.toString() === userId)
    let joined = false

    if (!alreadyBefore) {
      // Matches only if the caller isn't already a member AND the server
      // isn't at the cap (the guard checks that the slot one below the cap
      // doesn't exist, i.e. current length < MAX_SERVER_MEMBERS). One round
      // trip, no window between the check and the write.
      const upd = await Server.updateOne(
        {
          _id: invite.server,
          members: { $ne: userId },
          [`members.${MAX_SERVER_MEMBERS - 1}`]: { $exists: false },
        },
        { $addToSet: { members: userId } }
      )

      if (upd.modifiedCount === 1) {
        joined = true
        // Atomic $inc, not read/modify/write: two different users joining
        // concurrently would otherwise both read uses=0 and both write 1,
        // under-counting by one.
        await ServerInvite.updateOne({ _id: invite._id }, { $inc: { uses: 1 } })
        const fresh = await Server.findById(invite.server) ?? server
        server = fresh

        const joiner = await User.findById(userId)
          .select('username displayName avatar avatarCrop status statusUntil').lean()
        if (joiner) {
          emitToServer(fresh, 'server:memberJoined', {
            serverId: fresh._id.toString(),
            member: {
              id:          userId,
              username:    (joiner as any).username,
              displayName: (joiner as any).displayName,
              avatar:      (joiner as any).avatar ?? null,
              avatarCrop:  (joiner as any).avatarCrop ?? null,
              // Computed, never the stored column.
              status:      effectiveStatus((joiner as any).status, userId, (joiner as any).statusUntil),
              isOwner:     false,
            },
          })
        }
      } else {
        // No match: either this user is already a member (lost a race to
        // another request adding them — a double-click) or the server is
        // full. Re-read to tell those apart; only one of them is a 409.
        const fresh = await Server.findById(invite.server)
        if (!fresh) { res.status(404).json({ message: 'That server no longer exists' }); return }
        server = fresh
        const nowMember = server.members.some(m => m.toString() === userId)
        if (!nowMember) {
          res.status(409).json({ message: 'This server is full' }); return
        }
        // Else: someone else's concurrent request already added this same
        // user — fall through to the idempotent 200 below, same as if they
        // had already been a member before this request started.
      }
    }

    const channels = await Channel.find({ server: server._id }).sort({ type: 1, position: 1 }).lean()
    // Fetched and sorted exactly as getServer does, because this response is
    // the ONLY detail payload a joining member gets: the client folds it in
    // with the same `receiveDetail` that consumes GET /servers/:sid, and then
    // caches it. Omitting categories here does not merely delay them — it
    // writes an authoritative empty list the client has no reason to ever
    // refetch, so every channel renders flat, with no headers, until a full
    // page reload. (Client-side, `openServer` now also refuses to treat a
    // categories-less cache as populated; both halves of that belt-and-braces
    // are deliberate.)
    const categories = await Category.find({ server: server._id }).sort({ position: 1 }).lean()

    // A member who joins while already connected must start RECEIVING this
    // server's channels immediately, not only after a reconnect — their
    // sockets joined rooms once, at connect time, before this membership
    // existed. Gated on `joined` (true only for a genuine new join here),
    // never for the idempotent "already a member" / lost-the-race branches
    // above, whose sockets are already correctly in these rooms already.
    if (joined) {
      const rooms = channels.map(c => `chan:${c._id.toString()}`)
      if (rooms.length) getIO()?.in(`user:${userId}`).socketsJoin(rooms)
    }

    res.json({
      server:     shapeServer(server),
      channels:   channels.map(shapeChannel),
      categories: categories.map(shapeCategory),
      joined,
    })
  } catch (err) { next(err) }
}
