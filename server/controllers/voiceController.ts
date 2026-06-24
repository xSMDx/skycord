import { Request, Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import { AccessToken } from 'livekit-server-sdk'
import { config } from '../config/env'
import { Conversation } from '../models/Conversation'
import { User } from '../models/User'
import { dmConvId } from './messagesController'

// A LiveKit room name for a conversation. DMs use the stable sorted-pair id so
// both participants land in the same room; groups use the group id.
export const roomFor = (kind: 'dm' | 'group', convId: string, selfId: string) =>
  kind === 'group' ? `group:${convId}` : `dm:${dmConvId(selfId, convId)}`

// ── Mint a LiveKit access token for a DM/group voice room ─────────────────────
export const getVoiceToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!config.livekit.apiKey || !config.livekit.apiSecret || !config.livekit.url) {
      res.status(503).json({ message: 'Voice is not configured on this server' }); return
    }
    const userId = req.user!.sub
    const { conversationId, kind } = req.body as { conversationId?: string; kind?: 'dm' | 'group' }
    if (!conversationId || (kind !== 'dm' && kind !== 'group')) {
      res.status(400).json({ message: 'conversationId and kind are required' }); return
    }

    // Membership / validity check before handing out a room token.
    if (kind === 'group') {
      if (!mongoose.isValidObjectId(conversationId)) { res.status(400).json({ message: 'Invalid group' }); return }
      const group = await Conversation.findById(conversationId).select('members').lean()
      if (!group) { res.status(404).json({ message: 'Group not found' }); return }
      if (!group.members.some(m => m.toString() === userId)) {
        res.status(403).json({ message: 'You are not a member of this group' }); return
      }
    } else {
      if (conversationId === userId) { res.status(400).json({ message: 'Invalid DM' }); return }
      const partner = await User.findById(conversationId).select('_id').lean()
      if (!partner) { res.status(404).json({ message: 'User not found' }); return }
    }

    const me = await User.findById(userId).select('username displayName').lean()
    const name = me?.displayName || me?.username || 'User'
    const room = roomFor(kind, conversationId, userId)

    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: userId,
      name,
    })
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true })
    const token = await at.toJwt()

    res.json({ token, url: config.livekit.url, room })
  } catch (err) { next(err) }
}
