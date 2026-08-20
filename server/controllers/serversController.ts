import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Server } from '../models/Server'
import { Channel } from '../models/Channel'
import { ServerInvite } from '../models/ServerInvite'
import { User } from '../models/User'
import { effectiveStatus } from '../state/presence'
import { getIO } from '../sockets/chatSocket'

/** Client shape for a server row. `memberCount` rather than the id array. */
export const shapeServer = (s: any) => ({
  id:          s._id.toString(),
  name:        s.name,
  icon:        s.icon ?? null,
  iconCrop:    s.iconCrop ?? null,
  bannerColor: s.bannerColor ?? null,
  description: s.description ?? null,
  owner:       s.owner.toString(),
  memberCount: s.members.length,
  createdAt:   s.createdAt,
})

export const shapeChannel = (c: any) => ({
  id:       c._id.toString(),
  server:   c.server.toString(),
  name:     c.name,
  type:     c.type,
  position: c.position,
})

/**
 * Reach every connected member of a server. There is no `server:<id>` room —
 * rooms are per channel — so this fans out over the personal `user:<id>`
 * rooms the socket layer already maintains.
 */
export const emitToServer = (server: { members: unknown[] }, event: string, payload: unknown): void => {
  const io = getIO(); if (!io) return
  for (const m of server.members) io.to(`user:${m!.toString()}`).emit(event, payload)
}

/**
 * The one authorisation rule this cycle: you may act on a server if you are a
 * member of it. Responds 404/403 itself and returns null so callers can bail
 * with a single `if`.
 */
export const loadServer = async (req: Request, res: Response) => {
  const { sid } = req.params
  if (!Types.ObjectId.isValid(sid)) { res.status(404).json({ message: 'Server not found' }); return null }
  const server = await Server.findById(sid)
  if (!server) { res.status(404).json({ message: 'Server not found' }); return null }
  const me = req.user!.sub
  if (!server.members.some(m => m.toString() === me)) {
    res.status(403).json({ message: 'You are not a member of this server' }); return null
  }
  return server
}

/** Narrower check for destructive and structural actions. */
export const requireOwner = (server: any, userId: string, res: Response): boolean => {
  if (server.owner.toString() !== userId) {
    res.status(403).json({ message: 'Only the server owner can do that' })
    return false
  }
  return true
}

export const createServer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.sub
    const name = String(req.body.name ?? '').trim()
    if (!name || name.length > 100) { res.status(400).json({ message: 'Give the server a name' }); return }

    const server = await Server.create({ name, owner: userId, members: [userId] })
    // A new server is never an empty screen.
    const channels = await Channel.insertMany([
      { server: server._id, name: 'general', type: 'text',  position: 0 },
      { server: server._id, name: 'General', type: 'voice', position: 0 },
    ])

    // The creator's own sockets have to join these rooms now. Sockets join
    // chan: rooms at connect time (chatSocket) and neither of these channels
    // existed then, so without this the person who just made the server is the
    // one member who receives nothing from it — no messages, no edits, no
    // pins — until they reload. It is the same join createChannel and
    // joinViaInvite already do; only createServer was missing it, which hid
    // the gap behind the reload every other path happens to involve.
    const io = getIO()
    if (io) {
      const rooms = channels.map(c => `chan:${c._id.toString()}`)
      io.in(`user:${userId}`).socketsJoin(rooms)
    }

    res.status(201).json({ server: shapeServer(server), channels: channels.map(shapeChannel) })
  } catch (err) { next(err) }
}

export const getMyServers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const servers = await Server.find({ members: req.user!.sub }).sort({ createdAt: 1 }).lean()
    res.json({ servers: servers.map(shapeServer) })
  } catch (err) { next(err) }
}

export const getServer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    const channels = await Channel.find({ server: server._id }).sort({ type: 1, position: 1 }).lean()
    res.json({ server: shapeServer(server), channels: channels.map(shapeChannel) })
  } catch (err) { next(err) }
}

export const updateServer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return

    const { name, icon, iconCrop, bannerColor, description } = req.body
    if (name !== undefined) {
      const n = String(name).trim()
      if (!n || n.length > 100) { res.status(400).json({ message: 'Give the server a name' }); return }
      server.name = n
    }
    if (icon !== undefined) {
      // Same cap and message as the group-icon update in conversationsController.
      if (icon && String(icon).length > 1_500_000) { res.status(400).json({ message: 'Image is too large' }); return }
      server.icon = icon === null ? null : String(icon)
    }
    if (bannerColor !== undefined) {
      // Same validation as the profile bannerColor in usersController: a
      // strict #rrggbb hex, lowercased, or reject with a friendly 400.
      if (bannerColor === null) server.bannerColor = null
      else if (/^#[0-9a-f]{6}$/i.test(String(bannerColor))) server.bannerColor = String(bannerColor).toLowerCase()
      else { res.status(400).json({ message: 'Banner colour must be a #rrggbb hex' }); return }
    }
    if (description !== undefined) server.description = description === null ? null : String(description).slice(0, 300)
    if (iconCrop !== undefined) {
      const c = iconCrop
      server.iconCrop = c && typeof c === 'object'
        ? { zoom: Number(c.zoom) || 1, x: Number(c.x) || 0, y: Number(c.y) || 0 }
        : null
    }
    await server.save()
    emitToServer(server, 'server:updated', { server: shapeServer(server) })
    res.json({ server: shapeServer(server) })
  } catch (err) { next(err) }
}

export const deleteServer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return

    // Gathered before anything is deleted: emitToServer reads the member
    // list off the document, and the room list needs the channel ids —
    // both are gone once the deletes below run.
    const channels = await Channel.find({ server: server._id }).select('_id').lean()
    const rooms = channels.map(c => `chan:${c._id.toString()}`)

    // There was no event at all for this, so a member's client had no way
    // to make the server disappear from their rail. Must fire before the
    // documents are removed, for the same reason the room list above is
    // gathered early.
    emitToServer(server, 'server:deleted', { serverId: server._id.toString() })

    // Evict every member's sockets from this server's channel rooms — the
    // analogue of the removeMember eviction below, but for all members at
    // once since the whole server is going away. Without this, chan: traffic
    // (there is none left to emit, but the rooms themselves persist on the
    // socket) would otherwise linger until each socket happens to reconnect.
    // One call across every member room, mirroring createChannel's join.
    // Guarded on a non-empty member list too: Socket.IO treats io.in([]) as
    // "every connected socket", not "nobody" — an empty array here would
    // silently evict every connected user from these rooms. Unreachable
    // today (the owner can never leave, so a server's member list can't be
    // emptied), but structurally safe rather than incidentally safe.
    if (rooms.length && server.members.length) {
      const io = getIO()
      if (io) io.in(server.members.map(m => `user:${m.toString()}`)).socketsLeave(rooms)
    }

    await Channel.deleteMany({ server: server._id })
    // Invites with expiresAt: null are skipped by the TTL index and would
    // otherwise outlive the server they point at.
    await ServerInvite.deleteMany({ server: server._id })
    await server.deleteOne()
    res.json({ ok: true })
  } catch (err) { next(err) }
}

export const getServerMembers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    const users = await User.find({ _id: { $in: server.members } })
      .select('username displayName discriminator avatar avatarCrop status').lean()
    res.json({
      members: users.map((u: any) => ({
        id:          u._id.toString(),
        username:    u.username,
        displayName: u.displayName,
        avatar:      u.avatar ?? null,
        avatarCrop:  u.avatarCrop ?? null,
        // Computed, never the stored column — that column is only ever the
        // user's chosen status, not whether they are reachable.
        status:      effectiveStatus(u.status, u._id.toString()),
        isOwner:     server.owner.toString() === u._id.toString(),
      })),
    })
  } catch (err) { next(err) }
}

/** Kick when someone else, leave when yourself. The owner may do neither. */
export const removeMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    const me = req.user!.sub
    const target = req.params.uid
    const isSelf = target === me

    if (target === server.owner.toString()) {
      res.status(400).json({ message: 'The owner cannot leave their own server' }); return
    }
    if (!isSelf && !requireOwner(server, me, res)) return

    // Guard against malformed ids that Mongoose would try to cast, throwing
    // a CastError. This keeps the endpoint idempotent: a non-castable id
    // matches nothing and succeeds with 200 OK.
    if (!Types.ObjectId.isValid(target)) { res.json({ ok: true }); return }

    // Atomic $pull, not read/filter/save: a plain save() would emit a full
    // $set of the array, and versionKey: false means there is no optimistic-
    // concurrency backstop — a kick racing a concurrent join could silently
    // drop the joiner. $pull removes exactly the one id, however the
    // document has changed underneath since it was loaded.
    // The filter includes `members: target`, not just `_id`, so a target
    // that isn't in the array fails to match the DOCUMENT at all — not just
    // the array element. That distinction matters because the schema has
    // `timestamps: true`: with a filter of only `{ _id }`, Mongoose bumps
    // `updatedAt` on every call regardless of whether $pull found anything,
    // which makes modifiedCount read 1 even on a genuine no-op. Folding the
    // membership check into the filter (the same trick joinViaInvite uses
    // for its `$ne` condition) means a non-match skips the write entirely,
    // so modifiedCount stays a trustworthy signal.
    const upd = await Server.updateOne(
      { _id: server._id, members: target },
      { $pull: { members: target } }
    )
    // Only announce a departure when the $pull actually removed someone — a
    // target who was never a member, or one a racing request already
    // removed, is a no-op and must not tell every client someone left. The
    // HTTP response stays the idempotent-DELETE `{ ok: true }` either way.
    if (upd.modifiedCount === 1) {
      emitToServer(server, 'server:memberLeft', {
        serverId: server._id.toString(), userId: target,
      })
      // REST is already 403'd for this user going forward, but their sockets
      // joined chan: rooms at connect time and nothing evicted them — live
      // channel traffic kept reaching them for the rest of the socket's
      // life. Mirrors deleteChannel's socketsLeave, scoped to this one user
      // across every channel of this server, in a single call.
      const channels = await Channel.find({ server: server._id }).select('_id').lean()
      const rooms = channels.map(c => `chan:${c._id.toString()}`)
      if (rooms.length) getIO()?.in(`user:${target}`).socketsLeave(rooms)
    }
    res.json({ ok: true })
  } catch (err) { next(err) }
}
