/**
 * Reading ffprobe's answer: how long, what it is called, and which stream is
 * the cover. The fixtures are verbatim ffprobe 5.1 output — the version the
 * music image ships (Debian bookworm) — for files made with tags and covers.
 *
 * Two bugs lived here. Covers were picked with `-map disp:attached_pic`, a
 * stream specifier ffmpeg 5.1 does not have, so no upload in production ever
 * got its artwork; a developer machine with a newer ffmpeg never showed it.
 * And Ogg and Opus keep their tags on the audio stream, not the container,
 * so every one of them arrived as "Untitled".
 */
import { describe, expect, it } from 'vitest'
import { probeArgs, readProbe, coverArgs } from '../src/ingest.js'

const mp3 = { programs: [], streams: [
  { index: 0, codec_type: 'audio', disposition: { attached_pic: 0 } },
  { index: 1, codec_type: 'video', disposition: { attached_pic: 1 }, tags: {} },
], format: { duration: '6.034286', tags: { title: 'Night Drive', artist: 'Lumen', album: 'Test Album' } } }

const m4a = { programs: [], streams: [
  { index: 0, codec_type: 'audio', disposition: { attached_pic: 0 }, tags: {} },
  { index: 1, codec_type: 'video', disposition: { attached_pic: 1 } },
], format: { duration: '6.000000', tags: { title: 'Paper Planes', artist: 'Halcyon', album: 'Test Album' } } }

const ogg = { programs: [], streams: [
  { index: 0, codec_type: 'audio', disposition: { attached_pic: 0 }, tags: { title: 'Golden Hour', artist: 'Sunroom', album: 'Test Album' } },
], format: { duration: '6.000000' } }

const wav = { programs: [], streams: [
  { index: 0, codec_type: 'audio', disposition: { attached_pic: 0 } },
], format: { duration: '6.000000', tags: { artist: 'Wave Band', title: 'Wave Song' } } }

describe('readProbe', () => {
  it('reads duration and container tags', () => {
    expect(readProbe(mp3)).toEqual({
      durationSec: 6, coverIndex: 1, tags: { title: 'Night Drive', artist: 'Lumen', album: 'Test Album' },
    })
  })

  it('finds the cover by its attached_pic disposition, whatever its position', () => {
    expect(readProbe(m4a).coverIndex).toBe(1)
    const coverFirst = { ...mp3, streams: [
      { index: 0, codec_type: 'video', disposition: { attached_pic: 1 } },
      { index: 1, codec_type: 'audio', disposition: { attached_pic: 0 } },
    ] }
    expect(readProbe(coverFirst).coverIndex).toBe(0)
  })

  it('takes a real video stream for nothing: only attached pictures are covers', () => {
    const video = { ...wav, streams: [...wav.streams, { index: 1, codec_type: 'video', disposition: { attached_pic: 0 } }] }
    expect(readProbe(video).coverIndex).toBeNull()
  })

  it('no cover at all', () => {
    expect(readProbe(wav).coverIndex).toBeNull()
    expect(readProbe(ogg).coverIndex).toBeNull()
  })

  it('falls back to the audio stream tags, where Ogg and Opus keep theirs', () => {
    expect(readProbe(ogg).tags).toEqual({ title: 'Golden Hour', artist: 'Sunroom', album: 'Test Album' })
  })

  it('prefers the container tags, and fills gaps from the stream', () => {
    const mixed = {
      streams: [{ index: 0, codec_type: 'audio', disposition: { attached_pic: 0 }, tags: { title: 'Stream title', album: 'Stream album' } }],
      format: { duration: '10', tags: { title: 'Container title' } },
    }
    expect(readProbe(mixed).tags).toEqual({ title: 'Container title', artist: undefined, album: 'Stream album' })
  })

  it('matches tag names in any case', () => {
    const upper = { streams: [{ index: 0, codec_type: 'audio', tags: { TITLE: 'Loud', ARTIST: 'Caps' } }], format: { duration: '3' } }
    expect(readProbe(upper).tags).toMatchObject({ title: 'Loud', artist: 'Caps' })
  })

  it('a missing or nonsense duration reads as zero, for the caller to refuse', () => {
    expect(readProbe({ format: {} }).durationSec).toBe(0)
    expect(readProbe({ format: { duration: 'N/A' } }).durationSec).toBe(0)
    expect(readProbe({}).durationSec).toBe(0)
  })
})

describe('the ffmpeg arguments', () => {
  it('the probe asks for streams, their cover flag and their tags', () => {
    const entries = probeArgs('in')[probeArgs('in').indexOf('-show_entries') + 1]
    expect(entries).toContain('stream=index,codec_type')
    expect(entries).toContain('stream_disposition=attached_pic')
    expect(entries).toContain('stream_tags=title,artist,album')
  })

  it('the cover is mapped by stream index, never by a disposition specifier', () => {
    const args = coverArgs('in', 'out', 1)
    expect(args[args.indexOf('-map') + 1]).toBe('0:1')
    expect(args.join(' ')).not.toContain('disp:')
  })
})
