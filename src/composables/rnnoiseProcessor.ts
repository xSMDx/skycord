/**
 * RNNoise noise suppression as a reusable WebAudio node.
 *
 * RNNoise is speech-tuned and aggressive: great on fans/keyboards/hum, unkind to
 * background music. That's why it's opt-in (see voiceSettings.noiseMode).
 */
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'

// The wasm binary is fetched once per session and reused across calls/devices.
let wasmBinary: ArrayBuffer | null = null
const getWasm = async () => {
  if (!wasmBinary) wasmBinary = await loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl })
  return wasmBinary
}

/**
 * Build a ready-to-connect RNNoise node on an existing context. Shared with the
 * mic test so "Mic Test" hears exactly what the call publishes — testing against
 * an unfiltered monitor is how you conclude the filter "does nothing".
 * The context MUST be 48kHz; RNNoise assumes it.
 */
export const createRnnoiseNode = async (ctx: AudioContext): Promise<RnnoiseWorkletNode> => {
  const binary = await getWasm()
  await ctx.audioWorklet.addModule(rnnoiseWorkletUrl)
  const node = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: binary })
  // Belt-and-braces downmix: even if a device hands us stereo, collapse to one
  // channel BEFORE the model so no channel escapes unprocessed.
  node.channelCount = 1
  node.channelCountMode = 'explicit'
  node.channelInterpretation = 'speakers'
  return node
}

// The LiveKit processor that carries this node lives in micChain.ts — RNNoise
// is one stage of the mic graph, not a pipeline of its own.
