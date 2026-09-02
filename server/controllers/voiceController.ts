import { Request, Response, NextFunction } from 'express'
import mongoose from 'mongoose'
import { AccessToken } from 'livekit-server-sdk'
import { config } from '../config/env'
import { resolveForChannel, resolveForConversation } from '../utils/resolveVoiceServer'
import { Conversation } from '../models/Conversation'
import { User } from '../models/User'
import { Channel } from '../models/Channel'
import { Server } from '../models/Server'
import { dmConvId } from './messagesController'
import {
  getCallVoiceServer, fixCallVoiceServer, setCallVoiceServer, announceCallVoiceServer,
  callOccupancy, isInCall,
} from '../sockets/chatSocket'
import { Category } from '../models/Category'
import { loadAccess, channelBits, has } from '../utils/access'
import { parseOverwrites } from '../permissions'

// A LiveKit room name for a conversation. DMs use the stable sorted-pair id so
// both participants land in the same room; groups use the group id; server
// voice channels use the channel id, prefixed `voice:` — deliberately NOT
// `chan:`, which is already the Socket.IO room carrying that same channel's
// TEXT traffic. Two other places derive this exact same string independently
// (chatSocket.ts's callRoom, useVoice.ts's voiceRoomName); if any of those
// three PRODUCERS disagree, two people both believe they're in a call
// together while sitting in different LiveKit rooms, with no error anywhere.
// More than three places touch this grammar overall — ChatApp.vue's
// `incomingCall` (~line 217/231) and `voiceRoomOccupants` (~line 512) also
// switch on the `dm:`/`group:`/`voice:` prefix — but those only need to
// recognise a prefix, not reproduce the whole string, so they're safe without
// being kept in lockstep with the three producers above.
export const roomFor = (kind: 'dm' | 'group' | 'channel', convId: string, selfId: string) =>
  kind === 'channel' ? `voice:${convId}`
  : kind === 'group' ? `group:${convId}`
  : `dm:${dmConvId(selfId, convId)}`

// ── Mint a LiveKit access token for a DM/group/channel voice room ─────────────
export const getVoiceToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Captured in the channel branch below so the resolver can read the
    // override without a second lookup.
    let chosenChannel: {
      server: mongoose.Types.ObjectId
      voiceServer?: string | null
      userLimit?: number
      bitrate?: number
    } | null = null
    const userId = req.user!.sub
    const { conversationId, kind, voiceServerId } = req.body as {
      conversationId?: string; kind?: 'dm' | 'group' | 'channel'
      /** DM/group only — a channel's own setting wins over any preference. */
      voiceServerId?: string | null
    }
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
      // channel — but that is checked AFTER authorisation, not before:
      // membership (403) is resolved first and the type check (400) only
      // runs once the caller is a confirmed member, so a non-member gets the
      // exact same 403 whether the channel is text or voice and can never
      // use this endpoint to learn which one it is.
      if (!mongoose.isValidObjectId(conversationId)) { res.status(400).json({ message: 'Invalid channel' }); return }
      const channel = await Channel.findById(conversationId).select('server type voiceServer userLimit bitrate category overwrites').lean()
      if (!channel) { res.status(404).json({ message: 'Channel not found' }); return }
      chosenChannel = channel
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

      /*
       * Connect, resolved through the category and the channel.
       *
       * This is the only door — LiveKit admits anyone holding a token, so a
       * check that lives in the UI is not a check. A locked voice channel that
       * merely does not appear in the sidebar is still joinable by anyone who
       * knows its id, which is why "private" writes Connect as well as
       * ViewChannels and why both are re-tested here rather than trusted.
       *
       * 404 when they may not even see it, so this cannot be used to discover
       * that a private channel exists; 403 when they can see it but may not
       * join.
       */
      const full = await Server.findById(channel.server)
      if (!full) { res.status(404).json({ message: 'Server not found' }); return }
      const access = await loadAccess(full, userId)
      const cat = channel.category ? await Category.findById(channel.category) : null
      const bits = channelBits(
        access,
        parseOverwrites(cat?.overwrites),
        parseOverwrites((channel as any).overwrites),
      )
      if (!has(bits, 'ViewChannels')) {
        res.status(404).json({ message: 'Channel not found' }); return
      }
      if (!has(bits, 'Connect')) {
        res.status(403).json({ message: 'You cannot join this voice channel' }); return
      }
    } else {
      if (conversationId === userId) { res.status(400).json({ message: 'Invalid DM' }); return }
      const partner = await User.findById(conversationId).select('_id').lean()
      if (!partner) { res.status(404).json({ message: 'User not found' }); return }
    }

    const me = await User.findById(userId).select('username displayName').lean()
    const name = me?.displayName || me?.username || 'User'
    const room = roomFor(kind, conversationId, userId)

    /**
     * The channel's user limit.
     *
     * Checked here because this is the only door: LiveKit will admit anyone
     * holding a valid token, so refusing to MINT one is what actually enforces
     * the cap. Hiding the channel in the UI would not.
     *
     * `0` means unlimited, and someone already in the room is never counted
     * out of it — otherwise a reconnect at exactly the cap would lock a person
     * out of a call they are currently in.
     */
    if (chosenChannel) {
      const limit = chosenChannel.userLimit ?? 0
      if (limit > 0 && !isInCall(room, userId) && callOccupancy(room) >= limit) {
        res.status(403).json({ message: 'This voice channel is full' }); return
      }
    }

    /**
     * Which media server, resolved AFTER the membership checks above.
     *
     * Order matters for more than tidiness: resolving first would let an
     * unauthorised caller learn whether a channel has a custom voice server
     * from the shape of the failure, before being told they cannot join it.
     */
let voice
    if (chosenChannel) {
      voice = await resolveForChannel(chosenChannel.server, chosenChannel.voiceServer ?? null)
    } else {
      // A DM or group has no guild to answer for everybody, so the FIRST token
      // issued for the room fixes the answer and every later joiner is handed
      // it. Without this, two people with different defaults mint tokens
      // against two different LiveKit servers, join same-named rooms on each,
      // and hear nothing while the UI shows a call in progress. A preference is
      // a request to be first, not a right to be answered.
      const fixed = getCallVoiceServer(room)
      voice = await resolveForConversation(
        // Scoped to servers this user belongs to, so a preference cannot be
        // pointed at a media server whose owner never offered it to them. A
        // room fixed on one this caller cannot see degrades to the instance's
        // own the same way any unusable entry does — which splits the call, but
        // only for someone who has left the community since it started.
        fixed !== undefined ? fixed : voiceServerId,
        (await Server.find({ members: userId }).select('_id').lean()).map(s => s._id),
      )
      if (voice) fixCallVoiceServer(room, voice.id)
    }

    // 503 here rather than at the top of the handler: with per-server voice
    // servers, an instance with no LiveKit of its own is still perfectly able
    // to run calls in channels whose owner registered one. Refusing up front
    // on the instance config alone would break exactly that case.
    if (!voice) { res.status(503).json({ message: 'Voice is not configured on this server' }); return }

    const at = new AccessToken(voice.apiKey, voice.apiSecret, { identity: userId, name })
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true })
    const token = await at.toJwt()

    // `voiceServer` is named so the client can SAY where the call is. Whoever
    // supplies the media server can record what crosses it, so being routed to
    // one must never be silent — see the note on the VoiceServer model.
    res.json({
      token, url: voice.url, room,
      voiceServer: { id: voice.id, name: voice.name },
      // kbps. The client caps its microphone publish at this; a channel set to
      // 32 is a channel where nobody sends 64. Absent for DMs and groups,
      // which have no channel to carry a setting.
      ...(chosenChannel ? { bitrate: chosenChannel.bitrate ?? 64 } : {}),
    })
  } catch (err) { next(err) }
}

/**
 * Move a DM or group call to a different media server.
 *
 * Anyone in the call may do it — it is their call, and the alternative is that
 * whoever dialled first decides for everybody until it ends. Everyone in the
 * room is told and rejoins, because LiveKit rooms do not span servers: the only
 * honest way to change one is to leave the old room and enter a new one.
 *
 * Channels are refused rather than supported. A voice channel's server is a
 * setting of the channel, changed in its settings dialog by someone who can
 * edit it — letting any occupant move it from the call bar would hand every
 * member an edit they were never granted.
 *
 * The requested id is put through the same resolver a join uses, so a value
 * that cannot be honoured degrades to the instance's own server rather than
 * failing — and the response says where the call actually went.
 */
export const moveVoiceCall = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub
    const { conversationId, kind, voiceServerId } = req.body as {
      conversationId?: string; kind?: 'dm' | 'group'; voiceServerId?: string | null
    }
    if (!conversationId || (kind !== 'dm' && kind !== 'group')) {
      res.status(400).json({ message: 'conversationId and kind are required' }); return
    }

    // Same membership checks as the token endpoint's dm/group branches, and
    // for the same reason: this writes state that decides where other people's
    // audio goes.
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

    const room = roomFor(kind, conversationId, userId)
    const voice = await resolveForConversation(
      voiceServerId,
      (await Server.find({ members: userId }).select('_id').lean()).map(s => s._id),
    )
    if (!voice) { res.status(503).json({ message: 'Voice is not configured on this server' }); return }

    setCallVoiceServer(room, voice.id)
    // Announced before responding so the mover is not the only one who has
    // rejoined by the time the others are told.
    announceCallVoiceServer(room, { id: voice.id, name: voice.name })
    res.json({ voiceServer: { id: voice.id, name: voice.name } })
  } catch (err) { next(err) }
}
