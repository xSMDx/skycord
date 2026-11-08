/**
 * How big a chat attachment may be, and how many one message may carry.
 *
 * 25 MB is the music upload's limit (MUSIC_MAX_BYTES) — the same server,
 * reverse proxy and disk, so the same ceiling. Ten files is what the composer
 * shows comfortably in one row and what one message can lay out.
 *
 * Read from the environment in one place because two things report it: the
 * upload route enforces it, and /instance tells the client so the composer
 * can refuse a file before spending the bandwidth.
 */
export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024
export const MAX_FILES = 10

export const maxBytesFromEnv = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env.ATTACH_MAX_BYTES
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_BYTES
  const n = Number(raw)
  // A typo must not become a limit of NaN, which compares false against
  // everything and so lets anything through.
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_BYTES
}
