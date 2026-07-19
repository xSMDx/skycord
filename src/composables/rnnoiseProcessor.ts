/**
 * RNNoise noise suppression as a LiveKit audio TrackProcessor.
 *
 * LiveKit hands us the raw mic track and takes back `processedTrack`, so mute,
 * push-to-talk, device switching and the speaking-ring analyser keep working on
 * the publication exactly as before — only the audio flowing through it is
 * cleaned. RNNoise is speech-tuned and aggressive: great on fans/keyboards/hum,
 * unkind to background music. That's why it's opt-in (see voiceSettings.noiseMode).
 */
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import { Track } from 'livekit-client'
import type { TrackProcessor, AudioProcessorOptions } from 'livekit-client'

// The wasm binary is fetched once per session and reused across calls/devices.
let wasmBinary: ArrayBuffer | null = null
const getWasm = async () => {
  if (!wasmBinary) wasmBinary = await loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl })
  return wasmBinary
}

export const createRnnoiseProcessor = (): TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> => {
  let ctx: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let node: RnnoiseWorkletNode | null = null
  let dest: MediaStreamAudioDestinationNode | null = null

  const teardown = async () => {
    try { source?.disconnect() } catch { /* ignore */ }
    try { node?.disconnect(); node?.destroy() } catch { /* ignore */ }
    try { dest?.disconnect() } catch { /* ignore */ }
    source = null; node = null; dest = null
    if (ctx) { const c = ctx; ctx = null; try { await c.close() } catch { /* ignore */ } }
  }

  const build = async (opts: AudioProcessorOptions) => {
    try {
      const binary = await getWasm()
      // RNNoise assumes 48kHz. Own the context rather than borrowing LiveKit's,
      // which may run at a different rate and would pitch-shift the output.
      ctx = new AudioContext({ sampleRate: 48000 })
      await ctx.audioWorklet.addModule(rnnoiseWorkletUrl)
      source = ctx.createMediaStreamSource(new MediaStream([opts.track]))
      node = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: binary })
      dest = ctx.createMediaStreamDestination()
      source.connect(node)
      node.connect(dest)
      processor.processedTrack = dest.stream.getAudioTracks()[0]
    } catch (e) {
      // LiveKit never assigns a processor whose init() rejected, so it will
      // never call destroy() on us — release the half-built graph ourselves or
      // every failed attempt strands a live AudioContext.
      await teardown()
      throw e
    }
  }

  const processor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> = {
    name: 'rnnoise',
    async init(opts) { await build(opts) },
    // Fired on device switch — rebuild the graph around the new mic track.
    async restart(opts) { await teardown(); await build(opts) },
    async destroy() { await teardown(); processor.processedTrack = undefined },
  }

  return processor
}
