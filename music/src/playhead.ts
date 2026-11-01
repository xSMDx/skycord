/**
 * Where a playing song is, and whether it is held.
 *
 * Pause belongs to the publisher, but nothing in here needs LiveKit: what
 * goes out next is decided against a plain sink, so every rule below is
 * tested frame by frame (music/__tests__/playhead.test.ts) without a media
 * server. publisher.ts gives it the real AudioSource.
 *
 * ## What a pause is
 *
 * The track stays published and listeners stay subscribed; frames simply
 * stop being sent, so they hear silence. The decoder is left where it is —
 * not reading its output is what holds it, through ordinary backpressure —
 * and resume carries on from the very next frame. No seek, no refetch, no
 * gap.
 *
 * Two things make that harder than it sounds, and both are handled here.
 *
 * 1. The AudioSource buffers up to a second ahead of what is heard. A pause
 *    that left that second playing would be a pause that does not stop, and
 *    resuming after it would skip a second nobody heard. So a pause clears
 *    the source and takes back the frames that were queued but unheard, to
 *    be sent again first on resume.
 *
 * 2. The fetch under a held song stalls while it is held, and the far end
 *    gives up on it — after ten seconds for a pasted link's socket, five
 *    minutes for the API's own. Playing on from what was buffered would end
 *    the song early and skip it. So a source that dies while held is fetched
 *    again on resume and decoded from the held point (playThrough).
 */
import type { Readable } from 'stream'
import { frames, type Decoder } from './decode.js'

/** One frame is 20 ms of audio; every position here is counted in frames. */
export const FRAME_MS = 20

/** Where frames go: the LiveKit AudioSource, or an array in a test. */
export interface Sink {
  capture(frame: Int16Array): Promise<void>
  /** Audio handed over but not yet heard, in milliseconds. */
  queuedMs(): number
  /** Throw away everything handed over and not yet heard. */
  clear(): void
}

/**
 * Recently sent frames kept for taking back. The AudioSource holds a second
 * (50 frames); the margin covers its estimate of that being a little high.
 */
const KEEP = 60

export class Playhead {
  /** Frames the listener has heard or will hear, net of any taken back. */
  private sent = 0
  private readonly recent: Int16Array[] = []
  /** Taken back at a pause, or not yet sent: these go out before anything new. */
  private readonly next: Int16Array[] = []
  /** Frames to drop from a fresh decode, to land exactly on the held point. */
  private discard = 0
  private gate: Promise<void> | null = null
  private open: () => void = () => {}
  private done = false

  constructor(private readonly startMs: number, private readonly sink: Sink) {}

  get paused(): boolean { return this.gate !== null }
  /** Over: replaced, closed, or played to the end. Nothing left to pause. */
  get stopped(): boolean { return this.done }
  /** How far into the song the listener is, in milliseconds. */
  get positionMs(): number { return this.startMs + this.sent * FRAME_MS }

  /** Hold here. A second pause is the same pause. */
  pause(): void {
    if (this.gate || this.done) return
    const unheard = Math.min(this.recent.length, Math.round(this.sink.queuedMs() / FRAME_MS))
    this.sink.clear()
    const back = this.recent.splice(this.recent.length - unheard, unheard)
    this.next.unshift(...back)
    this.sent -= back.length
    this.gate = new Promise(r => { this.open = r })
  }

  /** Carry on. Resuming a song that is playing does nothing. */
  resume(): void {
    if (!this.gate) return
    this.gate = null
    this.open()
  }

  /** The song is over (replaced or closed). Lets a held feed go. */
  stop(): void {
    this.done = true
    this.resume()
  }

  /** Wait out a pause; at once when playing. */
  async held(): Promise<void> {
    while (this.gate && !this.done) await this.gate
  }

  /**
   * A fresh decode starts at `atMs`, at or before the listener's point: drop
   * frames up to that point, and forget frames from the old decode.
   */
  restart(atMs: number): void {
    this.discard = Math.max(0, Math.round((this.positionMs - atMs) / FRAME_MS))
    this.recent.length = 0
    this.next.length = 0
  }

  /** Send one decoded frame, waiting while held and sending taken-back frames first. */
  async feed(frame: Int16Array): Promise<void> {
    if (this.discard > 0) { this.discard--; return }
    this.next.push(frame)
    while (this.next.length && !this.done) {
      if (this.gate) { await this.held(); continue }
      const f = this.next.shift()!
      // Remembered BEFORE the capture is awaited: a pause can land during
      // that await, and the source already counts this frame as queued.
      this.recent.push(f)
      if (this.recent.length > KEEP) this.recent.shift()
      this.sent++
      await this.sink.capture(f)
      // A pause that landed mid-capture cleared the source before this frame
      // reached it. Clear again so it does not play during the pause; it was
      // taken back with the rest and goes out first on resume.
      if (this.gate) this.sink.clear()
    }
  }
}

export interface PlayOptions {
  head: Playhead
  body: Readable
  /** Whole seconds into the song the body is decoded from. */
  startSec: number
  /** Start decoding a body from whole seconds in. */
  decode: (body: Readable, startSec: number) => Decoder
  /** The same song, fetched again from the top, for a source that died while held. */
  reopen?: () => Promise<Readable | null>
  /** Told each decoder as it starts, so stopping the song can reach the current one. */
  onDecoder?: (d: Decoder) => void
}

/**
 * Watch a source for dying while the song is held. When it does, the decoder
 * is stopped there and then — what it still holds is redundant, because the
 * song will be decoded again from the held point.
 */
const watch = (body: Readable, head: Playhead, dec: () => Decoder): (() => boolean) => {
  let ended = false
  let lost = false
  body.once('end', () => { ended = true })
  body.once('close', () => {
    if (ended || !head.paused || head.stopped) return
    lost = true
    dec().stop()
  })
  return () => lost
}

/**
 * Play one song to the end, through any number of pauses.
 *
 * 'replaced' when stopped (a skip, a close), which reports no end; 'failed'
 * when a source that died during a pause cannot be fetched again; 'ended'
 * otherwise. A sink that throws is the caller's to catch.
 */
export const playThrough = async (o: PlayOptions): Promise<'ended' | 'replaced' | 'failed'> => {
  const { head } = o
  let dec = o.decode(o.body, o.startSec)
  o.onDecoder?.(dec)
  let lost = watch(o.body, head, () => dec)
  try {
    for (;;) {
      for await (const frame of frames(dec.pcm)) {
        if (head.stopped || lost()) break
        await head.feed(frame)
        if (head.stopped || lost()) break
      }
      if (head.stopped || !lost() || !o.reopen) break
      // Noticed during the pause; carry on only once it is over.
      await head.held()
      if (head.stopped) break
      dec.stop()
      const atSec = Math.floor(head.positionMs / 1000)
      const fresh = await o.reopen()
      if (head.stopped) { fresh?.destroy(); break }
      if (!fresh) return 'failed'
      head.restart(atSec * 1000)
      dec = o.decode(fresh, atSec)
      o.onDecoder?.(dec)
      lost = watch(fresh, head, () => dec)
    }
    const how = head.stopped ? 'replaced' : 'ended'
    // Over from here, before ffmpeg has finished exiting: a pause landing in
    // that moment must find nothing to hold (the service answers 409), or the
    // room would sit paused on a song that has already ended.
    head.stop()
    dec.stop()
    await dec.done
    return how
  } finally {
    head.stop()
    dec.stop()
  }
}
