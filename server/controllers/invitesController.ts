import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Server, MAX_SERVER_MEMBERS } from '../models/Server'
import { Channel } from '../models/Channel'
import { ServerInvite } from '../models/ServerInvite'
import { User } from '../models/User'
import { generateInviteCode } from '../utils/inviteCode'
import { loadServer, requireOwner, shapeServer, shapeChannel } from './serversController'

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
 * Join. Expired, revoked and full are three different problems and get three
 * different answers — a single generic failure would leave the user guessing.
 */
export const joinViaInvite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.sub
    const invite = await ServerInvite.findOne({ code: req.params.code })
    if (!invite) { res.status(404).json({ message: 'That invite does not exist' }); return }
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      res.status(410).json({ message: 'This invite has expired' }); return
    }

    const server = await Server.findById(invite.server)
    if (!server) { res.status(404).json({ message: 'That server no longer exists' }); return }

    const already = server.members.some(m => m.toString() === userId)
    if (!already) {
      if (server.members.length >= MAX_SERVER_MEMBERS) {
        res.status(409).json({ message: 'This server is full' }); return
      }
      server.members.push(new Types.ObjectId(userId))
      await server.save()
      invite.uses += 1
      await invite.save()
    }

    const channels = await Channel.find({ server: server._id }).sort({ type: 1, position: 1 }).lean()
    res.json({ server: shapeServer(server), channels: channels.map(shapeChannel), joined: !already })
  } catch (err) { next(err) }
}
