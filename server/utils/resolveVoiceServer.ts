/**
 * Which LiveKit server should this call use?
 *
 * There are three places an answer can come from, and they are deliberately
 * ordered by how many people it has to be right for:
 *
 *   1. The CHANNEL's own setting. Everyone in a voice channel has to be on the
 *      same media server to hear each other, so this overrides every personal
 *      preference. It is not stubbornness — a per-member choice here would
 *      split the room in half.
 *   2. The SERVER's default, for its channels that name none.
 *   3. The INSTANCE's own LiveKit from `.env`, which is the only answer for
 *      DMs and group calls — they belong to no server, so there is no owner to
 *      have registered anything.
 *
 * Every step degrades rather than fails. A channel pointing at a deleted
 * server, a server whose only entry was removed, a secret that will not
 * decrypt after a JWT rotation: each falls through to the next source, and the
 * call connects. Voice going silently to the wrong-but-working server is a far
 * better outcome than voice not working, and the UI names the server it landed
 * on so the difference is visible.
 */
import { Types } from 'mongoose'
import { config } from '../config/env'
import { VoiceServer } from '../models/VoiceServer'
import { findInstanceVoiceServer, instanceVoiceServers, isInstanceVoiceId } from '../config/instanceVoice'
import { open } from './secretBox'

export interface ResolvedVoice {
  /** Null for the instance's own server, which has no database row. */
  id:     string | null
  name:   string
  url:    string
  apiKey: string
  apiSecret: string
}

/**
 * The instance's own default, or null when voice is not configured at all.
 *
 * Two sources, in order: the voice-servers.json list (whichever entry is marked
 * default), then the single LIVEKIT_URL trio. The second is what every
 * deployment predating the file has, so it must keep working untouched.
 */
export const instanceVoice = (): ResolvedVoice | null => {
  const listed = instanceVoiceServers().find(s => s.isDefault)
  if (listed) {
    return { id: listed.id, name: listed.name, url: listed.url, apiKey: listed.apiKey, apiSecret: listed.apiSecret }
  }
  const { url, apiKey, apiSecret } = config.livekit
  if (!url || !apiKey || !apiSecret) return null
  return { id: null, name: 'Default', url, apiKey, apiSecret }
}

/** A named instance server, or null. No decryption: these come from a file the
 *  operator wrote, not from the database. */
const namedInstance = (id: string): ResolvedVoice | null => {
  const s = findInstanceVoiceServer(id)
  return s ? { id: s.id, name: s.name, url: s.url, apiKey: s.apiKey, apiSecret: s.apiSecret } : null
}

/** Unseal a stored row, or null if its secret cannot be read. */
const usable = (row: any): ResolvedVoice | null => {
  const secret = open(row.apiSecret)
  // After a JWT_ACCESS_SECRET rotation without ENCRYPTION_KEY set, this is the
  // expected result for every stored row rather than a corruption — see
  // secretBox. Logged, because the owner has to be told to re-enter them and
  // nothing else in the system will notice.
  if (!secret) {
    console.warn(`[voice] cannot decrypt secret for voice server ${row._id} — re-enter it in server settings`)
    return null
  }
  return { id: row._id.toString(), name: row.name, url: row.url, apiKey: row.apiKey, apiSecret: secret }
}

/**
 * For a voice channel: its own server, else the guild default, else the
 * instance. `preferredId` is ignored here on purpose — see the ordering note
 * above.
 */
export const resolveForChannel = async (
  guildId: Types.ObjectId,
  channelVoiceServerId: string | null,
): Promise<ResolvedVoice | null> => {
  // An instance server is offered to every guild by the operator, so there is
  // no ownership to check — the cross-guild guard below exists only because a
  // GUILD's server belongs to one guild.
  if (isInstanceVoiceId(channelVoiceServerId)) {
    const hit = namedInstance(channelVoiceServerId)
    if (hit) return hit
    // The operator removed it from the file. Fall through rather than fail: the
    // channel keeps working on the guild or instance default.
  } else if (channelVoiceServerId && Types.ObjectId.isValid(channelVoiceServerId)) {
    const row = await VoiceServer.findOne({ _id: channelVoiceServerId, server: guildId })
      .select('+apiSecret').lean()
    // Scoped to the guild, not looked up by id alone: without `server` in the
    // filter, a channel carrying another guild's id would mint tokens against
    // a media server its owner never offered it.
    const hit = row && usable(row)
    if (hit) return hit
  }

  const fallback = await VoiceServer.findOne({ server: guildId, isDefault: true })
    .select('+apiSecret').lean()
  const hit = fallback && usable(fallback)
  if (hit) return hit

  return instanceVoice()
}

/**
 * For a DM or group call: the caller's preference if it still resolves, else
 * the instance.
 *
 * A preference here can be honoured per-person in a way a channel's cannot,
 * because both sides negotiate one room — the caller's choice decides it, and
 * the UI lets anyone in the call move it.
 *
 * Scoped to servers the user is actually a member of, so a preference cannot
 * be pointed at a stranger's media server by editing a stored id.
 */
export const resolveForConversation = async (
  preferredId: string | null | undefined,
  memberOfServerIds: Types.ObjectId[],
): Promise<ResolvedVoice | null> => {
  // An instance server needs no membership check — the operator offers it to
  // everyone on the build, which is the whole point of it being in the file
  // rather than in one guild's rows.
  if (isInstanceVoiceId(preferredId)) {
    const hit = namedInstance(preferredId)
    if (hit) return hit
  } else if (preferredId && Types.ObjectId.isValid(preferredId) && memberOfServerIds.length) {
    const row = await VoiceServer.findOne({ _id: preferredId, server: { $in: memberOfServerIds } })
      .select('+apiSecret').lean()
    const hit = row && usable(row)
    if (hit) return hit
  }
  return instanceVoice()
}
