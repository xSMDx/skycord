/**
 * What an uploaded file actually is, read from its bytes.
 *
 * The claimed Content-Type and the file name are the uploader's to choose, so
 * neither decides anything here. That matters because of what the answer
 * controls: a file this calls an image or a video is served `inline`, under
 * the app's own origin. Calling an HTML or SVG file an image would let an
 * upload run script as Skycord. So the list of inline types is short and
 * closed — PNG, JPEG, GIF, WebP, MP4/MOV, WebM — and everything else, however
 * it is named, is a download (`application/octet-stream`, `attachment`).
 *
 * Image dimensions come along because the message list reserves each image's
 * box before it loads; without them every photo arriving shoves the
 * conversation down. They are best-effort: a header too short to read gives
 * nulls, never a throw, and the client falls back to a fixed box.
 */

export type AttachmentKind = 'image' | 'video' | 'file'

export interface Sniffed {
  kind:   AttachmentKind
  mime:   string
  width:  number | null
  height: number | null
}

const FILE: Sniffed = { kind: 'file', mime: 'application/octet-stream', width: null, height: null }

const startsWith = (buf: Buffer, bytes: number[], at = 0): boolean =>
  buf.length >= at + bytes.length && bytes.every((b, i) => buf[at + i] === b)

const ascii = (buf: Buffer, at: number, len: number): string =>
  buf.length >= at + len ? buf.toString('latin1', at, at + len) : ''

/** Dimensions, or nulls when either is missing or nonsense. */
const dims = (w: number | null, h: number | null): Pick<Sniffed, 'width' | 'height'> =>
  w && h && w > 0 && h > 0 ? { width: w, height: h } : { width: null, height: null }

const png = (buf: Buffer): Sniffed => {
  // Signature (8), IHDR length (4), "IHDR" (4), width (4), height (4).
  const ok = buf.length >= 24 && ascii(buf, 12, 4) === 'IHDR'
  return { kind: 'image', mime: 'image/png', ...dims(ok ? buf.readUInt32BE(16) : null, ok ? buf.readUInt32BE(20) : null) }
}

const gif = (buf: Buffer): Sniffed => {
  const ok = buf.length >= 10
  return { kind: 'image', mime: 'image/gif', ...dims(ok ? buf.readUInt16LE(6) : null, ok ? buf.readUInt16LE(8) : null) }
}

/**
 * JPEG keeps its size in a frame header (SOF0–SOF15) somewhere after any
 * number of other segments. C4 (DHT), C8 (JPG) and CC (DAC) share that byte
 * range without being frame headers.
 */
const jpeg = (buf: Buffer): Sniffed => {
  const out: Sniffed = { kind: 'image', mime: 'image/jpeg', width: null, height: null }
  let i = 2
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) return out
    let marker = buf[i + 1]
    // Fill bytes: any number of 0xFF may precede a marker.
    while (marker === 0xff && i + 2 < buf.length) { i++; marker = buf[i + 1] }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue }
    if (marker === 0xda) return out          // start of scan: no frame header found
    if (i + 4 > buf.length) return out
    const len = buf.readUInt16BE(i + 2)
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame) {
      if (i + 9 > buf.length) return out
      return { ...out, ...dims(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)) }
    }
    if (len < 2) return out
    i += 2 + len
  }
  return out
}

const webp = (buf: Buffer): Sniffed => {
  const out: Sniffed = { kind: 'image', mime: 'image/webp', width: null, height: null }
  const chunk = ascii(buf, 12, 4)
  const d = 20 // first byte of the chunk's payload
  if (chunk === 'VP8 ' && buf.length >= d + 10 && startsWith(buf, [0x9d, 0x01, 0x2a], d + 3)) {
    return { ...out, ...dims(buf.readUInt16LE(d + 6) & 0x3fff, buf.readUInt16LE(d + 8) & 0x3fff) }
  }
  if (chunk === 'VP8L' && buf.length >= d + 5 && buf[d] === 0x2f) {
    const bits = buf.readUInt32LE(d + 1)
    return { ...out, ...dims((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1) }
  }
  if (chunk === 'VP8X' && buf.length >= d + 10) {
    return { ...out, ...dims(buf.readUIntLE(d + 4, 3) + 1, buf.readUIntLE(d + 7, 3) + 1) }
  }
  return out
}

/**
 * ISO base media brands that are video a browser plays. HEIC and AVIF use the
 * same container for still images and must not land here; neither must M4A,
 * which is audio.
 */
const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VH', 'M4VP',
  'f4v ', 'dash', '3gp4', '3gp5', '3gp6', '3g2a', 'MSNV', 'mmp4',
])

const isoMedia = (buf: Buffer): Sniffed | null => {
  if (ascii(buf, 4, 4) !== 'ftyp') return null
  const brand = ascii(buf, 8, 4)
  if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime', width: null, height: null }
  if (MP4_BRANDS.has(brand)) return { kind: 'video', mime: 'video/mp4', width: null, height: null }
  return FILE
}

export const sniff = (buf: Buffer): Sniffed => {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return png(buf)
  if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') return gif(buf)
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return jpeg(buf)
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return webp(buf)
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', mime: 'video/webm', width: null, height: null }
  return isoMedia(buf) ?? FILE
}

// ── names ────────────────────────────────────────────────────────────────

const MAX_NAME = 200
/** C0 and C1 controls, DEL, and the bidi and zero-width marks that can make
 *  "gnp.exe" read as "exe.png". */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g

/**
 * A name fit to store and show: no directories, no control or direction
 * characters, at most 200 characters with the extension kept, never empty.
 * Counted in code points so an emoji is never cut in half.
 */
export const cleanFileName = (raw: string): string => {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? ''
  const name = base.replace(UNSAFE, '').trim()
  if (!name || name === '.' || name === '..') return 'file'
  const chars = Array.from(name)
  if (chars.length <= MAX_NAME) return name
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? Array.from(name.slice(dot)) : []
  const keep = ext.length > 0 && ext.length <= 16 ? ext : []
  return chars.slice(0, MAX_NAME - keep.length).join('') + keep.join('')
}

/** RFC 5987 attr-chars: what encodeURIComponent leaves alone, minus ' ( ) * ! */
const rfc5987 = (s: string): string =>
  encodeURIComponent(s).replace(/['()*!]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())

/**
 * `inline` only for the inline-safe kinds. The quoted `filename` is a plain
 * ASCII fallback for old clients; `filename*` carries the real name.
 */
export const contentDisposition = (kind: AttachmentKind, name: string): string => {
  const type = kind === 'file' ? 'attachment' : 'inline'
  const fallback = Array.from(name).map(c => /^[\x20-\x7e]$/.test(c) && c !== '"' && c !== '\\' ? c : '_').join('')
  return `${type}; filename="${fallback}"; filename*=UTF-8''${rfc5987(name)}`
}
