/**
 * User Volume above 100 %, for a remote voice (spec 12).
 *
 * An <audio> element plays at most at volume 1 and throws past it, so 150 %
 * cannot be an element volume. Past what the element can play, the voice
 * goes through one shared Web Audio gain stage instead; at or under it,
 * nothing changes — the element plays on its own, as every voice did
 * before. So the stage only exists for somebody you have actually turned up.
 *
 * **How the stage taps the sound.** It reads the element's stream with
 * `createMediaStreamSource`, and leaves the element playing, muted. That is
 * how livekit-client's own `webAudioMix` does it, and for the same reason:
 * Chromium feeds a remote WebRTC stream into Web Audio only while a media
 * element also plays it. It is not `createMediaElementSource`, which can be
 * called once per element, ever, and captures that element's sound for good
 * — and livekit-client hands detached elements out again from a pool, to
 * music and screen shares as well as to voices.
 *
 * **The output device.** The stage plays through the context, not the
 * element, so a chosen output device has to be set on the context too
 * (`AudioContext.setSinkId`). Where the browser has no such thing and a
 * device other than the default is chosen, amplifying would move the voice
 * to the wrong speakers — so it does not, and User Volume stops at 100.
 * Nothing goes onto the stage until the context is pointed where it should
 * be: the voice stays on its element (at most 100 %) while setSinkId is on
 * its way, and the caller is told when it settles. A device the context
 * refuses is remembered (sinkRefused), so the caller caps User Volume at
 * 100 for it, as for a browser that cannot follow it at all.
 *
 * **Never silent.** An element is muted for the stage only once the context
 * is running. A context that is not running is asked to resume, the voice
 * stays on its element meanwhile (at most 100 %), and the caller is told
 * when the context's state changes, to apply again.
 *
 * volumePlan, sinkRoutable and userVolumeMaxFor are the pure decision; the
 * rest is the stage.
 */

/** The User Volume slider's top, and its top when amplifying would lose the chosen output. */
export const USER_VOLUME_MAX = 200
export const USER_VOLUME_CAPPED = 100

export interface VolumePlan {
  /** The element's own volume, always 0..1. */
  elVolume: number
  /** Amplification on top of it. 1 is none, and it is above 1 only when the sink can be routed. */
  gain: number
  /** User Volume asked for more than this output can give, and got the cap instead. */
  capped: boolean
}

export const userVolumeMaxFor = (canRouteSink: boolean): number =>
  canRouteSink ? USER_VOLUME_MAX : USER_VOLUME_CAPPED

const clamp = (v: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

/**
 * How to play one voice: the element's volume, and any gain past it.
 *
 * The global output level (0–100) multiplies User Volume (0–200) rather
 * than replacing it. Where amplification cannot reach the output, User
 * Volume is held to the slider's capped top first, so what is heard matches
 * what the slider shows.
 */
export const volumePlan = (outputPct: number, userPct: number, canRouteSink: boolean): VolumePlan => {
  const max = userVolumeMaxFor(canRouteSink)
  const user = clamp(userPct, 0, USER_VOLUME_MAX, 100)
  const level = (clamp(outputPct, 0, 100, 100) / 100) * (Math.min(user, max) / 100)
  return { elVolume: Math.min(1, level), gain: Math.max(1, level), capped: user > max }
}

/** What this browser can do toward amplifying a voice. */
export interface GainSupport {
  webAudio: boolean
  /** `AudioContext.setSinkId`: the stage can follow a chosen output device. */
  contextSink: boolean
  /** `HTMLMediaElement.setSinkId`: an element can follow one. */
  elementSink: boolean
}

export const gainSupport = (): GainSupport => {
  const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
  const ME = (globalThis as { HTMLMediaElement?: typeof HTMLMediaElement }).HTMLMediaElement
  return {
    webAudio: typeof AC === 'function',
    contextSink: typeof AC === 'function' && 'setSinkId' in AC.prototype,
    elementSink: typeof ME === 'function' && 'setSinkId' in ME.prototype,
  }
}

/** "" and "default" both mean the system's default output. */
const isDefaultSink = (sinkId: string) => !sinkId || sinkId === 'default'

/**
 * Whether amplified sound can still come out of the output the member chose.
 *
 * The default output always can — and the phone app never shows an output
 * picker, so it always amplifies. A chosen one needs the context to follow
 * it, unless the browser's elements cannot follow it either: then the
 * choice is not honoured today and there is nothing to lose.
 */
export const sinkRoutable = (sinkId: string, s: GainSupport): boolean =>
  s.webAudio && (isDefaultSink(sinkId) || s.contextSink || !s.elementSink)

// ── The stage ────────────────────────────────────────────────────────────────

interface Stage {
  /** The track the source was built from. A pooled element can come back holding another. */
  track: MediaStreamTrack
  source: MediaStreamAudioSourceNode
  gain: GainNode
}
type SinkableContext = AudioContext & { setSinkId?: (id: string) => Promise<void> }

const stages = new WeakMap<HTMLMediaElement, Stage>()
let ctx: SinkableContext | null = null
/** The output the context was last pointed at; "" is the default, null unknown (a set that failed). */
let ctxSink: string | null = ''
/** The output a setSinkId is on its way to, or null. */
let sinkPending: string | null = null
/** The output the context last refused, or null. Forgotten when another is chosen. */
let sinkFailed: string | null = null
let onChange: () => void = () => {}

/** Smooths a gain change over ~30 ms, so a dragged slider does not click. */
const RAMP_S = 0.01

/** Called on every change of the shared context's state, to apply all audio again. */
export const onGainStateChange = (fn: () => void): void => { onChange = fn }

const sharedContext = (): SinkableContext | null => {
  if (ctx && ctx.state !== 'closed') return ctx
  const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
  if (typeof AC !== 'function') return null
  try { ctx = new AC() as SinkableContext } catch { return null }
  ctxSink = ''
  sinkPending = null
  sinkFailed = null
  ctx.onstatechange = () => onChange()
  return ctx
}

const sinkKey = (sinkId: string) => (isDefaultSink(sinkId) ? '' : sinkId)

/** Whether the shared context refused to play to this output. */
export const sinkRefused = (sinkId: string): boolean => {
  const want = sinkKey(sinkId)
  return want !== '' && want === sinkFailed
}

/**
 * Point the context at `sinkId`. True once it plays there — or has no way to
 * choose, and plays to the default — and false while a set is on its way or
 * after it was refused. Either answer is followed by onChange, to apply again.
 */
const pointAt = (c: SinkableContext, sinkId: string): boolean => {
  const want = sinkKey(sinkId)
  if (typeof c.setSinkId !== 'function') return true
  if (want === ctxSink && sinkPending === null) return true
  if (want === sinkPending || want === sinkFailed) return false
  sinkPending = want
  sinkFailed = null
  c.setSinkId(want).then(
    () => { if (sinkPending === want) { ctxSink = want; sinkPending = null } },
    () => { if (sinkPending === want) { ctxSink = null; sinkPending = null; sinkFailed = want } },
  ).finally(() => onChange())
  return false
}

/**
 * Play `el` at `gain` through the shared stage, toward `sinkId`, silenced
 * when `muted`. The stage reads the stream before the element's own volume,
 * so `gain` is the whole level.
 *
 * Returns false, leaving the element as it was, when the stage cannot play
 * right now; the caller then plays the element on its own.
 */
export const amplify = (el: HTMLMediaElement, gain: number, muted: boolean, sinkId: string): boolean => {
  const c = sharedContext()
  if (!c) return false
  if (c.state !== 'running') { c.resume().catch(() => {}); return false }
  const stream = el.srcObject as MediaStream | null
  const track = stream?.getAudioTracks?.()[0]
  if (!stream || !track) return false

  // Not onto the stage, nor kept on it, until the context plays where the
  // element does: connected first, it would play on the old device meanwhile.
  if (!pointAt(c, sinkId)) return false

  const level = muted ? 0 : gain
  let st = stages.get(el)
  if (st && st.track !== track) { release(el); st = undefined }
  if (st) {
    st.gain.gain.setTargetAtTime(level, c.currentTime, RAMP_S)
  } else {
    try {
      const source = c.createMediaStreamSource(stream)
      const node = c.createGain()
      node.gain.value = level
      source.connect(node)
      node.connect(c.destination)
      stages.set(el, { track, source, gain: node })
    } catch {
      return false
    }
  }
  el.muted = true
  return true
}

/**
 * Take `el` off the stage. Its `muted` is left for the caller to set, since
 * only the caller knows whether this person is muted. Harmless for an
 * element that was never on it.
 */
export const release = (el: HTMLMediaElement): void => {
  const st = stages.get(el)
  if (!st) return
  stages.delete(el)
  try { st.source.disconnect(); st.gain.disconnect() } catch { /* already gone */ }
}

/** The stage's gain for `el`, or null when it plays on its own. For debugAudio. */
export const stageGain = (el: HTMLMediaElement): number | null => stages.get(el)?.gain.gain.value ?? null

/*
 * Wake and sleep do not look at `state` first. It changes only once a
 * suspend or resume has settled, so right after leaving one call for
 * another it still reads "running" while the leave's suspend is pending —
 * and a wake that trusted it would leave the stage asleep for the new call.
 * The context runs the two in the order they were asked for.
 */

/** Resume the shared context, if there is one. For a gesture path: joining a call. */
export const wakeGain = (): void => {
  if (ctx && ctx.state !== 'closed') ctx.resume().catch(() => {})
}

/** Suspend it between calls, so it holds no audio device while nothing plays through it. */
export const sleepGain = (): void => {
  if (ctx && ctx.state !== 'closed') ctx.suspend().catch(() => {})
}
