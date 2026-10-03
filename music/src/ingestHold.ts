/**
 * Ingested files, waiting to be collected.
 *
 * ## Why the API collects rather than the service storing
 *
 * The service could write to GridFS itself and save a round trip. It must
 * not: this is the container that fetches URLs a member typed, and handing
 * it database credentials puts the whole database one SSRF bug away from an
 * attacker. The split is the point — the service has network reach and no
 * credentials, the API has credentials and no reach.
 *
 * So ingest answers with metadata and holds the audio here until the API
 * fetches it. Two requests instead of one, and a boundary worth the cost.
 *
 * ## Why there is a TTL
 *
 * The API can die between the two calls. Without an expiry every such death
 * leaves a file in the container's temp directory forever, and the disk
 * fills with nobody having done anything wrong.
 */
import type { IngestedTrack } from './ingest.js'
import { randomUUID } from 'crypto'

export interface HeldTrack {
  track: IngestedTrack
  cleanup: () => Promise<void>
  expiresAt: number
}

/** Long enough for a slow upload of the normalised file, short enough to matter. */
export const HOLD_MS = 5 * 60_000

export class IngestHold {
  private readonly held = new Map<string, HeldTrack>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly ttlMs: number = HOLD_MS,
    private readonly now: () => number = Date.now,
  ) {}

  put(track: IngestedTrack, cleanup: () => Promise<void>): string {
    const id = randomUUID()
    this.held.set(id, { track, cleanup, expiresAt: this.now() + this.ttlMs })
    return id
  }

  get(id: string): HeldTrack | null {
    const h = this.held.get(id)
    if (!h) return null
    if (h.expiresAt <= this.now()) { void this.drop(id); return null }
    return h
  }

  /** Forget and delete. Safe to call for an id that is already gone. */
  async drop(id: string): Promise<void> {
    const h = this.held.get(id)
    if (!h) return
    this.held.delete(id)
    await h.cleanup().catch(() => {})
  }

  async sweep(): Promise<void> {
    const t = this.now()
    for (const [id, h] of [...this.held]) if (h.expiresAt <= t) await this.drop(id)
  }

  /** Sweeping on a timer, because nothing else is guaranteed to come along. */
  start(everyMs = 60_000): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.sweep() }, everyMs)
    this.timer.unref?.()
  }

  async stop(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    for (const id of [...this.held.keys()]) await this.drop(id)
  }

  get size(): number { return this.held.size }
}
