/**
 * Who LiveKit has in a call room, asked of the media server the room lives on.
 *
 * The voice list is built from what pages tell the server over their sockets,
 * and a page that cannot talk to the server — its connection down for longer
 * than a blip while LiveKit carries on, frozen in a background tab, joined
 * with its socket already gone — cannot say it is in the call. LiveKit knows:
 * chatSocket's roster sweep asks here and seats whoever it lists.
 *
 * The answer is the participants' identities (user ids, plus `svc:music` when
 * music plays), [] for a room LiveKit does not know — nobody is in it — and
 * null whenever the question could not be answered: no media server, a
 * secret that will not decrypt, a server that is down, slow or refuses. Null
 * means "no information", and the caller changes nothing on it.
 */
import { RoomServiceClient } from 'livekit-server-sdk'
import { Channel } from '../models/Channel'
import { resolveForChannel, resolveVoiceById, type ResolvedVoice } from './resolveVoiceServer'
import { adminUrlFor } from './voiceModeration'

/** Seconds. The sweep asks room by room, and one slow server must not hold the rest up long. */
const ROSTER_TIMEOUT_S = 4

/**
 * The media server a call room lives on: a voice channel's own setting, else
 * its server's, else the instance's (the same answer the token endpoint gives
 * everyone in the channel); for a DM or group, the server its first token
 * fixed (`pinned`, from chatSocket's callVoiceServer), else the instance's.
 */
export const voiceForRoom = async (room: string, pinned: string | null | undefined): Promise<ResolvedVoice | null> => {
  if (room.startsWith('voice:')) {
    const channel = await Channel.findById(room.slice(6)).select('server voiceServer').lean()
    if (!channel) return null
    return resolveForChannel(channel.server, (channel as { voiceServer?: string | null }).voiceServer ?? null)
  }
  return resolveVoiceById(pinned)
}

/** When each media server last failed to answer, so a dead one is reported, not shouted about. */
const lastWarned = new Map<string, number>()
const WARN_EVERY_MS = 5 * 60_000

export const listRoomIdentities = async (room: string, pinned: string | null | undefined): Promise<string[] | null> => {
  let voice: ResolvedVoice | null
  try {
    voice = await voiceForRoom(room, pinned)
  } catch {
    return null
  }
  if (!voice) return null
  const url = adminUrlFor(voice)
  try {
    const svc = new RoomServiceClient(url, voice.apiKey, voice.apiSecret, { requestTimeout: ROSTER_TIMEOUT_S })
    return (await svc.listParticipants(room)).map(p => p.identity)
  } catch (err) {
    const e = err as { code?: string; status?: number } | null
    // A room LiveKit has never heard of, or has closed: nobody is in it.
    if (e?.code === 'not_found' || e?.status === 404) return []
    const now = Date.now()
    if ((lastWarned.get(url) ?? 0) + WARN_EVERY_MS < now) {
      lastWarned.set(url, now)
      console.warn(`[voice] could not ask the media server who is in a call (${voice.name}):`, (err as Error)?.message ?? err)
    }
    return null
  }
}
