/**
 * Decide what a file actually is, from its first bytes.
 *
 * The filename and the Content-Type are both chosen by whoever supplied the
 * file, so neither is evidence. `checkUrlShape` in the API rejects a link
 * that does not end in an audio extension, and that is a courtesy to people
 * who paste the wrong thing — it is not a control, because renaming a file
 * costs nothing.
 *
 * This runs before the scanner and before ffmpeg, on the theory that the
 * cheapest way to be safe with a Windows executable is to never hand it to
 * anything. It is a allowlist: a container we do not recognise is refused
 * even if ffmpeg could probably play it, because "probably" is doing too
 * much work in a sentence about untrusted input.
 */

export type AudioKind = 'mp3' | 'flac' | 'ogg' | 'wav' | 'mp4' | 'aac' | 'webm'

export interface SniffResult {
  ok: boolean
  kind?: AudioKind
  /** Shown to the member, so it says what to do rather than what failed. */
  reason?: string
}

/** Enough for every signature below, including the MP4 brand at offset 4. */
export const SNIFF_BYTES = 64

const starts = (b: Buffer, sig: readonly number[], at = 0): boolean => {
  if (b.length < at + sig.length) return false
  for (let i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false
  return true
}

const ascii = (s: string): number[] => [...s].map(c => c.charCodeAt(0))

/**
 * Things that are definitely not audio and are worth naming.
 *
 * Not a security boundary — the allowlist below is. This exists so the
 * common mistake gets an error that explains itself instead of the generic
 * one, and so the logs distinguish "someone uploaded a zip" from "someone
 * uploaded something we have never seen".
 */
const DANGEROUS: ReadonlyArray<{ sig: number[]; what: string }> = [
  { sig: ascii('MZ'),            what: 'a Windows program' },
  { sig: [0x7f, ...ascii('ELF')], what: 'a Linux program' },
  { sig: ascii('PK\x03\x04'),    what: 'a zip archive' },
  { sig: ascii('%PDF'),          what: 'a PDF' },
  { sig: ascii('#!'),            what: 'a script' },
  { sig: [0xca, 0xfe, 0xba, 0xbe], what: 'a Java class file' },
]

/** MP4 brands that carry audio. `ftyp` sits at offset 4, not 0. */
const MP4_AUDIO_BRANDS = ['M4A ', 'M4B ', 'mp42', 'mp41', 'isom', 'iso2', 'dash']

export const sniff = (head: Buffer): SniffResult => {
  if (head.length < 12) return { ok: false, reason: 'That file is too small to be audio.' }

  for (const { sig, what } of DANGEROUS) {
    if (starts(head, sig)) return { ok: false, reason: `That is ${what}, not audio.` }
  }

  // ── the allowlist ───────────────────────────────────────────────────────
  if (starts(head, ascii('fLaC'))) return { ok: true, kind: 'flac' }
  if (starts(head, ascii('OggS'))) return { ok: true, kind: 'ogg' }
  if (starts(head, [0x1a, 0x45, 0xdf, 0xa3])) return { ok: true, kind: 'webm' }

  // RIFF....WAVE — the middle four bytes are the length, so check both ends.
  if (starts(head, ascii('RIFF')) && starts(head, ascii('WAVE'), 8)) {
    return { ok: true, kind: 'wav' }
  }

  if (starts(head, ascii('ftyp'), 4)) {
    const brand = head.subarray(8, 12).toString('latin1')
    if (MP4_AUDIO_BRANDS.includes(brand)) return { ok: true, kind: 'mp4' }
    // An mp4 we do not recognise is far more likely to be video than to be
    // an exotic audio brand, and video is a different feature.
    return { ok: false, reason: 'That looks like a video file, not audio.' }
  }

  // ID3v2-tagged MP3. The tag is arbitrarily long, so the frame sync is not
  // in these 64 bytes and the tag itself has to be the evidence.
  if (starts(head, ascii('ID3'))) return { ok: true, kind: 'mp3' }

  // Bare MPEG audio or ADTS AAC: eleven set bits of frame sync.
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
    // Layer bits of 00 mean "reserved" in MPEG and mark ADTS AAC instead.
    const isAdts = (head[1] & 0x06) === 0x00
    return { ok: true, kind: isAdts ? 'aac' : 'mp3' }
  }

  return { ok: false, reason: 'That is not an audio file we can read.' }
}
