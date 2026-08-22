import { Request, Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import { AccessToken } from 'livekit-server-sdk'
import { config } from '../config/env'
import { Conversation } from '../models/Conversation'
import { User } from '../models/User'
import { Channel } from '../models/Channel'
import { Server } from '../models/Server'
import { dmConvId } from './messagesController'

// A LiveKit room name for a conversation. DMs use the stable sorted-pair id so
// both participants land in the same room; groups use the group id; server
// voice channels use the channel id, prefixed `voice:` — deliberately NOT
// `chan:`, which is already the Socket.IO room carrying that same channel's
// TEXT traffic. Two other places derive this exact same string independently
// (chatSocket.ts's callRoom, useVoice.ts's voiceRoomName); if any of the three
// disagree, two people both believe they're in a call together while sitting
// in different LiveKit rooms, with no error anywhere.
export const roomFor = (kind: 'dm' | 'group' | 'channel', convId: string, selfId: string) =>
  kind === 'channel' ? `voice:${convId}`
  : kind === 'group' ? `group:${convId}`
  : `dm:${dmConvId(selfId, convId)}`

// ── Mint a LiveKit access token for a DM/group/channel voice room ─────────────
export const getVoiceToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!config.livekit.apiKey || !config.livekit.apiSecret || !config.livekit.url) {
      res.status(503).json({ message: 'Voice is not configured on this server' }); return
    }
    const userId = req.user!.sub
    const { conversationId, kind } = req.body as { conversationId?: string; kind?: 'dm' | 'group' | 'channel' }
    if (!conversationId || (kind !== 'dm' && kind !== 'group' && kind !== 'channel')) {
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
    } else if (kind === 'channel') {
      // Same shape as canAccessMessage's channel branch in chatSocket.ts:
      // resolve Channel -> Server -> members. Plus one extra condition a
      // message doesn't need — a voice token is meaningless for a text
      // channel, so that is checked and refused before authorisation, same
      // ordering sendChannelMessage uses for its own type !== 'text' guard.
      if (!mongoose.isValidObjectId(conversationId)) { res.status(400).json({ message: 'Invalid channel' }); return }
      const channel = await Channel.findById(conversationId).select('server type').lean()
      if (!channel) { res.status(404).json({ message: 'Channel not found' }); return }
      const server = await Server.findById(channel.server).select('members').lean()
      if (!server) { res.status(404).json({ message: 'Server not found' }); return }
      // Matches loadServer (serversController.ts): a non-member gets 403,
      // not 404 — the server (and its channel) are known to exist, the
      // caller simply isn't allowed to act on them.
      if (!server.members.some(m => m.toString() === userId)) {
        res.status(403).json({ message: 'You are not a member of this server' }); return
      }
      if (channel.type !== 'voice') {
        res.status(400).json({ message: 'That is not a voice channel' }); return
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
