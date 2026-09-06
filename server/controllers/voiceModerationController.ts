import { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { Server } from '../models/Server'
import { Channel } from '../models/Channel'
import { loadServer, emitToServer } from './serversController'
import { Category } from '../models/Category'
import { loadAccess, channelBits, has } from '../utils/access'
import { canActOnMember, parseOverwrites } from '../permissions'
import { resolveForChannel } from '../utils/resolveVoiceServer'
import { voiceRoomOfUser, dropFromCall } from '../sockets/chatSocket'
import {
  applyLiveRestriction, evictFromVoice, NO_RESTRICTION,
  publishGrantFor, UNRESTRICTED_PERMITS,
  type VoiceRestriction, type LiveOutcome, type VoicePermits,
} from '../utils/voiceModeration'

/**
 * Server mute, server deafen and disconnect.
 *
 * The first moderation in this codebase that acts on somebody else's client
 * rather than on a record, which is why it was deliberately parked until the
 * permission model existed. Three rules hold it together, and none is optional:
 *
 *   1. **Authorisation is canActOnMember**, the same helper kicking uses. A
 *      flat permission check is not enough: two moderators who both hold
 *      MuteMembers must not be able to mute each other, and the owner must be
 *      unreachable even to an administrator.
 *   2. **Each flag needs its OWN permission**, checked only when that flag
 *      changes. MuteMembers and DeafenMembers are separate bits, and a request
 *      that only lifts a mute must not demand the power to deafen.
 *   3. **Persist first, then enforce live.** The database is what survives a
 *      reconnect, a redeploy and a media server outage; the live call is the
 *      immediate courtesy. Doing it the other way round would leave a mute that
 *      worked until the person pressed refresh.
 */

/** The stored restriction for a member, or none. */
const restrictionOf = (server: any, userId: string): VoiceRestriction => {
  const row = (server.memberVoice ?? []).find((v: any) => v.user.toString() === userId)
  return row ? { mute: !!row.mute, deafen: !!row.deafen } : NO_RESTRICTION
}

/** Exported for the token mint, which has to ask the same question. */
export const voiceRestrictionFor = restrictionOf

/** Speak and Video for one person in one channel, through the same resolution
 *  the token mint uses — category overwrites then channel overwrites. */
const permitsInChannel = async (
  guild: any, userId: string, channel: any,
): Promise<VoicePermits> => {
  const access = await loadAccess(guild, userId)
  const cat = channel.category ? await Category.findById(channel.category).lean() : null
  const bits = channelBits(
    access,
    parseOverwrites(cat?.overwrites),
    parseOverwrites(channel.overwrites),
  )
  return { speak: has(bits, 'Speak'), video: has(bits, 'Video') }
}

/**
 * Push a member's restriction into the live call, if they are in one.
 *
 * Returns what actually happened so the caller can say so. A member who is not
 * in a voice channel is `absent`, which is a success: the flags are stored and
 * the token they are handed on their next join carries them.
 */
const enforceLive = async (
  serverId: Types.ObjectId,
  userId: string,
  restriction: VoiceRestriction,
): Promise<LiveOutcome> => {
  const room = voiceRoomOfUser(userId)
  if (!room) return 'absent'

  // `voice:<channelId>` — and the channel has to belong to THIS server, or a
  // moderator here could reach into a call happening in another one.
  const channelId = room.slice(6)
  const channel = await Channel.findById(channelId)
    .select('server voiceServer category overwrites').lean()
  if (!channel || channel.server.toString() !== serverId.toString()) return 'absent'

  const voice = await resolveForChannel(channel.server, channel.voiceServer ?? null)
  if (!voice) return 'absent'

  /*
   * The TARGET's channel permissions, not just the restriction being changed.
   *
   * A permission update in LiveKit is atomic — it replaces the whole set — so
   * sending one built from the mute flag alone would hand back whatever the
   * channel had taken away. Lifting a mute would silently grant a camera in a
   * channel whose overwrite denies Video.
   */
  const guild = await Server.findById(channel.server)
  const permits = guild
    ? await permitsInChannel(guild, userId, channel)
    : UNRESTRICTED_PERMITS
  const grant = publishGrantFor(permits, restriction)

  const outcome = await applyLiveRestriction(voice, room, userId, grant)
  // An eviction means they are no longer in the LiveKit room, so the occupancy
  // this process is holding is now wrong for everybody looking at the sidebar.
  if (outcome === 'evicted') dropFromCall(room, userId)
  return outcome
}

/**
 * PATCH /servers/:sid/members/:uid/voice — set or lift mute and deafen.
 *
 * Both fields are optional and only what is present is changed, so the two
 * powers stay independently usable by people who hold only one of them.
 */
export const setMemberVoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    const me = req.user!.sub
    const target = req.params.uid

    const { mute, deafen } = req.body as { mute?: unknown; deafen?: unknown }
    if (mute === undefined && deafen === undefined) {
      res.status(400).json({ message: 'Nothing to change' }); return
    }
    if ((mute !== undefined && typeof mute !== 'boolean')
      || (deafen !== undefined && typeof deafen !== 'boolean')) {
      res.status(400).json({ message: 'mute and deafen must be true or false' }); return
    }

    if (!Types.ObjectId.isValid(target)) { res.status(404).json({ message: 'That person is not a member' }); return }
    if (!server.members.some((m: any) => m.toString() === target)) {
      res.status(404).json({ message: 'That person is not a member' }); return
    }
    // Muting yourself is what the microphone button is for. Allowing it here
    // would let someone hold a server mute over their own head that they then
    // need a moderator to lift.
    if (target === me) {
      res.status(400).json({ message: 'Use the microphone button to mute yourself' }); return
    }

    const actor = await loadAccess(server, me)
    const victim = await loadAccess(server, target)
    const actorCtx = { isOwner: actor.isOwner, highestPosition: actor.highestPosition, bits: actor.base }
    const victimCtx = { isOwner: victim.isOwner, highestPosition: victim.highestPosition }

    const before = restrictionOf(server, target)
    // Only a flag that is actually CHANGING needs its permission. Re-sending
    // the value something already has is a no-op, not an exercise of power.
    if (mute !== undefined && mute !== before.mute
      && !canActOnMember(actorCtx, victimCtx, 'MuteMembers')) {
      res.status(403).json({ message: 'You cannot mute that member' }); return
    }
    if (deafen !== undefined && deafen !== before.deafen
      && !canActOnMember(actorCtx, victimCtx, 'DeafenMembers')) {
      res.status(403).json({ message: 'You cannot deafen that member' }); return
    }

    const after: VoiceRestriction = {
      mute:   mute   === undefined ? before.mute   : mute,
      deafen: deafen === undefined ? before.deafen : deafen,
    }

    /*
     * Written as a pull-then-maybe-push rather than a positional update.
     *
     * A row exists only while something is imposed, so lifting the last flag
     * removes it entirely and the array stays the size of the moderation in
     * force rather than of the membership. Two writes are used because there is
     * no single atomic upsert-or-remove for an array element; the pull is
     * idempotent, so a retry cannot produce two rows for one member — and the
     * unique-by-user invariant is what restrictionOf's `find` depends on.
     */
    await Server.updateOne({ _id: server._id }, { $pull: { memberVoice: { user: target } } })
    if (after.mute || after.deafen) {
      await Server.updateOne(
        { _id: server._id },
        { $push: { memberVoice: { user: target, mute: after.mute, deafen: after.deafen } } },
      )
    }

    const live = await enforceLive(server._id, target, after)

    emitToServer(server, 'server:voiceModeration', {
      serverId: server._id.toString(), userId: target, ...after,
    })

    res.json({ userId: target, ...after, live })
  } catch (err) { next(err) }
}

/**
 * POST /servers/:sid/members/:uid/voice/disconnect — remove somebody from voice.
 *
 * Not a mute and not a kick: they stay a member and may walk straight back in.
 * That is the point of it — it ends a situation without ending a membership,
 * and MoveMembers is the bit that says who can.
 */
export const disconnectMember = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await loadServer(req, res); if (!server) return
    const me = req.user!.sub
    const target = req.params.uid

    if (!Types.ObjectId.isValid(target)) { res.status(404).json({ message: 'That person is not a member' }); return }
    if (!server.members.some((m: any) => m.toString() === target)) {
      res.status(404).json({ message: 'That person is not a member' }); return
    }
    if (target === me) {
      res.status(400).json({ message: 'Leave the channel to disconnect yourself' }); return
    }

    const actor = await loadAccess(server, me)
    const victim = await loadAccess(server, target)
    if (!canActOnMember(
      { isOwner: actor.isOwner, highestPosition: actor.highestPosition, bits: actor.base },
      { isOwner: victim.isOwner, highestPosition: victim.highestPosition },
      'MoveMembers',
    )) {
      res.status(403).json({ message: 'You cannot disconnect that member' }); return
    }

    const room = voiceRoomOfUser(target)
    // Already out. Answered as success rather than 404 so the button is
    // idempotent — two moderators clicking at once should not produce an error
    // for the slower one.
    if (!room) { res.json({ userId: target, live: 'absent' as LiveOutcome }); return }

    const channelId = room.slice(6)
    const channel = await Channel.findById(channelId).select('server voiceServer').lean()
    if (!channel || channel.server.toString() !== server._id.toString()) {
      res.json({ userId: target, live: 'absent' as LiveOutcome }); return
    }

    const voice = await resolveForChannel(channel.server, channel.voiceServer ?? null)
    const live = voice ? await evictFromVoice(voice, room, target) : 'absent'

    // Dropped locally whatever the media server said. If LiveKit refused, the
    // occupancy here would otherwise keep showing somebody the moderator has
    // been told is gone, and a stale sidebar is the more visible wrong.
    dropFromCall(room, target)
    // Their own client is told directly so it can tear the call down; the
    // occupancy broadcast that dropFromCall sends is about everyone ELSE's view.
    emitToServer(server, 'voice:disconnected', {
      serverId: server._id.toString(), userId: target, channelId,
    })

    res.json({ userId: target, live })
  } catch (err) { next(err) }
}
