import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Channel } from '../models/Channel'
import { loadServer, requireOwner, shapeChannel } from './serversController'

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

    // A server always has somewhere to talk.
    if (found.channel.type === 'text') {
      const texts = await Channel.countDocuments({ server: found.server._id, type: 'text' })
      if (texts <= 1) {
        res.status(400).json({ message: 'You cannot delete the last text channel' }); return
      }
    }
    await found.channel.deleteOne()
    res.json({ ok: true })
  } catch (err) { next(err) }
}
