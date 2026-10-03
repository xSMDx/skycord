import { describe, it, expect } from 'vitest'
import { sniff, SNIFF_BYTES } from '../src/sniff.js'

/**
 * The point of these is the rejections, not the acceptances.
 *
 * Every "this is audio" case is also reachable by just trying to decode the
 * file. The reason this function exists is the other half: a thing that is
 * not audio must be refused before the scanner, before ffmpeg, and before
 * anything writes it anywhere — and the name it arrived under must count for
 * nothing in that decision.
 */

/** Pad to the length the sniffer is given in production. */
const head = (...parts: Array<string | number[]>): Buffer => {
  const bytes: number[] = []
  for (const p of parts) {
    if (typeof p === 'string') bytes.push(...[...p].map(c => c.charCodeAt(0)))
    else bytes.push(...p)
  }
  while (bytes.length < SNIFF_BYTES) bytes.push(0)
  return Buffer.from(bytes)
}

describe('sniff — audio it should accept', () => {
  it('reads FLAC', () => {
    expect(sniff(head('fLaC'))).toMatchObject({ ok: true, kind: 'flac' })
  })

  it('reads Ogg', () => {
    expect(sniff(head('OggS'))).toMatchObject({ ok: true, kind: 'ogg' })
  })

  it('reads WebM', () => {
    expect(sniff(head([0x1a, 0x45, 0xdf, 0xa3]))).toMatchObject({ ok: true, kind: 'webm' })
  })

  it('reads WAV, checking both ends of the RIFF header', () => {
    expect(sniff(head('RIFF', [0x24, 0x08, 0x00, 0x00], 'WAVE'))).toMatchObject({ ok: true, kind: 'wav' })
  })

  it('reads an ID3-tagged MP3', () => {
    expect(sniff(head('ID3', [0x03, 0x00, 0x00]))).toMatchObject({ ok: true, kind: 'mp3' })
  })

  it('reads a bare MPEG frame sync', () => {
    expect(sniff(head([0xff, 0xfb, 0x90, 0x00]))).toMatchObject({ ok: true, kind: 'mp3' })
  })

  it('tells ADTS AAC apart from MPEG by the layer bits', () => {
    expect(sniff(head([0xff, 0xf1, 0x50, 0x80]))).toMatchObject({ ok: true, kind: 'aac' })
  })

  it('reads an M4A, whose brand sits at offset 4', () => {
    expect(sniff(head([0, 0, 0, 0x20], 'ftyp', 'M4A '))).toMatchObject({ ok: true, kind: 'mp4' })
  })
})

describe('sniff — what it must refuse', () => {
  it('refuses a Windows executable however it was named', () => {
    const r = sniff(head('MZ', [0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/Windows program/)
  })

  it('refuses an ELF binary', () => {
    const r = sniff(head([0x7f], 'ELF', [0x02, 0x01, 0x01, 0x00]))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/Linux program/)
  })

  it('refuses a zip, which is what a renamed .docx or .jar arrives as', () => {
    const r = sniff(head('PK\u0003\u0004', [0x14, 0x00, 0x00, 0x00]))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/zip archive/)
  })

  it('refuses a shell script', () => {
    const r = sniff(head('#!/bin/sh\necho hi'))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/script/)
  })

  it('refuses a PDF', () => {
    expect(sniff(head('%PDF-1.7')).ok).toBe(false)
  })

  it('refuses an MP4 that is video rather than audio', () => {
    const r = sniff(head([0, 0, 0, 0x20], 'ftyp', 'qt  '))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/video file/)
  })

  it('refuses anything it does not recognise, rather than hoping ffmpeg copes', () => {
    const r = sniff(head('not audio at all, just some text'))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/not an audio file/)
  })

  it('refuses a file too short to identify', () => {
    expect(sniff(Buffer.from([0xff, 0xfb])).ok).toBe(false)
  })

  it('is not fooled by audio magic that appears later in the file', () => {
    // A polyglot whose real header is an executable and which carries an Ogg
    // page further in must be judged on byte zero.
    const r = sniff(head('MZ', [0x90, 0x00], 'OggS'))
    expect(r.ok).toBe(false)
  })

  it('does not accept RIFF on its own — an AVI is RIFF too', () => {
    expect(sniff(head('RIFF', [0x24, 0x08, 0x00, 0x00], 'AVI ')).ok).toBe(false)
  })
})
