/**
 * The microphone processing chain, as a LiveKit audio TrackProcessor.
 *
 *   mic ─▶ [model] ─▶ mic-gate (sensitivity + input volume) ─▶ published
 *
 * "model" is RNNoise, DeepFilterNet 3, or nothing — see NoiseNodeKind in
 * useVoiceSettings.ts. Both models take the same position in the graph, one
 * at a time; they are never stacked.
 *
 * Why a processor: LiveKit hands us the raw capture and publishes whatever we
 * put in `processedTrack`, so mute, push-to-talk, device switching and the
 * speaking-ring analyser all keep working on the publication untouched — only
 * the audio flowing through it changes.
 *
 * This exists because Input Sensitivity and Input Volume used to be wired only
 * into the mic-test monitor in Voice settings. Both sliders moved a GainNode
 * that fed the local speakers and nothing else, so they demonstrably worked
 * while testing and did absolutely nothing in a real call.
 */
import { Track } from 'livekit-client'
import type { TrackProcessor, AudioProcessorOptions } from 'livekit-client'
import { createRnnoiseNode } from './rnnoiseProcessor'
import { voiceSettings, gateThreshold, effectiveInputMode, type NoiseNodeKind } from './useVoiceSettings'

// Lives in /public, so it ships to dist untouched and is fetchable by URL —
// which is the only thing addModule() accepts. Absolute because the app is
// served from the domain root (vite.config sets no `base`).
const GATE_WORKLET_URL = '/mic-gate-worklet.js'

export interface MicChainProcessor extends TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  /** Which model (if any) this instance was built with. Changing it changes
   *  the graph shape, so it needs a rebuild; the sliders don't, and go
   *  through update() instead. */
  readonly noiseNode: NoiseNodeKind
  /** Push the current settings onto the live graph — no rebuild, no audio gap. */
  update(): void
}

export const createMicChainProcessor = (noiseNode: NoiseNodeKind): MicChainProcessor => {
  let ctx:    AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let rn:     Awaited<ReturnType<typeof createRnnoiseNode>> | null = null
  let df:     AudioWorkletNode | null = null
  let gate:   AudioWorkletNode | null = null
  let dest:   MediaStreamAudioDestinationNode | null = null

  const applyParams = () => {
    if (!gate || !ctx) return
    const at = ctx.currentTime
    const p  = gate.parameters
    // setTargetAtTime, not direct assignment: dragging a slider would otherwise
    // step the gain and click.
    p.get('threshold')?.setTargetAtTime(gateThreshold(), at, 0.01)
    p.get('volume')?.setTargetAtTime(voiceSettings.inputVolume / 100, at, 0.02)
    p.get('bypass')?.setTargetAtTime(effectiveInputMode() === 'ptt' ? 1 : 0, at, 0.001)
  }

  const teardown = async () => {
    try { source?.disconnect() } catch { /* ignore */ }
    try { rn?.disconnect(); rn?.destroy() } catch { /* ignore */ }
    // DeepFilterNet's worklet has no destroy message — its wasm memory lives
    // in this context's own AudioWorkletGlobalScope, so closing ctx below
    // reclaims it. Nothing to free explicitly, unlike RNNoise's node.
    try { df?.disconnect() } catch { /* ignore */ }
    try { gate?.disconnect() } catch { /* ignore */ }
    try { dest?.disconnect() } catch { /* ignore */ }
    source = null; rn = null; df = null; gate = null; dest = null
    if (ctx) { const c = ctx; ctx = null; try { await c.close() } catch { /* ignore */ } }
  }

  const build = async (opts: AudioProcessorOptions) => {
    try {
      // 48kHz because both models assume it; harmless for the gate-only path,
      // and owning the context beats borrowing LiveKit's (which may run at
      // another rate and would pitch-shift the output).
      ctx = new AudioContext({ sampleRate: 48000 })
      await ctx.audioWorklet.addModule(GATE_WORKLET_URL)
      source = ctx.createMediaStreamSource(new MediaStream([opts.track]))
      gate = new AudioWorkletNode(ctx, 'mic-gate', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
        channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      })
      dest = ctx.createMediaStreamDestination()

      let head: AudioNode = source
      if (noiseNode === 'rnnoise') {
        rn = await createRnnoiseNode(ctx); head.connect(rn); head = rn
      } else if (noiseNode === 'deepfilter') {
        // Dynamic import: this pulls in a multi-megabyte wasm, so it must
        // never be reached unless the mode is actually selected — see
        // deepFilterProcessor.ts.
        const { createDeepFilterNode } = await import('./deepFilterProcessor')
        df = await createDeepFilterNode(ctx); head.connect(df); head = df
      }
      head.connect(gate)
      gate.connect(dest)

      applyParams()
      processor.processedTrack = dest.stream.getAudioTracks()[0]
    } catch (e) {
      // LiveKit never assigns a processor whose init() rejected, so it will
      // never call destroy() on us — release the half-built graph here or every
      // failed attempt strands a live AudioContext.
      await teardown()
      throw e
    }
  }

  const processor: MicChainProcessor = {
    name: 'mic-chain',
    noiseNode,
    update: applyParams,
    async init(opts) { await build(opts) },
    // Fired on device switch — rebuild the graph around the new mic track.
    async restart(opts) { await teardown(); await build(opts) },
    async destroy() { await teardown(); processor.processedTrack = undefined },
  }

  return processor
}
