/**
 * What a member is allowed to ask the music service to do.
 *
 * Everything here runs in the API, before anything reaches the service that
 * fetches URLs. Two different jobs, and they fail for different reasons:
 *
 *  - **Shape.** Is this a URL at all, does it name an audio file, is the
 *    channel name a name. Cheap, and it keeps obvious rubbish away from the
 *    thing with network access.
 *  - **Caps.** Is there room for another channel, another queue entry,
 *    another request from this member this minute.
 *
 * The caps are not a permission system. PRODUCT.md says roles do not exist,
 * and v1 lets anyone in a voice channel create and control music channels.
 * What stops the damage is these numbers, not who you are — a crew of thirty
 * who know each other can police the social side themselves, but none of
 * them can police a ten-hour livestream decoding on a 2010 laptop.
 *
 * The real SSRF check is not here. It is in the music service, on the
 * resolved address, behind a firewall that blocks private egress — see
 * `music/src/urlGuard.ts`. This is the cheap first pass.
 */

export interface MusicCaps {
  /** Music channels in one voice channel. */
  channelsPerCall: number
  /** Music channels across the whole instance — the real ceiling, since each is a decode. */
  channelsPerInstance: number
  /** Queue entries in one music channel. */
  queuePerChannel: number
  /** Creates plus queues, per member, per minute. */
  actionsPerMinute: number
  /** Longest track the service will play, in seconds. */
  maxDurationSec: number
  /** Largest download, in bytes. Enforced while streaming, never from a header. */
  maxBytes: number
}

/**
 * Defaults sized for the product, not for a datacentre: PRODUCT.md caps a
 * server at 100 members and pins MongoDB to 4.4 so pre-2011 CPUs can run
 * this. Four channels is plenty for a crew; eight across the instance is
 * eight simultaneous decodes, which is already generous for that hardware.
 */
export const DEFAULT_CAPS: MusicCaps = {
  channelsPerCall: 4,
  channelsPerInstance: 8,
  queuePerChannel: 50,
  actionsPerMinute: 10,
  maxDurationSec: 30 * 60,
  maxBytes: 100 * 1024 * 1024,
}

export const capsFromEnv = (env: NodeJS.ProcessEnv = process.env): MusicCaps => {
  const n = (key: string, fallback: number): number => {
    const raw = env[key]
    if (raw === undefined || raw === '') return fallback
    const v = Number(raw)
    // A typo must not silently become a cap of NaN, which compares false
    // against everything and therefore permits everything.
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
  }
  return {
    channelsPerCall:     n('MUSIC_CHANNELS_PER_CALL', DEFAULT_CAPS.channelsPerCall),
    channelsPerInstance: n('MUSIC_CHANNELS_PER_INSTANCE', DEFAULT_CAPS.channelsPerInstance),
    queuePerChannel:     n('MUSIC_QUEUE_PER_CHANNEL', DEFAULT_CAPS.queuePerChannel),
    actionsPerMinute:    n('MUSIC_ACTIONS_PER_MINUTE', DEFAULT_CAPS.actionsPerMinute),
    maxDurationSec:      n('MUSIC_MAX_DURATION_SEC', DEFAULT_CAPS.maxDurationSec),
    maxBytes:            n('MUSIC_MAX_BYTES', DEFAULT_CAPS.maxBytes),
  }
}

export type Check = { ok: true } | { ok: false; reason: string }
const no = (reason: string): Check => ({ ok: false, reason })
const YES: Check = { ok: true }

/** Extensions the service will play. Kept in step with music/src/urlGuard.ts. */
const AUDIO = /\.(mp3|ogg|oga|opus|flac|wav|m4a|aac)$/i

/**
 * The cheap pass over a URL a member typed.
 *
 * Deliberately NOT a security boundary — it cannot be, because it judges
 * text and the attacks are all about what text resolves to. It exists to
 * turn "that is not even a link" into an error the member can read, without
 * a round trip to the service.
 */
export const checkUrlShape = (raw: unknown): Check => {
  if (typeof raw !== 'string' || !raw.trim()) return no('Paste a link to an audio file.')
  if (raw.length > 2048) return no('That link is too long.')
  let u: URL
  try { u = new URL(raw.trim()) } catch { return no('That is not a link.') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return no('Only http and https links work here.')
  if (u.username || u.password) return no('That link has a username and password in it.')
  if (!AUDIO.test(u.pathname)) return no('That link does not point at an audio file.')
  return YES
}

/** 1–32 visible characters, no control characters, no newlines. */
export const checkChannelName = (raw: unknown): Check => {
  if (typeof raw !== 'string') return no('Give the channel a name.')
  const name = raw.trim()
  if (!name) return no('Give the channel a name.')
  if ([...name].length > 32) return no('That name is too long — 32 characters at most.')
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return no('That name has characters that are not allowed.')
  return YES
}

export interface CallMusicState {
  /** Music channels already open in THIS voice channel. */
  channelsHere: number
  /** Music channels open across the whole instance. */
  channelsEverywhere: number
}

export const canOpenChannel = (state: CallMusicState, caps: MusicCaps): Check => {
  if (state.channelsHere >= caps.channelsPerCall) {
    return no(`This call already has ${caps.channelsPerCall} music channels.`)
  }
  if (state.channelsEverywhere >= caps.channelsPerInstance) {
    // Named honestly: it is the server that is full, not this call, and a
    // member who cannot tell those apart will keep trying.
    return no('This server is already playing as much music as it can handle.')
  }
  return YES
}

export const canQueue = (queueLength: number, caps: MusicCaps): Check =>
  queueLength >= caps.queuePerChannel
    ? no(`That queue is full — ${caps.queuePerChannel} tracks at most.`)
    : YES

/**
 * A fixed window per member, deliberately.
 *
 * A sliding window is more correct and needs a timestamp list per member; a
 * fixed window needs a counter and a minute. The failure mode of the fixed
 * window is that someone can spend two windows' worth across a boundary,
 * which for "ten queue actions a minute" is not worth the memory on a server
 * sized for a 2010 laptop.
 */
export class ActionRate {
  private readonly hits = new Map<string, { n: number; window: number }>()
  constructor(private readonly caps: MusicCaps, private readonly now: () => number = Date.now) {}

  take(memberId: string): Check {
    const window = Math.floor(this.now() / 60_000)
    const seen = this.hits.get(memberId)
    if (!seen || seen.window !== window) {
      this.hits.set(memberId, { n: 1, window })
      return YES
    }
    if (seen.n >= this.caps.actionsPerMinute) return no('You are doing that too fast. Give it a moment.')
    seen.n++
    return YES
  }

  /** Drop members whose window has passed, so the map cannot grow forever. */
  sweep(): void {
    const window = Math.floor(this.now() / 60_000)
    for (const [id, seen] of this.hits) if (seen.window !== window) this.hits.delete(id)
  }

  get size(): number { return this.hits.size }
}
