/**
 * Skycord's sound palette.
 *
 * Original tones, not sampled from anywhere — but the shape was informed by
 * measuring a reference set (pitch, interval, duration, envelope) to understand
 * why those read as "warm app chime" and ours read as "alarm beep".
 *
 * What the measurements showed, and what changed here:
 *
 *  · REGISTER. The old cues sat at 880–1100 Hz; well-liked app sounds live
 *    around 196–523 Hz (G3–C5). Two octaves of difference is most of why the
 *    old ones felt shrill. Everything here is in that lower band.
 *
 *  · ATTACK. The old tone() did setValueAtTime(vol, now), starting the wave at
 *    full amplitude from silence — a step discontinuity, which is a click. Every
 *    voice now ramps up over ~12 ms.
 *
 *  · BODY. One bare sine is thin. Each voice is a triangle plus a quiet sine an
 *    octave down, through a lowpass, which gives weight without brightness.
 *
 *  · LENGTH. 70–100 ms reads as clipped; 200–400 ms reads as deliberate.
 *
 *  · TIMING. Note spacing used setTimeout, which jitters under load. Notes are
 *    scheduled on the AudioContext clock instead, so a motif's rhythm is exact
 *    however busy the main thread is.
 *
 * The palette itself is built on F–C (a perfect fifth) rather than the C–G of
 * the reference, so it's recognisably its own thing: rising = something opened,
 * falling = something closed, and the drop is bigger the more final the action.
 */

const A = { attack: 0.012, release: 0.08 }

let _ctx: AudioContext | null = null
let _master: GainNode | null = null

const ctx = (): AudioContext | null => {
  try {
    if (!_ctx) {
      // Reuse the app-wide context if one already exists. Creating a private
      // one meant starting from `suspended` even when earlier interaction had
      // already unlocked audio elsewhere in the app — so the first cue after a
      // quiet period, typically the ringtone, was silently dropped.
      _ctx = (window as any).__skCtx ?? new AudioContext()
      ;(window as any).__skCtx = _ctx
      _master = _ctx!.createGain()
      _master.gain.value = 0.9
      _master.connect(_ctx!.destination)
    }
    return _ctx
  } catch { return null }
}

/**
 * Unlock audio on the first user gesture of the session.
 *
 * Browsers only allow an AudioContext to run once the user has interacted with
 * the page. Without this the very first ring — which arrives unprompted — has
 * to fight the autoplay policy on its own and usually loses.
 */
const unlock = () => {
  const ac = ctx()
  if (ac && ac.state === 'suspended') void ac.resume()
  if (ac && ac.state === 'running') {
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

interface Note {
  hz:    number
  at:    number     // seconds from now
  dur:   number
  vol?:  number
  /** Glide to this pitch across the note — used for the disconnect sag. */
  to?:   number
}

/**
 * One voice: triangle + sub-octave sine, lowpassed, with a real attack.
 * Scheduled on the audio clock so `at` is exact.
 */
const voice = (ac: AudioContext, n: Note) => {
  const t0  = ac.currentTime + n.at
  const vol = n.vol ?? 0.13

  const g = ac.createGain()
  const f = ac.createBiquadFilter()
  f.type = 'lowpass'
  // Track the note so low notes don't get muffled and high ones stay soft.
  f.frequency.value = Math.min(5200, Math.max(1400, n.hz * 6))
  f.Q.value = 0.7
  f.connect(g)
  g.connect(_master!)

  const mk = (type: OscillatorType, hz: number, level: number) => {
    const o = ac.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(hz, t0)
    if (n.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, n.to), t0 + n.dur)
    const og = ac.createGain()
    og.gain.value = level
    o.connect(og); og.connect(f)
    o.start(t0)
    o.stop(t0 + n.dur + A.release)
    return o
  }
  mk('triangle', n.hz, 1)
  // Sub-octave for weight. Set by measurement, not by eye: at 0.35 it came back
  // at ~50% of the fundamental's power, because the lowpass passes it far more
  // freely than it passes the triangle's harmonics. 0.22 lands it near a third,
  // so it reads as body rather than as the note itself.
  mk('sine', n.hz / 2, 0.22)

  // Ramp up, hold, then decay. exponentialRamp can't reach 0, hence the epsilon.
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + A.attack)
  g.gain.setValueAtTime(vol, t0 + Math.max(A.attack, n.dur * 0.45))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur + A.release)
}

const play = (notes: Note[]) => {
  const ac = ctx(); if (!ac) return
  // Ask for a resume when suspended, but schedule REGARDLESS and never wait on
  // that promise. Deferring the schedule until resume() settles looks tidier
  // and is a trap: resume() never resolves on an OfflineAudioContext, and a
  // browser that refuses it without a user gesture leaves it pending forever —
  // so the sound is dropped entirely instead of merely being at risk. Playing
  // immediately is at worst what the old code did; the ring loops every 2.6s
  // and its next repeat lands once the context is running.
  if (ac.state === 'suspended') { try { void ac.resume() } catch { /* ignore */ } }
  try { notes.forEach(n => voice(ac, n)) } catch { /* ignore */ }
}

// ── Pitches (F–C fifth, low register) ───────────────────────────────────────
const F2 = 87.31,  F3 = 174.61, A3 = 220.00
const C4 = 261.63, D4 = 293.66, F4 = 349.23, C5 = 523.25

// ── Messages ────────────────────────────────────────────────────────────────
// Quick rising fifth. Fires often, so it's the quietest and shortest cue here.
export const soundMessage = () => play([
  { hz: F3, at: 0,    dur: 0.09, vol: 0.11 },
  { hz: C4, at: 0.07, dur: 0.20, vol: 0.12 },
])

// @everyone / friend requests — same idea, one step higher and a third note, so
// it reads as "louder news" without being a different language.
export const soundNotification = () => play([
  { hz: A3, at: 0,    dur: 0.09, vol: 0.12 },
  { hz: F4, at: 0.08, dur: 0.11, vol: 0.13 },
  { hz: C5, at: 0.18, dur: 0.26, vol: 0.11 },
])

// ── Mute / deafen ───────────────────────────────────────────────────────────
// A mirrored pair: closing falls, opening rises. Deafen moves further than mute
// because it cuts both directions — the size of the interval carries how final
// the action is.
// The two notes are separated rather than overlapped: this pair's whole job is
// to be told apart at a glance, and a legato blur makes "closed" and "opened"
// sound like the same event.
export const soundMute     = () => play([
  { hz: C4, at: 0,     dur: 0.07, vol: 0.11 },
  { hz: F3, at: 0.085, dur: 0.22, vol: 0.11 },
])
export const soundUnmute   = () => play([
  { hz: F3, at: 0,     dur: 0.07, vol: 0.11 },
  { hz: C4, at: 0.085, dur: 0.22, vol: 0.11 },
])
export const soundDeafen   = () => play([
  { hz: C4, at: 0,    dur: 0.09, vol: 0.12 },
  { hz: F2, at: 0.08, dur: 0.30, vol: 0.12 },
])
export const soundUndeafen = () => play([
  { hz: F2, at: 0,    dur: 0.09, vol: 0.11 },
  { hz: C4, at: 0.08, dur: 0.28, vol: 0.12 },
])

// ── Call lifecycle ──────────────────────────────────────────────────────────
// You joining is the biggest positive event in the app, so it's the only cue
// that spells out a full triad. Leaving is the same triad inverted.
export const soundCallJoin  = () => play([
  { hz: F3, at: 0,    dur: 0.10, vol: 0.13 },
  { hz: A3, at: 0.09, dur: 0.10, vol: 0.13 },
  { hz: C4, at: 0.18, dur: 0.34, vol: 0.14 },
])
export const soundCallLeave = () => play([
  { hz: C4, at: 0,    dur: 0.10, vol: 0.12 },
  { hz: A3, at: 0.09, dur: 0.10, vol: 0.12 },
  { hz: F3, at: 0.18, dur: 0.34, vol: 0.12 },
])

// Someone ELSE arriving or leaving: two notes, quieter, so a busy call doesn't
// turn into a xylophone.
export const soundUserJoin  = () => play([
  { hz: A3, at: 0,    dur: 0.07, vol: 0.09 },
  { hz: D4, at: 0.06, dur: 0.16, vol: 0.09 },
])
export const soundUserLeave = () => play([
  { hz: D4, at: 0,    dur: 0.07, vol: 0.09 },
  { hz: A3, at: 0.06, dur: 0.16, vol: 0.09 },
])

// Connection dropped — a single note sagging in pitch. The only cue that glides,
// which is what makes it read as a failure rather than a choice.
export const soundDisconnect = () => play([
  { hz: F3, at: 0, dur: 0.45, vol: 0.13, to: F2 },
])

// ── Ringing ─────────────────────────────────────────────────────────────────
// The ring deliberately breaks the palette's low register, and this is the one
// place that's correct.
//
// Everything else here sits around F3-C4 (175-262 Hz) because that reads as warm
// for a cue you hear a hundred times a day. A ringtone has the opposite job: be
// noticed from across the room, through laptop speakers. Two facts make the low
// register wrong for that:
//
//   · Small speakers roll off hard below ~200 Hz. An F3 ring, with its
//     sub-octave at 87 Hz, is largely not reproduced at all.
//   · Equal-loudness: at 175 Hz you need roughly 10-15 dB more level than at
//     880 Hz to sound equally loud, so even when reproduced it reads quiet.
//
// Real phone ringtones sit at 400-1000 Hz for exactly these reasons. This keeps
// the palette's F-C fifth for continuity, but two octaves up where it carries.
const F5 = 698.46, C5_ = 523.25, F4_ = 349.23

let _ringT: ReturnType<typeof setInterval> | null = null
const RING_MS = 2600
export const soundRingStart = () => {
  if (_ringT) return
  const ring = () => play([
    { hz: C5_, at: 0,    dur: 0.24, vol: 0.22 },
    { hz: F5,  at: 0.28, dur: 0.32, vol: 0.22 },
  ])
  ring()
  _ringT = setInterval(ring, RING_MS)
}
export const soundRingStop = () => { if (_ringT) { clearInterval(_ringT); _ringT = null } }

// Your outgoing call, waiting for them to pick up. Softer and lower than the
// incoming ring: it's feedback that something is happening, not a demand for
// attention, and you're already looking at the screen.
let _dialT: ReturnType<typeof setInterval> | null = null
export const soundDialStart = () => {
  if (_dialT) return
  const dial = () => play([
    { hz: F4_, at: 0,    dur: 0.22, vol: 0.10 },
    { hz: C5_, at: 0.26, dur: 0.28, vol: 0.10 },
  ])
  dial()
  _dialT = setInterval(dial, RING_MS)
}
export const soundDialStop = () => { if (_dialT) { clearInterval(_dialT); _dialT = null } }
