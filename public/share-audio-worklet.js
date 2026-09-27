/**
 * Shared-application audio, on the audio thread.
 *
 * A native addon captures one application's sound on Windows and sends it
 * here as interleaved stereo float chunks. This turns that stream back into
 * an AudioWorklet output, which becomes a MediaStreamTrack and goes out as a
 * second LiveKit track beside the screen share.
 *
 * The audio thread cannot wait for anything, so the only job here is a ring
 * buffer with two honest failure modes: when a chunk is late, render silence;
 * when chunks arrive faster than they are consumed, drop the oldest. Silence
 * is a gap in the sound, which is what a dropped packet should be. Repeating
 * the last block instead would sound like a stutter, and growing the queue
 * without limit would turn a hiccup into permanent delay.
 *
 * Served from /public rather than bundled: AudioWorklet.addModule() fetches a
 * classic script by URL, so it must exist as a plain file at a stable path.
 */

// Six 10 ms chunks. Enough to ride out ordinary IPC jitter, short enough that
// the sound stays with the picture.
const MAX_QUEUED = 6

class ShareAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    /** @type {Float32Array[]} interleaved stereo chunks, oldest first */
    this.queue = []
    /** How far into queue[0] the last block got, in samples. */
    this.offset = 0
    this.port.onmessage = (event) => {
      const chunk = event.data
      if (!(chunk instanceof Float32Array) || chunk.length === 0) return
      this.queue.push(chunk)
      // Dropping the oldest keeps delay bounded. Dropping the newest would
      // hold on to sound nobody will hear in time.
      while (this.queue.length > MAX_QUEUED) { this.queue.shift(); this.offset = 0 }
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0]
    if (!out || out.length === 0) return true
    const left = out[0]
    // The node asks for two channels, so this is a safety net rather than a
    // path we expect: mix down instead of silently losing one side.
    const right = out.length > 1 ? out[1] : null

    for (let i = 0; i < left.length; i++) {
      const chunk = this.queue[0]
      if (!chunk) {
        left[i] = 0
        if (right) right[i] = 0
        continue
      }
      const l = chunk[this.offset]
      const r = chunk[this.offset + 1]
      if (right) { left[i] = l; right[i] = r } else { left[i] = (l + r) / 2 }
      this.offset += 2
      if (this.offset >= chunk.length) { this.queue.shift(); this.offset = 0 }
    }
    // Never return false: that ends the node for good, and the share may well
    // go quiet for a while before it has more to say.
    return true
  }
}

registerProcessor('share-audio', ShareAudioProcessor)
