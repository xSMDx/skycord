/**
 * DeepFilterNet 3 noise suppression as a reusable WebAudio node.
 *
 * Where RNNoise is band-gain and strongest on steady sound (fans, hum),
 * DeepFilterNet is the real model — stronger on the noise RNNoise is weakest
 * on: clatter, keyboards, reverberant rooms. It solves NOISE, same as RNNoise;
 * it is not speaker separation and does not touch a second talker's voice —
 * see voiceSettings.noiseMode for why RNNoise stays as its own mode rather
 * than being replaced.
 *
 * The wasm carries the model weights baked in and is a multi-megabyte,
 * one-off download — this file must therefore only ever be reached through a
 * dynamic import() gated on the mode actually being selected (see
 * micChain.ts and VoiceVideoSettings.vue). A static import here would put
 * that download on every session's critical path, including the sessions of
 * everyone who never turns this mode on.
 *
 * The package ships its own AudioWorkletProcessor (registered as
 * "deepfilternet-processor" by dist/worklet.js) rather than exposing a node
 * class the way @sapphi-red/web-noise-suppressor does for RNNoise, so this
 * mirrors what the package's own `denoiseStream()` helper does internally —
 * compile the wasm once, register the worklet, hand the compiled module to
 * the processor — except wired into micChain's existing context and graph
 * instead of a standalone one, so it can sit in the same position RNNoise
 * does.
 */
import dfWasmUrl from '@lofcz/deepfilternet-web/df_bg.wasm?url'
import dfWorkletUrl from '@lofcz/deepfilternet-web/worklet?url'

const PROCESSOR_NAME = 'deepfilternet-processor'

/**
 * How far the model may turn down what it decides is not speech.
 *
 * The package defaults to 100 dB, which is not suppression but erasure: measured
 * here, a signal it judged non-speech came back as exact digital silence. That is
 * the wrong failure for this app. The model decides what a voice is, and it will
 * sometimes be wrong — a quiet microphone, a heavy accent, a cheap headset, someone
 * speaking through a fan. At 100 dB that person simply does not exist on the call
 * and cannot tell why; at 24 dB they are faint and audible, and can hear themselves
 * being cut and switch the mode off. Loud enough to matter, never a mute.
 *
 * Measured on this build: 0 dB passes audio through untouched, 6 dB halves it,
 * 100 dB silences it — so this number is the whole behaviour of the mode.
 */
const ATTENUATION_DB = 24

/**
 * The package's worklet is given a text decoder on the way in.
 *
 * Its wasm-bindgen glue builds a `new TextDecoder(...)` at module top level, and
 * an AudioWorkletGlobalScope is not required to have one — the spec gives worklets
 * a deliberately small global scope. Where it is missing the module throws before
 * `registerProcessor` runs, the node can never be constructed, and the mode falls
 * back to whatever was on before.
 *
 * Honest about what is known: this was reported in one Chromium during
 * development and did NOT reproduce in the one measured here, where the
 * unpatched worklet registers fine. The shim is kept because the app ships its
 * own Chromium through Electron and upgrades it on its own schedule, and the
 * cost is one fetch of a small file at the moment the mode is first switched on.
 * Rather than patch node_modules (which a reinstall undoes) or wait on
 * upstream, the source is fetched, given a decoder, and registered from a blob.
 * The decoder only ever handles the glue's own strings — wasm-bindgen uses it
 * for error text and symbol names, never for audio — so a small correct UTF-8
 * reader is enough. Delete all of this once the package ships a worklet that
 * does not assume a window.
 */
const TEXT_CODEC_SHIM = `
globalThis.TextDecoder ??= class {
  decode(input) {
    if (!input) return ''
    const b = input instanceof Uint8Array ? input : new Uint8Array(input.buffer ?? input, input.byteOffset ?? 0, input.byteLength ?? input.length)
    let out = ''
    for (let i = 0; i < b.length;) {
      const c = b[i++]
      if (c < 0x80) { out += String.fromCharCode(c); continue }
      if (c < 0xe0) { out += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f)); continue }
      if (c < 0xf0) { out += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f)); continue }
      const cp = (((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f)) - 0x10000
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
    }
    return out
  }
}
globalThis.TextEncoder ??= class {
  encode(s = '') {
    const out = []
    for (const ch of s) {
      let cp = ch.codePointAt(0)
      if (cp < 0x80) out.push(cp)
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    }
    return new Uint8Array(out)
  }
}
`

/** The patched worklet, fetched and blobbed once per session. */
let workletUrl: Promise<string> | null = null
const getWorkletUrl = () => {
  if (!workletUrl) {
    workletUrl = fetch(dfWorkletUrl)
      .then(r => {
        if (!r.ok) throw new Error(`DeepFilterNet worklet fetch failed (${r.status})`)
        return r.text()
      })
      .then(src => URL.createObjectURL(new Blob([TEXT_CODEC_SHIM, src], { type: 'text/javascript' })))
      .catch(e => { workletUrl = null; throw e })
  }
  return workletUrl
}

// Compiled once per session and reused across calls/devices, same reasoning
// as rnnoiseProcessor's wasmBinary cache: the model doesn't change between
// them, and re-fetching ~10MB on every mode toggle or device switch would be
// its own kind of failure.
let wasmModule: Promise<WebAssembly.Module> | null = null
const getWasmModule = () => {
  if (!wasmModule) {
    wasmModule = fetch(dfWasmUrl)
      .then(r => {
        if (!r.ok) throw new Error(`DeepFilterNet wasm fetch failed (${r.status})`)
        return r.arrayBuffer()
      })
      .then(bytes => WebAssembly.compile(bytes))
      // A failed compile must not poison every later attempt at this mode —
      // a transient network blip shouldn't require a page reload to retry.
      .catch(e => { wasmModule = null; throw e })
  }
  return wasmModule
}

/**
 * Build a ready-to-connect DeepFilterNet node on an existing context. Shared
 * with the mic test so "Mic Test" hears exactly what the call publishes —
 * testing against an unfiltered monitor is how you conclude the filter "does
 * nothing".
 * The context MUST be 48kHz; DeepFilterNet, like RNNoise, assumes it.
 */
export const createDeepFilterNode = async (ctx: AudioContext): Promise<AudioWorkletNode> => {
  const [module, url] = await Promise.all([getWasmModule(), getWorkletUrl()])
  await ctx.audioWorklet.addModule(url)
  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
    numberOfInputs: 1, numberOfOutputs: 1,
    // The worklet's ring buffer only ever reads/writes one channel; matching
    // RNNoise's belt-and-braces downmix so a stereo device can't leave one
    // channel unprocessed.
    channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
    processorOptions: { wasmModule: module, attenuationLimit: ATTENUATION_DB },
  })
  return node
}

// The LiveKit processor that carries this node lives in micChain.ts —
// DeepFilterNet is one stage of the mic graph, not a pipeline of its own.
