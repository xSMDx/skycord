/**
 * What music is playing in each voice room, and who is listening to what.
 *
 * Kept out of chatSocket.ts and free of any socket, so it can be tested as
 * what it is: a small state machine with awkward edges. The handlers in
 * chatSocket own authorisation and broadcasting; this owns the facts.
 *
 * Shape of the feature it serves: one voice channel holds several music
 * channels at once, and each member tunes into at most one while everyone
 * keeps talking. So "who is listening" is per music channel, not per room,
 * and a member moving between them is the common operation rather than a
 * rare one.
 */
import { randomUUID } from 'crypto'
import type { MusicCaps, Check } from '../utils/musicLimits'
import { canOpenChannel, canQueue } from '../utils/musicLimits'

/**
 * One thing to play.
 *
 * Two sources, and the difference is who chose the address. A pasted link
 * is text a member typed, and every control in music/src/urlGuard.ts exists
 * for it. A library track is an id the API resolves against a collection it
 * owns, and the address is composed by the service from its own
 * configuration — so no member-supplied text reaches the fetcher at all.
 *
 * Exactly one of these is set.
 */
export interface Track {
  /** A link a member pasted. Untrusted; guarded in the service. */
  url?: string
  /** A track in the member's library, already checked to be theirs. */
  trackId?: string
  /** What to show while it plays. Absent for a bare link. */
  title?: string
  addedBy: string
  addedAt: number
}

export interface MusicChannel {
  id: string
  name: string
  createdBy: string
  now: Track | null
  queue: Track[]
  listeners: Set<string>
}

/** What a client is told. Sets become counts and arrays; nothing else leaks. */
export interface MusicChannelView {
  id: string
  name: string
  /** `url` is null for a library track; `title` is null for a bare link. */
  now: { url: string | null; title: string | null; addedBy: string } | null
  queued: number
  listeners: string[]
}

const no = (reason: string): Check => ({ ok: false, reason })

/**
 * How long a music channel survives with nobody listening.
 *
 * The same reasoning as the call-end grace period: somebody closing a laptop
 * lid, switching channels, or riding out a two-second network blip has not
 * decided the music should stop. Shorter than the call one, because a music
 * channel costs a decode the whole time it exists and a call costs nothing.
 */
export const EMPTY_GRACE_MS = 30_000

export class MusicRooms {
  /** room -> channelId -> channel */
  private readonly rooms = new Map<string, Map<string, MusicChannel>>()
  private readonly pendingClose = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly caps: MusicCaps,
    /** Called when a channel is actually torn down, so the service can stop decoding. */
    private readonly onClosed: (room: string, channelId: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  // ── reading ────────────────────────────────────────────────────────────

  channelsHere(room: string): number { return this.rooms.get(room)?.size ?? 0 }

  channelsEverywhere(): number {
    let n = 0
    for (const m of this.rooms.values()) n += m.size
    return n
  }

  get(room: string, channelId: string): MusicChannel | undefined {
    return this.rooms.get(room)?.get(channelId)
  }

  /** The payload broadcast as `music:state`. Always the FULL list. */
  view(room: string): { channels: MusicChannelView[] } {
    const here = this.rooms.get(room)
    if (!here) return { channels: [] }
    return {
      channels: [...here.values()].map(c => ({
        id: c.id,
        name: c.name,
        now: c.now
          ? { url: c.now.url ?? null, title: c.now.title ?? null, addedBy: c.now.addedBy }
          : null,
        queued: c.queue.length,
        listeners: [...c.listeners],
      })),
    }
  }

  // ── writing ────────────────────────────────────────────────────────────

  create(room: string, name: string, source: Omit<Track, 'addedBy' | 'addedAt'>, by: string): Check & { id?: string } {
    const room_ok = canOpenChannel(
      { channelsHere: this.channelsHere(room), channelsEverywhere: this.channelsEverywhere() },
      this.caps,
    )
    if (!room_ok.ok) return room_ok

    let here = this.rooms.get(room)
    if (!here) { here = new Map(); this.rooms.set(room, here) }

    const id = randomUUID()
    const track: Track = { ...source, addedBy: by, addedAt: this.now() }
    here.set(id, { id, name, createdBy: by, now: track, queue: [], listeners: new Set() })

    /*
     * The creator is NOT made a listener.
     *
     * Tempting, and wrong: starting a channel and tuning into it are two
     * decisions, and someone queueing something for the room may not want it
     * in their own ears. Auto-subscribing them would also mean the grace
     * period below never fires for a channel nobody actually chose.
     */
    this.armIfEmpty(room, id)
    return { ok: true, id }
  }

  queue(room: string, channelId: string, source: Omit<Track, 'addedBy' | 'addedAt'>, by: string): Check {
    const channel = this.get(room, channelId)
    if (!channel) return no('That music channel is gone.')
    const room_ok = canQueue(channel.queue.length, this.caps)
    if (!room_ok.ok) return room_ok
    channel.queue.push({ ...source, addedBy: by, addedAt: this.now() })
    return { ok: true }
  }

  /** Advance to the next track. Returns what is playing now, if anything. */
  skip(room: string, channelId: string): Check & { now?: Track | null } {
    const channel = this.get(room, channelId)
    if (!channel) return no('That music channel is gone.')
    channel.now = channel.queue.shift() ?? null
    /*
     * An empty channel is not closed here.
     *
     * Skipping the last track leaves a channel playing nothing, and that is a
     * state a listener can see and act on — queue something else. Closing it
     * under them because the queue ran dry would take the channel away mid
     * conversation about what to play next.
     */
    return { ok: true, now: channel.now }
  }

  close(room: string, channelId: string): Check {
    const here = this.rooms.get(room)
    if (!here?.has(channelId)) return no('That music channel is gone.')
    this.tearDown(room, channelId)
    return { ok: true }
  }

  /** Tune a member into one channel, or out of all of them with null. */
  listen(room: string, userId: string, channelId: string | null): Check {
    const here = this.rooms.get(room)
    if (channelId !== null && !here?.has(channelId)) return no('That music channel is gone.')

    // At most one at a time: leaving the old one is part of joining a new one.
    if (here) for (const c of here.values()) {
      if (c.id === channelId) continue
      if (c.listeners.delete(userId)) this.armIfEmpty(room, c.id)
    }
    if (channelId !== null) {
      const channel = here!.get(channelId)!
      channel.listeners.add(userId)
      this.cancelClose(room, channelId)
    }
    return { ok: true }
  }

  /**
   * A member has gone — a disconnect, or leaving the call.
   *
   * Returns the rooms whose state changed, so the caller knows what to
   * re-broadcast without walking everything itself.
   */
  forget(userId: string): string[] {
    const touched: string[] = []
    for (const [room, here] of this.rooms) {
      let changed = false
      for (const c of here.values()) {
        if (c.listeners.delete(userId)) { changed = true; this.armIfEmpty(room, c.id) }
      }
      if (changed) touched.push(room)
    }
    return touched
  }

  /** Everything in a room is over — the call ended. */
  closeRoom(room: string): void {
    const here = this.rooms.get(room)
    if (!here) return
    for (const id of [...here.keys()]) this.tearDown(room, id)
  }

  // ── teardown ───────────────────────────────────────────────────────────

  private key(room: string, channelId: string): string { return `${room}\u0000${channelId}` }

  /**
   * Nobody is listening: start the clock, do not stop the music yet.
   *
   * Switching between two channels momentarily leaves the first with no
   * listeners, and so does a reconnect. Tearing down on the instant would
   * make both of those destroy a channel somebody is about to come back to —
   * which is the bug the call-end grace period was added for, one layer up.
   */
  private armIfEmpty(room: string, channelId: string): void {
    const channel = this.get(room, channelId)
    if (!channel || channel.listeners.size > 0) return
    if (this.pendingClose.has(this.key(room, channelId))) return
    const timer = setTimeout(() => {
      this.pendingClose.delete(this.key(room, channelId))
      const still = this.get(room, channelId)
      if (still && still.listeners.size === 0) this.tearDown(room, channelId)
    }, EMPTY_GRACE_MS)
    // Never hold the process open for a decision about music.
    timer.unref?.()
    this.pendingClose.set(this.key(room, channelId), timer)
  }

  private cancelClose(room: string, channelId: string): void {
    const k = this.key(room, channelId)
    const timer = this.pendingClose.get(k)
    if (!timer) return
    clearTimeout(timer)
    this.pendingClose.delete(k)
  }

  private tearDown(room: string, channelId: string): void {
    this.cancelClose(room, channelId)
    const here = this.rooms.get(room)
    if (!here?.delete(channelId)) return
    if (here.size === 0) this.rooms.delete(room)
    this.onClosed(room, channelId)
  }

  /** For the shutdown path: drop every timer without concluding anything. */
  cancelAllCloses(): void {
    for (const t of this.pendingClose.values()) clearTimeout(t)
    this.pendingClose.clear()
  }

  /** Test seam: is a channel waiting to be torn down? */
  closePending(room: string, channelId: string): boolean {
    return this.pendingClose.has(this.key(room, channelId))
  }
}
