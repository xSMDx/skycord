/**
 * One shared application's sound, as a track LiveKit can publish.
 *
 * The Windows app captures it natively and sends interleaved stereo float
 * chunks down a MessagePort. This end turns that back into audio: an
 * AudioWorklet ring-buffers the chunks and a MediaStreamAudioDestinationNode
 * gives us a real MediaStreamTrack.
 *
 * Deliberately NOT a getUserMedia track: Chromium's echo canceller, gain
 * control and noise suppression are built for a microphone, and a game's
 * soundtrack run through them comes out pumping and hollow. A worklet's
 * output goes out as it arrived.
 *
 * Module-level state, one share at a time, matching the rest of the voice
 * composables.
 */
const WORKLET_URL = '/share-audio-worklet.js'
const WORKLET_NAME = 'share-audio'

interface Live {
  ctx: AudioContext
  node: AudioWorkletNode
  port: MessagePort
  track: MediaStreamTrack
}
let live: Live | null = null

/**
 * Build the track and start feeding it. Returns null when the browser will
 * not give us a worklet, which is not worth a toast on its own — the caller
 * reports the share going out without sound.
 */
export const startShareAudioTrack = async (
  port: MessagePort,
  ctxFactory: () => AudioContext = () => new AudioContext({ sampleRate: 48000 }),
): Promise<MediaStreamTrack | null> => {
  if (live) return null
  const ctx = ctxFactory()
  /** Give back everything this function has taken, in reverse. */
  const abandon = async () => {
    port.onmessage = null
    port.close()
    await ctx.close().catch(() => {})
    return null
  }

  try {
    await ctx.audioWorklet.addModule(WORKLET_URL)
  } catch (e) {
    console.warn('[share-audio] the worklet did not load', e)
    return abandon()
  }

  const node = new AudioWorkletNode(ctx, WORKLET_NAME, { numberOfInputs: 0, outputChannelCount: [2] })
  const dest = ctx.createMediaStreamDestination()
  node.connect(dest)

  // Transfer rather than copy: this runs a hundred times a second.
  port.onmessage = (event: MessageEvent) => {
    const chunk = event.data
    if (!(chunk instanceof Float32Array)) return
    node.port.postMessage(chunk, [chunk.buffer])
  }
  port.start?.()

  const track = dest.stream.getAudioTracks()[0] ?? null
  if (!track) { node.disconnect(); return abandon() }
  live = { ctx, node, port, track }
  return track
}

/** Tear everything down. Safe whether or not a share is running. */
export const stopShareAudioTrack = async (): Promise<void> => {
  const l = live
  live = null
  if (!l) return
  l.port.onmessage = null
  l.port.close()
  l.node.disconnect()
  l.track.stop()
  await l.ctx.close().catch(() => {})
}
