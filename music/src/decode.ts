/**
 * Decode whatever was fetched into the PCM LiveKit wants.
 *
 * ## ffmpeg never sees the URL
 *
 * The body arrives as a stream and is piped into ffmpeg's stdin. No part of
 * anything a member typed appears in the argument vector — not the URL, not
 * a filename, not a header. That deletes the whole argument-injection class
 * rather than defending against it: there is no `--` to forget, because
 * there is no user data in argv to separate from the flags.
 *
 * Phase 2 keeps the property rather than spending it. Ingest runs ffmpeg
 * over temp files, but the paths are randomUUID names in a directory we
 * own, so there is still no member-supplied text anywhere in argv. The
 * thing that would have broken this — handing yt-dlp a URL on its command
 * line — was dropped for separate reasons; see docs/music-phase-2.md.
 *
 * ## Why spawn and never exec
 *
 * `spawn` with an array goes straight to execve with no shell between. Even
 * with no user data in the arguments, a shell is a parser nobody needs: it
 * would turn any future argument containing a space, a quote or a semicolon
 * into a bug waiting for the day someone adds one.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import type { Readable } from 'stream'

/** What LiveKit expects, and what AudioFrame is built around. */
export const SAMPLE_RATE = 48_000
export const CHANNELS = 2
/** 20ms of audio: 960 samples per channel. The usual Opus frame. */
export const SAMPLES_PER_FRAME = SAMPLE_RATE / 50
export const BYTES_PER_FRAME = SAMPLES_PER_FRAME * CHANNELS * 2   // s16 = 2 bytes

/** The furthest in a track may start. No song is six hours long. */
export const MAX_START_SEC = 6 * 60 * 60

/**
 * A start offset fit for argv, or 0.
 *
 * The one variable entry ffmpeg is ever given, and safe by construction:
 * only an integer in range survives this, and String() of an integer is
 * digits. Anything else — a fraction, a string, a negative — means "from
 * the start" rather than an error, because the API has already refused it.
 */
export const startOffset = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_START_SEC ? v : 0

/**
 * Fixed apart from where to start, and a function so a test can read it.
 *
 * Nothing else here is interpolated, and nothing else should ever be: the
 * moment an entry is built from input, the comment at the top of this file
 * stops being true. The start offset is the single exception, and it only
 * ever gets here through startOffset().
 */
export const ffmpegArgs = (startSec: number = 0): string[] => {
  const at = startOffset(startSec)
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', 'pipe:0',       // the fetched body, never a URL or a path
    // After -i, not before: a pipe cannot be sought, so ffmpeg decodes and
    // throws away up to here. Opus decodes far faster than real time, so
    // even the end of a long song is reached in about a second.
    ...(at ? ['-ss', String(at)] : []),
    '-vn',                // an mp3 can carry cover art; we want none of it
    '-f', 's16le',
    '-ar', String(SAMPLE_RATE),
    '-ac', String(CHANNELS),
    'pipe:1',
  ]
}

export interface Decoder {
  /** Interleaved 16-bit little-endian stereo at 48kHz. */
  pcm: Readable
  /** Stop ffmpeg and release the pipe. Safe to call twice. */
  stop: () => void
  /** Resolves when ffmpeg exits; the code is null if it was killed. */
  done: Promise<number | null>
}

export interface DecodeOptions {
  ffmpegPath?: string
  /** Called with ffmpeg's stderr, which is where a bad file explains itself. */
  onStderr?: (line: string) => void
  /** Whole seconds in to start from. See startOffset. */
  startSec?: number
}

export const decode = (body: Readable, opts: DecodeOptions = {}): Decoder => {
  const child: ChildProcessWithoutNullStreams = spawn(
    opts.ffmpegPath ?? 'ffmpeg',
    ffmpegArgs(opts.startSec),
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  )

  // A source that ends, errors, or is destroyed must not leave ffmpeg holding
  // an open stdin forever — it would never exit and the container would
  // accumulate processes until its memory limit stopped the service.
  body.pipe(child.stdin)
  body.on('error', () => child.stdin.destroy())
  // EPIPE here is normal: it means ffmpeg exited first, which is what the
  // byte cap and stop() both cause.
  child.stdin.on('error', () => {})

  if (opts.onStderr) {
    let buf = ''
    child.stderr.on('data', (c: Buffer) => {
      buf += c.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const l of lines) if (l.trim()) opts.onStderr!(l.trim())
    })
  } else {
    child.stderr.resume()        // drained, or the pipe fills and ffmpeg blocks
  }

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    child.stdin.destroy()
    child.kill('SIGKILL')
  }

  const done = new Promise<number | null>((resolve) => {
    child.on('close', code => resolve(code))
    child.on('error', () => resolve(null))      // ffmpeg missing, or not executable
  })

  return { pcm: child.stdout, stop, done }
}

/**
 * Cut a byte stream into exactly-sized frames.
 *
 * LiveKit's AudioSource takes whole frames; a stream hands over whatever
 * size the pipe felt like. Everything short of a full frame is held back
 * until the rest arrives, because a partial frame played as a whole one is
 * a click.
 */
export const frames = async function* (pcm: Readable): AsyncGenerator<Int16Array> {
  let held = Buffer.alloc(0)
  for await (const chunk of pcm) {
    // Always concat, never adopt the chunk: a chunk is Buffer<ArrayBufferLike>
    // and may be backed by a SharedArrayBuffer, which is not the Buffer this
    // holds. Concat gives back the narrow type and costs nothing here.
    held = Buffer.concat([held, chunk as Buffer])
    while (held.length >= BYTES_PER_FRAME) {
      const slice = held.subarray(0, BYTES_PER_FRAME)
      held = held.subarray(BYTES_PER_FRAME)
      // Copy: subarray shares memory with `held`, which the next concat
      // reuses, so a frame handed on without copying would be rewritten
      // under the consumer.
      yield new Int16Array(new Uint8Array(slice).buffer)
    }
  }
  // Whatever is left is less than a frame. Dropped rather than padded: a few
  // milliseconds of silence at the very end of a track is not worth a branch.
}
