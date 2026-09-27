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
  const [module] = await Promise.all([
    getWasmModule(),
    ctx.audioWorklet.addModule(dfWorkletUrl),
  ])
  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
    numberOfInputs: 1, numberOfOutputs: 1,
    // The worklet's ring buffer only ever reads/writes one channel; matching
    // RNNoise's belt-and-braces downmix so a stereo device can't leave one
    // channel unprocessed.
    channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
    processorOptions: { wasmModule: module, attenuationLimit: 100 },
  })
  return node
}

// The LiveKit processor that carries this node lives in micChain.ts —
// DeepFilterNet is one stage of the mic graph, not a pipeline of its own.
