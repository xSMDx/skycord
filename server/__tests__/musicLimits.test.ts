/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CAPS, capsFromEnv, checkUrlShape, checkChannelName,
  canOpenChannel, canQueue, ActionRate,
} from '../utils/musicLimits'

describe('capsFromEnv', () => {
  it('uses the defaults when nothing is set', () => {
    expect(capsFromEnv({})).toEqual(DEFAULT_CAPS)
  })

  it('takes a host override', () => {
    expect(capsFromEnv({ MUSIC_CHANNELS_PER_CALL: '2' }).channelsPerCall).toBe(2)
  })

  it('falls back rather than becoming NaN, which would permit everything', () => {
    // A cap of NaN compares false against every >=, so a typo in .env would
    // silently remove the limit instead of breaking loudly.
    for (const bad of ['', 'four', '-1', '0', 'NaN', 'Infinity']) {
      expect(capsFromEnv({ MUSIC_CHANNELS_PER_CALL: bad }).channelsPerCall, bad)
        .toBe(DEFAULT_CAPS.channelsPerCall)
    }
  })

  it('floors a fractional value instead of carrying it', () => {
    expect(capsFromEnv({ MUSIC_QUEUE_PER_CHANNEL: '10.9' }).queuePerChannel).toBe(10)
  })
})

describe('checkUrlShape', () => {
  it('takes an ordinary audio link', () => {
    for (const u of [
      'https://cdn.example.com/track.mp3',
      'http://example.com/a/b/song.flac',
      'https://example.com/x.opus?token=abc',
    ]) expect(checkUrlShape(u).ok, u).toBe(true)
  })

  it('refuses what is not a link', () => {
    for (const v of ['', '   ', 'not a link', 42, null, undefined, {}]) {
      expect(checkUrlShape(v as unknown).ok, String(v)).toBe(false)
    }
  })

  it('refuses a scheme that is not http(s)', () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com/a.mp3', 'data:audio/mp3;base64,AA', 'javascript:alert(1)']) {
      expect(checkUrlShape(u).ok, u).toBe(false)
    }
  })

  it('refuses credentials in the link', () => {
    expect(checkUrlShape('https://u:p@example.com/a.mp3').ok).toBe(false)
  })

  it('refuses anything that is not an audio file', () => {
    for (const u of ['https://example.com/', 'https://example.com/page.html', 'https://example.com/a.mp3.exe']) {
      expect(checkUrlShape(u).ok, u).toBe(false)
    }
  })

  it('refuses an absurdly long link', () => {
    expect(checkUrlShape('https://example.com/' + 'a'.repeat(3000) + '.mp3').ok).toBe(false)
  })

  it('says something a member can act on', () => {
    const r = checkUrlShape('https://example.com/page.html')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/audio/i)
  })
})

describe('checkChannelName', () => {
  it('takes a name', () => {
    for (const n of ['Chill', 'metal 🤘', 'a', 'x'.repeat(32)]) expect(checkChannelName(n).ok, n).toBe(true)
  })

  it('refuses empty, whitespace and non-strings', () => {
    for (const n of ['', '   ', 7, null, undefined]) expect(checkChannelName(n as unknown).ok, String(n)).toBe(false)
  })

  it('refuses one over the limit, counting characters rather than bytes', () => {
    expect(checkChannelName('x'.repeat(33)).ok).toBe(false)
    // 32 emoji are 32 characters, even though they are many more bytes.
    expect(checkChannelName('🤘'.repeat(32)).ok).toBe(true)
    expect(checkChannelName('🤘'.repeat(33)).ok).toBe(false)
  })

  it('refuses control characters and newlines', () => {
    for (const n of ['a\nb', 'a\u0000b', 'a\u007fb', 'a\tb']) expect(checkChannelName(n).ok, JSON.stringify(n)).toBe(false)
  })
})

describe('canOpenChannel', () => {
  const caps = { ...DEFAULT_CAPS, channelsPerCall: 2, channelsPerInstance: 3 }

  it('allows one below the per-call cap', () => {
    expect(canOpenChannel({ channelsHere: 1, channelsEverywhere: 1 }, caps).ok).toBe(true)
  })

  it('refuses at the per-call cap', () => {
    const r = canOpenChannel({ channelsHere: 2, channelsEverywhere: 2 }, caps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('This call')
  })

  it('refuses at the instance cap even when this call has room', () => {
    const r = canOpenChannel({ channelsHere: 0, channelsEverywhere: 3 }, caps)
    expect(r.ok).toBe(false)
    // The member must be able to tell "this call is full" from "the server
    // is full", or they will keep retrying the one they cannot fix.
    if (!r.ok) expect(r.reason).toContain('server')
  })
})

describe('canQueue', () => {
  it('allows below the cap and refuses at it', () => {
    const caps = { ...DEFAULT_CAPS, queuePerChannel: 3 }
    expect(canQueue(2, caps).ok).toBe(true)
    expect(canQueue(3, caps).ok).toBe(false)
  })
})

describe('ActionRate', () => {
  const caps = { ...DEFAULT_CAPS, actionsPerMinute: 3 }

  it('allows up to the cap and then refuses', () => {
    let t = 0
    const rate = new ActionRate(caps, () => t)
    expect(rate.take('ana').ok).toBe(true)
    expect(rate.take('ana').ok).toBe(true)
    expect(rate.take('ana').ok).toBe(true)
    expect(rate.take('ana').ok).toBe(false)
  })

  it('counts each member separately', () => {
    let t = 0
    const rate = new ActionRate(caps, () => t)
    for (let i = 0; i < 3; i++) rate.take('ana')
    expect(rate.take('ana').ok).toBe(false)
    expect(rate.take('ben').ok).toBe(true)
  })

  it('forgives once the window turns over', () => {
    let t = 0
    const rate = new ActionRate(caps, () => t)
    for (let i = 0; i < 3; i++) rate.take('ana')
    expect(rate.take('ana').ok).toBe(false)
    t += 60_000
    expect(rate.take('ana').ok).toBe(true)
  })

  it('does not grow forever — sweep drops stale members', () => {
    let t = 0
    const rate = new ActionRate(caps, () => t)
    for (const id of ['a', 'b', 'c', 'd']) rate.take(id)
    expect(rate.size).toBe(4)
    t += 60_000
    rate.sweep()
    expect(rate.size).toBe(0)
  })

  it('keeps the current window when sweeping', () => {
    let t = 0
    const rate = new ActionRate(caps, () => t)
    rate.take('old')
    t += 60_000
    rate.take('new')
    rate.sweep()
    expect(rate.size).toBe(1)
    // and the one that survived still has its count
    expect(rate.take('new').ok).toBe(true)
  })
})

describe('the upload size the client is told', () => {
  it('is the same MUSIC_MAX_BYTES the service refuses above, so the app can refuse first', async () => {
    const { libraryCapsFromEnv } = await import('../utils/musicLimits')
    expect(libraryCapsFromEnv({}).maxUploadBytes).toBe(100 * 1024 * 1024)
    expect(libraryCapsFromEnv({ MUSIC_MAX_BYTES: '26214400' }).maxUploadBytes).toBe(26214400)
    expect(libraryCapsFromEnv({ MUSIC_MAX_BYTES: 'lots' }).maxUploadBytes).toBe(100 * 1024 * 1024)
  })
})
