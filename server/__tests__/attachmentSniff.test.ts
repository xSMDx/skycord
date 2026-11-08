import { describe, expect, it } from 'vitest'
import { validateHeaderValue } from 'node:http'
import { sniff, cleanFileName, contentDisposition } from '../utils/attachmentSniff'

/* Header-only fixtures: each writes just the bytes its format's sniffer reads. */
const be32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
const le16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const be16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b }
const le24 = (n: number) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff])

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const png = (w: number, h: number) =>
  Buffer.concat([PNG_SIG, be32(13), Buffer.from('IHDR'), be32(w), be32(h), Buffer.from([8, 6, 0, 0, 0])])
const gif = (w: number, h: number) => Buffer.concat([Buffer.from('GIF89a'), le16(w), le16(h), Buffer.alloc(4)])
const jpeg = (w: number, h: number, sof = 0xc0) => Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  // An APP0 segment first, so the sniffer has to walk past it.
  Buffer.from([0xff, 0xe0]), be16(16), Buffer.from('JFIF\0'), Buffer.alloc(9),
  // A DHT (C4) is a SOF-range byte that is NOT a frame header.
  Buffer.from([0xff, 0xc4]), be16(4), Buffer.alloc(2),
  Buffer.from([0xff, sof]), be16(17), Buffer.from([8]), be16(h), be16(w), Buffer.alloc(10),
])
const riff = (chunk: string, body: Buffer) =>
  Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from(chunk), be32(body.length).reverse(), body])
const webpLossy = (w: number, h: number) =>
  riff('VP8 ', Buffer.concat([Buffer.alloc(3), Buffer.from([0x9d, 0x01, 0x2a]), le16(w), le16(h)]))
const webpLossless = (w: number, h: number) => {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14)
  const b = Buffer.alloc(4); b.writeUInt32LE(bits >>> 0)
  return riff('VP8L', Buffer.concat([Buffer.from([0x2f]), b]))
}
const webpExtended = (w: number, h: number) =>
  riff('VP8X', Buffer.concat([Buffer.alloc(4), le24(w - 1), le24(h - 1)]))
const ftyp = (brand: string) => Buffer.concat([be32(24), Buffer.from('ftyp'), Buffer.from(brand), Buffer.alloc(12)])

const FILE = { kind: 'file', mime: 'application/octet-stream', width: null, height: null }

describe('sniff', () => {
  it('reads PNG dimensions', () =>
    expect(sniff(png(640, 480))).toEqual({ kind: 'image', mime: 'image/png', width: 640, height: 480 }))

  it('reads GIF dimensions', () =>
    expect(sniff(gif(320, 200))).toEqual({ kind: 'image', mime: 'image/gif', width: 320, height: 200 }))

  it('reads JPEG dimensions from SOF0 and SOF2, walking past other segments', () => {
    expect(sniff(jpeg(1024, 768))).toEqual({ kind: 'image', mime: 'image/jpeg', width: 1024, height: 768 })
    expect(sniff(jpeg(50, 60, 0xc2))).toEqual({ kind: 'image', mime: 'image/jpeg', width: 50, height: 60 })
  })

  it('reads WebP VP8, VP8L and VP8X dimensions', () => {
    expect(sniff(webpLossy(400, 300))).toEqual({ kind: 'image', mime: 'image/webp', width: 400, height: 300 })
    expect(sniff(webpLossless(123, 45))).toEqual({ kind: 'image', mime: 'image/webp', width: 123, height: 45 })
    expect(sniff(webpExtended(4000, 3000))).toEqual({ kind: 'image', mime: 'image/webp', width: 4000, height: 3000 })
  })

  it('knows MP4 by ftyp at offset 4', () =>
    expect(sniff(ftyp('isom'))).toEqual({ kind: 'video', mime: 'video/mp4', width: null, height: null }))

  it('maps a qt brand to video/quicktime', () =>
    expect(sniff(ftyp('qt  '))).toEqual({ kind: 'video', mime: 'video/quicktime', width: null, height: null }))

  it('does not call a HEIC or AVIF still a video', () => {
    expect(sniff(ftyp('heic'))).toEqual(FILE)
    expect(sniff(ftyp('avif'))).toEqual(FILE)
  })

  it('knows WebM by the EBML magic', () =>
    expect(sniff(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))).toEqual({ kind: 'video', mime: 'video/webm', width: null, height: null }))

  it('treats HTML, SVG, PDF, ZIP and empty buffers as files', () => {
    const html = Buffer.from('<!doctype html><script>alert(1)</script>')
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const pdf = Buffer.from('%PDF-1.7\n')
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])
    for (const b of [html, svg, pdf, zip, Buffer.alloc(0)]) expect(sniff(b)).toEqual(FILE)
  })

  it('gives null dimensions for a truncated PNG rather than throwing', () =>
    expect(sniff(Buffer.concat([PNG_SIG, be32(13), Buffer.from('IHDR')]))).toEqual({ kind: 'image', mime: 'image/png', width: null, height: null }))
})

describe('cleanFileName', () => {
  it('strips directories, either slash', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd')
    expect(cleanFileName('C:\\Users\\me\\photo.jpg')).toBe('photo.jpg')
  })

  it('drops control and bidi override characters', () =>
    expect(cleanFileName('a\r\nb\u202Ec.txt')).toBe('abc.txt'))

  it('caps at 200 characters keeping the extension', () => {
    const n = cleanFileName('x'.repeat(300) + '.pdf')
    expect(n.length).toBe(200)
    expect(n.endsWith('.pdf')).toBe(true)
  })

  it('never cuts a character in half', () => {
    const n = cleanFileName('😀'.repeat(250))
    expect(Array.from(n).length).toBe(200)
    expect(n).toBe('😀'.repeat(200))
  })

  it('never returns empty or a bare dot name', () => {
    expect(cleanFileName('  ')).toBe('file')
    expect(cleanFileName('')).toBe('file')
    expect(cleanFileName('..')).toBe('file')
    expect(cleanFileName('dir/')).toBe('file')
  })

  it('keeps ordinary names as they are', () =>
    expect(cleanFileName('Résumé – final (2).pdf')).toBe('Résumé – final (2).pdf'))
})

describe('contentDisposition', () => {
  it('is inline for media and attachment for files', () => {
    expect(contentDisposition('image', 'a.png')).toMatch(/^inline; /)
    expect(contentDisposition('video', 'a.mp4')).toMatch(/^inline; /)
    expect(contentDisposition('file', 'a.pdf')).toMatch(/^attachment; /)
  })

  it('quotes an ASCII fallback and adds RFC 5987 filename*', () =>
    expect(contentDisposition('file', 'résumé "v2".pdf'))
      .toBe(`attachment; filename="r_sum_ _v2_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22v2%22.pdf`))

  it('percent-encodes the characters RFC 5987 reserves', () =>
    expect(contentDisposition('file', "it's (a)*.txt")).toContain(`filename*=UTF-8''it%27s%20%28a%29%2A.txt`))

  it('produces a value Node accepts for every cleaned hostile name', () => {
    const hostile = ['../../x', 'a"b\\c', 'line\r\nbreak.txt', '\u202Egnp.exe', '日本語のファイル.zip', '😀'.repeat(300), '']
    for (const raw of hostile) {
      for (const kind of ['image', 'video', 'file'] as const) {
        expect(() => validateHeaderValue('Content-Disposition', contentDisposition(kind, cleanFileName(raw)))).not.toThrow()
      }
    }
  })
})
