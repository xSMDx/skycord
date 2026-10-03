/**
 * Turning untrusted bytes into a track.
 *
 *     bytes ─▶ cap ─▶ sniff ─▶ scan ─▶ transcode ─▶ probe ─▶ out
 *              size   magic   clamd    ffmpeg       tags
 *
 * ## Why it goes to disk first
 *
 * Four stages need the whole file and three of them need it from the start,
 * so a single pass is not available: the signature check reads the head, the
 * scanner reads everything, ffmpeg reads everything again, and ffprobe needs
 * to seek. Teeing one stream four ways means buffering it in memory, which
 * at a 100MB cap and several concurrent uploads is how the container gets
 * OOM-killed. A temp file is the boring answer and the right one.
 *
 * ## ffmpeg still never sees user data in argv
 *
 * decode.ts makes a point of piping the body to stdin so no part of a URL
 * reaches the argument vector. That property survives here for a different
 * reason: the paths in these commands are ones we generated with randomUUID
 * in a directory we own. No filename, tag or URL from the member appears in
 * any argument, and the output of a probe is parsed, never interpolated.
 *
 * ## Why the transcode is the real control
 *
 * Whatever the original held — a malformed atom aimed at a container parser,
 * a payload in a tag nothing reads, a polyglot that is also a valid
 * something-else — what gets stored is what our encoder wrote after decoding
 * to PCM. Signature scanning protects the download path, where a member can
 * pull another member's file onto their own disk. The re-encode protects
 * everything else, and it is why an unscanned instance is still defensible.
 */
import { spawn } from 'child_process'
import { createReadStream, createWriteStream } from 'fs'
import { mkdir, open, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { pipeline } from 'stream/promises'
import { Transform, type Readable } from 'stream'
import { sniff, SNIFF_BYTES, type AudioKind } from './sniff.js'
import { scanStream, type ClamConfig, type ScanVerdict } from './clamav.js'

export interface IngestLimits {
  maxBytes: number
  maxDurationSec: number
}

export interface IngestOptions {
  limits: IngestLimits
  /** Null means no scanner configured; the result says `skipped`, honestly. */
  clam: ClamConfig | null
  ffmpegPath?: string
  ffprobePath?: string
}

export interface IngestedTrack {
  title: string
  artist: string
  album: string
  durationSec: number
  /** Path to the normalised audio. The caller stores it and must clean up. */
  audioPath: string
  bytes: number
  mimeType: string
  coverWebp?: string
  scan: 'clean' | 'skipped'
}

export type IngestResult =
  | { ok: true; track: IngestedTrack; cleanup: () => Promise<void> }
  | { ok: false; reason: string }

const no = (reason: string): IngestResult => ({ ok: false, reason })

/** Opus in WebM: the one Opus container Safari will also play. */
export const AUDIO_MIME = 'audio/webm'

// ── ffmpeg argument vectors, fixed and separately readable by tests ────────

export const transcodeArgs = (src: string, dst: string): string[] => [
  '-hide_banner', '-loglevel', 'error',
  '-nostdin',
  '-i', src,
  '-vn',                          // drop cover art; it is extracted separately
  '-map_metadata', '-1',          // tags are re-attached from a sanitised probe
  '-c:a', 'libopus',
  '-b:a', '128k',
  '-ar', '48000',
  '-ac', '2',
  '-f', 'webm',
  '-y', dst,
]

export const probeArgs = (src: string): string[] => [
  '-hide_banner', '-loglevel', 'error',
  '-show_entries', 'format=duration:format_tags=title,artist,album',
  '-of', 'json',
  src,
]

export const coverArgs = (src: string, dst: string): string[] => [
  '-hide_banner', '-loglevel', 'error',
  '-nostdin',
  '-i', src,
  '-an',
  '-map', 'disp:attached_pic',   // the cover, if the container has one
  '-vframes', '1',
  '-vf', 'scale=320:320:force_original_aspect_ratio=increase,crop=320:320',
  '-f', 'webp',
  '-y', dst,
]

/** Run a child to completion, capturing stdout. Never through a shell. */
const run = (bin: string, args: string[], timeoutMs = 120_000): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = '', stderr = ''
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString() })
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString() })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    const done = (code: number | null): void => { clearTimeout(timer); resolve({ code, stdout, stderr }) }
    child.on('close', done)
    child.on('error', () => done(null))
  })

/**
 * Tag text is data someone else wrote that this app will render in a list.
 * Clamp it, drop control characters, and collapse the whitespace games that
 * make one row shove the rest of a table off screen.
 */
export const cleanTag = (raw: unknown, max = 200): string => {
  if (typeof raw !== 'string') return ''
  let s = ''
  for (const ch of raw) {
    const c = ch.codePointAt(0)!
    // Whitespace controls become a space and are collapsed below. Dropping
    // them outright would run "line one\nline two" together into one word.
    if (c === 0x09 || c === 0x0a || c === 0x0b || c === 0x0c || c === 0x0d) { s += ' '; continue }
    // Every other control character, and the bidi overrides that let a name
    // render as something other than what it is.
    if (c < 0x20 || c === 0x7f) continue
    if (c >= 0x202a && c <= 0x202e) continue
    if (c >= 0x2066 && c <= 0x2069) continue
    s += ch
  }
  s = s.replace(/\s+/g, ' ').trim()
  return [...s].slice(0, max).join('')
}

/**
 * Say a limit the way a person would.
 *
 * Both of these used integer division into a fixed unit, which is fine for
 * the shipped defaults and absurd for anything smaller: a 1KB cap announced
 * itself as "0MB at most", and a one-second cap as "0 minutes at most". An
 * operator who tightens a limit for a reason deserves an error that names
 * the limit they actually set.
 */
export const describeSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes} bytes`
}

export const describeDuration = (sec: number): string => {
  if (sec >= 120) return `${Math.round(sec / 60)} minutes`
  if (sec === 60) return 'a minute'
  return `${sec} second${sec === 1 ? '' : 's'}`
}

/** Count bytes as they pass, and stop the moment the cap is crossed. */
const capped = (max: number): { through: Transform; tooBig: () => boolean } => {
  let seen = 0, over = false
  const through = new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length
      if (seen > max && !over) { over = true; cb(new Error('too big')); return }
      cb(null, chunk)
    },
  })
  return { through, tooBig: () => over }
}

export const ingest = async (src: Readable, opts: IngestOptions): Promise<IngestResult> => {
  const dir = join(tmpdir(), 'skycord-music')
  await mkdir(dir, { recursive: true })
  const id = randomUUID()
  const rawPath = join(dir, `${id}.in`)
  const outPath = join(dir, `${id}.webm`)
  const coverPath = join(dir, `${id}.webp`)

  const sweep = async (...paths: string[]): Promise<void> => {
    await Promise.all(paths.map(p => rm(p, { force: true }).catch(() => {})))
  }
  const fail = async (reason: string): Promise<IngestResult> => {
    await sweep(rawPath, outPath, coverPath)
    return no(reason)
  }

  // ── 1. land it, under a cap ─────────────────────────────────────────────
  const { through, tooBig } = capped(opts.limits.maxBytes)
  try {
    await pipeline(src, through, createWriteStream(rawPath))
  } catch {
    if (tooBig()) return fail(`That file is too big — ${describeSize(opts.limits.maxBytes)} at most.`)
    return fail('That file could not be read all the way through.')
  }

  const landed = await stat(rawPath).catch(() => null)
  if (!landed || landed.size === 0) return fail('That file is empty.')

  // ── 2. what is it, really ───────────────────────────────────────────────
  const head = Buffer.alloc(SNIFF_BYTES)
  const fh = await open(rawPath, 'r')
  try { await fh.read(head, 0, SNIFF_BYTES, 0) } finally { await fh.close() }

  const kind = sniff(head)
  if (!kind.ok) return fail(kind.reason ?? 'That is not an audio file we can read.')

  // ── 3. scan, failing closed when a scanner is configured ────────────────
  let scan: 'clean' | 'skipped' = 'skipped'
  if (opts.clam) {
    const verdict: ScanVerdict = await scanStream(createReadStream(rawPath), opts.clam)
    if (verdict.state === 'infected') {
      return fail(`That file was refused by the virus scanner (${verdict.signature}).`)
    }
    if (verdict.state === 'error') {
      // Configured and unusable. Refusing is the whole point — see clamav.ts.
      return fail('The virus scanner is not answering, so that file was not accepted.')
    }
    scan = 'clean'
  }

  // ── 4. how long is it ───────────────────────────────────────────────────
  const probed = await run(opts.ffprobePath ?? 'ffprobe', probeArgs(rawPath))
  if (probed.code !== 0) return fail('That file could not be read as audio.')

  let meta: { format?: { duration?: string; tags?: Record<string, string> } }
  try { meta = JSON.parse(probed.stdout) } catch { return fail('That file could not be read as audio.') }

  const durationSec = Math.round(Number(meta.format?.duration ?? 0))
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return fail('That file has no playable audio in it.')
  }
  if (durationSec > opts.limits.maxDurationSec) {
    return fail(`That track is too long — ${describeDuration(opts.limits.maxDurationSec)} at most.`)
  }

  // ── 5. re-encode, so the stored bytes are ours ──────────────────────────
  const enc = await run(opts.ffmpegPath ?? 'ffmpeg', transcodeArgs(rawPath, outPath))
  if (enc.code !== 0) return fail('That file could not be converted for playback.')
  const out = await stat(outPath).catch(() => null)
  if (!out || out.size === 0) return fail('That file could not be converted for playback.')

  // ── 6. cover art, through the encoder as well ───────────────────────────
  let coverWebp: string | undefined
  const cov = await run(opts.ffmpegPath ?? 'ffmpeg', coverArgs(rawPath, coverPath), 30_000)
  if (cov.code === 0) {
    const cs = await stat(coverPath).catch(() => null)
    // A cover is a nicety. Anything implausibly large for 320×320 is a sign
    // the extraction grabbed something else, and is dropped rather than
    // stored in a Mongo document.
    if (cs && cs.size > 0 && cs.size <= 256 * 1024) {
      coverWebp = `data:image/webp;base64,${(await readFile(coverPath)).toString('base64')}`
    }
  }

  const tags = meta.format?.tags ?? {}
  await sweep(rawPath, coverPath)

  return {
    ok: true,
    track: {
      title:  cleanTag(tags.title) || 'Untitled',
      artist: cleanTag(tags.artist),
      album:  cleanTag(tags.album),
      durationSec,
      audioPath: outPath,
      bytes: out.size,
      mimeType: AUDIO_MIME,
      coverWebp,
      scan,
    },
    cleanup: () => sweep(outPath),
  }
}

export type { AudioKind }
