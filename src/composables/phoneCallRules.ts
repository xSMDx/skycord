/**
 * The rules the phone call screen draws from: who fills the screen, what the
 * Music card says, and how the call's timer and subtitle read. Pure and free of
 * Vue, so each rule can be tested without mounting a call.
 */
import { bySpeechRecency, type TileCandidate } from './callLimits'
import type { MusicChannelView } from './useMusic'

// ── Who fills the screen ────────────────────────────────────────────────────
export interface FocusInput {
  tiles: { id: string; speaking: boolean }[]
  videos: { participantId: string; source: 'camera' | 'screen'; local: boolean }[]
  selfId: string
  /** When each person last spoke, by the caller's clock. Missing = never. */
  lastSpokeAt: Record<string, number>
}

/** What is big on the screen. `id` is a participant; `since` is when they took the slot. */
export interface FocusState {
  kind: 'screen' | 'camera' | 'avatar'
  id: string
  since: number
}

/** How long someone keeps the big slot before another may take it from them. */
export const FOCUS_HOLD_MS = 1500

// People ranked by the same rule a capped call grid uses, best first. Whether
// they have video is the same for everyone passed in, so it never decides.
const ranked = (ids: string[], input: FocusInput, hasVideo: boolean): string[] => {
  const speaking = new Set(input.tiles.filter(t => t.speaking).map(t => t.id))
  return [...new Set(ids)]
    .map((id): TileCandidate => ({
      id, isSelf: false, hasVideo,
      speaking: speaking.has(id),
      lastSpokeAt: input.lastSpokeAt[id] ?? 0,
    }))
    .sort(bySpeechRecency)
    .map(c => c.id)
}

// Who should be big right now, ignoring what was big a moment ago.
const wanted = (input: FocusInput): Pick<FocusState, 'kind' | 'id'> => {
  // A screen is text that cannot be cropped: it beats every camera. Only one
  // somebody else is sharing counts — a phone cannot share, and a screen shared
  // from this device is not something to look at on it.
  const screens = input.videos.filter(v => v.source === 'screen' && !v.local).map(v => v.participantId)
  if (screens.length) return { kind: 'screen', id: ranked(screens, input, true)[0] }

  const cameras = input.videos.filter(v => v.source === 'camera' && !v.local).map(v => v.participantId)
  if (cameras.length) return { kind: 'camera', id: ranked(cameras, input, true)[0] }

  // Your own camera is the fallback, not a contender: it fills the screen only
  // when nobody else has anything to show.
  const own = input.videos.find(v => v.source === 'camera' && v.local)
  if (own) return { kind: 'camera', id: own.participantId }

  // No video at all. You never take the big slot, however loud, unless nobody
  // else is here.
  const others = input.tiles.map(t => t.id).filter(id => id !== input.selfId)
  return { kind: 'avatar', id: others.length ? ranked(others, input, false)[0] : input.selfId }
}

const present = (input: FocusInput, id: string): boolean =>
  id === input.selfId ||
  input.tiles.some(t => t.id === id) ||
  input.videos.some(v => v.participantId === id)

/**
 * Who fills the screen, given who did a moment ago.
 *
 * The slot changes hands only after its holder has had it for FOCUS_HOLD_MS, so
 * two people talking over each other, or a camera switched on and straight off,
 * do not make the picture jump. Two things are not made to wait: a screen share
 * arriving over anything but another screen, which is what the viewer opened
 * the call to see; and a holder who has left the call, because there is nobody
 * left to keep the slot for.
 *
 * Staying is not a decision to stay. A caller whose input has stopped changing
 * must call this again once the hold is up (at `since + FOCUS_HOLD_MS`), or the
 * slot never moves. Nor does the holder's video have to still be there: someone
 * kept for a moment after their camera or share stopped is drawn as the person,
 * by whoever draws it.
 */
export const pickFocus = (input: FocusInput, prev: FocusState | null, now: number): FocusState => {
  const next = wanted(input)
  if (!prev) return { ...next, since: now }
  if (prev.kind === next.kind && prev.id === next.id) return prev

  const screenArrived = next.kind === 'screen' && prev.kind !== 'screen'
  const holding = now - prev.since < FOCUS_HOLD_MS
  if (holding && !screenArrived && present(input, prev.id)) return prev
  return { ...next, since: now }
}

// ── The Music card ──────────────────────────────────────────────────────────
export type MusicCardLabel =
  | null
  | { kind: 'not-playing' }
  | { kind: 'song'; title: string; artist: string | null; cover: string | null }
  | { kind: 'count'; n: number }

// A bare link has no title, only where it points. The desktop rail says
// 'A linked track' when it has not even that.
const hostOf = (url: string | null): string | null => {
  if (!url) return null
  try { return new URL(url).hostname || null } catch { return null }
}

/**
 * What the Music card reads, or null when the card is not shown at all (the
 * server runs no music). The song is that of the channel you are tuned into; if
 * you are not tuned into one, it can only say how many are playing, since there
 * is no single song to name.
 */
export const musicCardLabel = (
  m: { available: boolean; listeningTo: string | null; channels: MusicChannelView[] },
): MusicCardLabel => {
  if (!m.available) return null

  // An id with no channel behind it (it closed) is not tuned in to anything.
  const tuned = m.listeningTo === null ? undefined : m.channels.find(c => c.id === m.listeningTo)
  if (tuned) {
    const now = tuned.now
    if (!now) return { kind: 'not-playing' }
    return {
      kind: 'song',
      title: now.title || hostOf(now.url) || 'A linked track',
      artist: now.artist,
      cover: now.cover,
    }
  }

  const n = m.channels.filter(c => c.now).length
  return n > 0 ? { kind: 'count', n } : { kind: 'not-playing' }
}

// ── The call timer and subtitle ─────────────────────────────────────────────
/**
 * `m:ss` below an hour, `h:mm:ss` from one. Whole seconds, rounded down, so it
 * never runs ahead of the clock; a start time that is in the future reads 0:00
 * rather than a negative. The one formatter for the call timer and the return
 * bar, so they cannot disagree.
 */
export const formatElapsed = (ms: number): string => {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const ss = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/**
 * The line under the call's name. A DM is the timer alone: the other person is
 * the name already. Otherwise the head count, then the timer — or, while
 * someone else's camera fills the screen, who that is, which tells you more
 * than the timer does and fits where it was.
 */
export const callSubtitle = (
  s: { kind: 'dm' | 'group' | 'channel'; count: number; onCamera: string | null; elapsedMs: number | null },
): string => {
  const time = s.elapsedMs === null ? null : formatElapsed(s.elapsedMs)
  if (s.kind === 'dm') return time ?? ''
  const people = `${s.count} ${s.count === 1 ? 'person' : 'people'}`
  const tail = s.onCamera ? `${s.onCamera} on camera` : time
  return tail ? `${people} · ${tail}` : people
}
