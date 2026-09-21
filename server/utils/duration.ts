/**
 * A duration from a .env value: "90d", "12h", "30m", "45s", "2w", or a bare
 * number of milliseconds (what jsonwebtoken made of the same string).
 *
 * Anything else falls back rather than throwing: a typo in a lifetime should
 * not stop the server, and should not sign everyone out either.
 */
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
}

export const durationMs = (spec: string, fallback: number): number => {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)?$/.exec(spec.trim().toLowerCase())
  if (!m) return fallback
  const value = Number(m[1]) * UNIT_MS[m[2] ?? 'ms']
  return value > 0 ? value : fallback
}
