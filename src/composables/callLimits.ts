/**
 * Who gets a video tile when there is a cap, and how good the incoming video
 * should be. Pure, so the rule can be tested without a call.
 *
 * Order: whoever is speaking, then whoever spoke most recently, and a camera
 * before an avatar when those are equal. You are always kept — a call where
 * your own camera disappears reads as broken, not as thrifty.
 */
export interface TileCandidate {
  id: string
  isSelf: boolean
  speaking: boolean
  hasVideo: boolean
  lastSpokeAt: number
}

export const visibleTiles = (all: TileCandidate[], max: number): string[] => {
  if (!Number.isFinite(max) || all.length <= max) return all.map(t => t.id)
  const self = all.filter(t => t.isSelf)
  const rest = all.filter(t => !t.isSelf).sort((a, b) =>
    Number(b.speaking) - Number(a.speaking) ||
    b.lastSpokeAt - a.lastSpokeAt ||
    Number(b.hasVideo) - Number(a.hasVideo))
  return [...self, ...rest].slice(0, max).map(t => t.id)
}

/** null = leave it to LiveKit's own adaptive streaming, which is the default. */
export const qualityFor = (cap: 'auto' | '720p' | '360p'): 'high' | 'medium' | 'low' | null =>
  cap === 'auto' ? null : cap === '720p' ? 'high' : 'low'
