import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Server } from '../models/Server'
import { Channel } from '../models/Channel'
import { ServerInvite } from '../models/ServerInvite'
import { User } from '../models/User'
import { effectiveStatus } from '../state/presence'

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
    res.json({ server: shapeServer(server) })
  } catch (err) { next(err) }
}

export const deleteServer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    if (!requireOwner(server, req.user!.sub, res)) return
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
    await Server.updateOne({ _id: server._id }, { $pull: { members: target } })
    res.json({ ok: true })
  } catch (err) { next(err) }
}
