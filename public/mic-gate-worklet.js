/**
 * Voice-activity gate + input-volume stage for the published microphone track.
 *
 * This runs on the AUDIO thread on purpose. The obvious implementation is a
 * requestAnimationFrame loop driving a GainNode from the main thread (that is
 * what the mic test in Voice settings used to do), but rAF is throttled to a
 * crawl — and eventually stopped — in a backgrounded tab. A gate frozen in the
 * closed state is a microphone that silently stops working the moment the user
 * alt-tabs mid-call, which is far worse than no gate at all. An AudioWorklet is
 * never throttled, so the gate keeps tracking the voice whatever the tab does.
 *
 * Served from /public rather than bundled: AudioWorklet.addModule() fetches a
 * classic script by URL, so it must exist as a plain file at a stable path.
 */

// How long the gate stays open after the last loud block. Without it, the tails
// of words get chopped and speech sounds stuttery.
const HANGOVER_S = 0.25
// Asymmetric envelope: open fast enough not to clip the start of a word, close
// gently so the noise floor fades out instead of clicking.
const ATTACK_S  = 0.005
const RELEASE_S = 0.06

class MicGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Same 0..1 scale the level meter in Voice settings draws on, so the
      // marker sits exactly where the gate really opens.
      { name: 'threshold', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'volume',    defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      // 1 = pass everything through. Push-to-talk sets this: the key IS the
      // gate there, and stacking a VAD on top would clip the first syllable.
      { name: 'bypass',    defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ]
  }

  constructor() {
    super()
    this.gain     = 0
    this.lastLoud = -1e9
    this.ramp     = new Float32Array(128)
  }

  process(inputs, outputs, params) {
    const input  = inputs[0]
    const output = outputs[0]
    // No input yet (or the source went away): keep the node alive, emit silence.
    if (!input || input.length === 0 || !input[0]) return true

    const thr    = params.threshold[0]
    const vol    = params.volume[0]
    const bypass = params.bypass[0] >= 0.5
    const n      = input[0].length

    // Block peak, matched to the meter's maths (|sample| * 1.6) so a given
    // sensitivity means the same thing in the test and in a real call.
    let peak = 0
    for (let c = 0; c < input.length; c++) {
      const ch = input[c]
      for (let i = 0; i < ch.length; i++) {
        const a = ch[i] < 0 ? -ch[i] : ch[i]
        if (a > peak) peak = a
      }
    }
    const level = Math.min(1, peak * 1.6)

    // threshold 0 => level >= 0 is always true => gate permanently open, which
    // is exactly what "sensitivity 0" should mean. No special case needed.
    if (bypass || level >= thr) this.lastLoud = currentTime
    const open   = currentTime - this.lastLoud < HANGOVER_S
    const target = open ? 1 : 0
    const coef   = 1 - Math.exp(-1 / ((open ? ATTACK_S : RELEASE_S) * sampleRate))

    // Per-sample ramp rather than one gain per 128-sample block: stepping the
    // gain block-wise is audible as zipper noise on the edges of speech.
    if (this.ramp.length !== n) this.ramp = new Float32Array(n)
    const ramp = this.ramp
    let g = this.gain
    for (let i = 0; i < n; i++) {
      g += (target - g) * coef
      ramp[i] = g * vol
    }
    this.gain = g

    for (let c = 0; c < output.length; c++) {
      const inCh  = input[Math.min(c, input.length - 1)]
      const outCh = output[c]
      for (let i = 0; i < n; i++) outCh[i] = inCh[i] * ramp[i]
    }
    return true
  }
}

registerProcessor('mic-gate', MicGateProcessor)
