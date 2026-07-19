/**
 * Per-conversation pin/mute, mirrored from the server.
 *
 * One source of truth for the three things that read it: sidebar ordering,
 * unread-badge dimming, and the menu items' own checked state.
 *
 * Mute expiry is evaluated on READ here as well as on the server. The server
 * can only apply expiry when something asks it; a client left open past the end
 * of a mute would otherwise keep silencing a conversation until the next fetch.
 */
import { reactive, computed } from 'vue'

export interface ConvPref {
  pinned:     boolean
  muted:      boolean
  mutedUntil: string | null   // ISO; null while muted = indefinitely
}

const prefs = reactive<Record<string, ConvPref>>({})

/** Mute that has run out reads as unmuted, without waiting for a round-trip. */
const live = (p: ConvPref | undefined): ConvPref => {
  if (!p) return { pinned: false, muted: false, mutedUntil: null }
  const expired = p.muted && p.mutedUntil !== null && new Date(p.mutedUntil).getTime() <= Date.now()
  return expired ? { ...p, muted: false, mutedUntil: null } : p
}

export const convPref  = (convId: string): ConvPref => live(prefs[convId])
export const isPinned  = (convId: string) => convPref(convId).pinned
export const isMuted   = (convId: string) => convPref(convId).muted

export const setAllConvPrefs = (next: Record<string, ConvPref>) => {
  for (const k of Object.keys(prefs)) delete prefs[k]
  Object.assign(prefs, next)
}

export const setConvPrefLocal = (convId: string, pref: ConvPref | null) => {
  if (!pref || (!pref.pinned && !pref.muted)) delete prefs[convId]
  else prefs[convId] = pref
}

/** Mute durations offered in the menu. `null` = unmute, 'forever' = indefinite. */
export const MUTE_OPTIONS: { label: string; value: () => string | 'forever' }[] = [
  { label: 'For 15 Minutes',          value: () => new Date(Date.now() + 15 * 60_000).toISOString() },
  { label: 'For 1 Hour',              value: () => new Date(Date.now() + 60 * 60_000).toISOString() },
  { label: 'For 8 Hours',             value: () => new Date(Date.now() + 8 * 3600_000).toISOString() },
  { label: 'For 24 Hours',            value: () => new Date(Date.now() + 24 * 3600_000).toISOString() },
  { label: 'Until I turn it back on', value: () => 'forever' },
]

export const pinnedCount = computed(() => Object.values(prefs).filter(p => live(p).pinned).length)

export const useConvPrefs = () => ({
  prefs, convPref, isPinned, isMuted,
  setAllConvPrefs, setConvPrefLocal, MUTE_OPTIONS, pinnedCount,
})
